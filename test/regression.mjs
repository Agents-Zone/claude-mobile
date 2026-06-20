#!/usr/bin/env node
/**
 * Regression test suite for claude-mobile.
 *
 * Two tiers:
 *   STATIC — deterministic, no LLM, no token cost: typecheck, build, config,
 *            HTTP endpoints, traversal guard, NFC filenames, route fallbacks.
 *   LIVE   — drives the real claude-code (slow, costs tokens): WS streaming,
 *            multi-turn session continuity, file writes, new-conversation reset.
 *
 * Usage:
 *   node test/regression.mjs                # static + live
 *   node test/regression.mjs --static-only  # static only (fast, free)
 *   node test/regression.mjs --live-only    # live only
 *
 * The harness boots its own server instance on a TEST port bound to 127.0.0.1
 * so it never collides with the real (Tailscale-bound) service.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const args = process.argv.slice(2);
const STATIC_ONLY = args.includes('--static-only');
const LIVE_ONLY = args.includes('--live-only');
const RUN_STATIC = !LIVE_ONLY;
const RUN_LIVE = !STATIC_ONLY;

const TEST_HOST = '127.0.0.1';
const TEST_PORT = 8799;
const BASE = `http://${TEST_HOST}:${TEST_PORT}`;

// ---- tiny test framework ----
let pass = 0,
  fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ---- a throwaway roles.json + workspace so tests never touch real role dirs ----
const SANDBOX = mkdtempSync(join(tmpdir(), 'cm-regress-'));
const TEST_ROLES_PATH = join(SANDBOX, 'roles.json');
const TEST_CWD = join(SANDBOX, 'workspace');
spawnSync('mkdir', ['-p', TEST_CWD]);
// seed an artifact with a multibyte (NFC) name to exercise filename handling
const NFC_NAME = '散热器测试.md';
writeFileSync(join(TEST_CWD, NFC_NAME), '# 测试\n器 character present\n');
writeFileSync(join(TEST_CWD, 'sample.txt'), 'hello-artifact\n');

function realClaudeExe() {
  // mirror roles.json default; fall back to PATH lookup
  try {
    const c = JSON.parse(readFileSync(join(REPO, 'roles.json'), 'utf8'));
    if (c.claudeExecutable && existsSync(c.claudeExecutable)) return c.claudeExecutable;
  } catch {}
  const which = spawnSync('which', ['claude']);
  return which.stdout.toString().trim() || join(process.env.HOME || '', '.local/bin/claude');
}

writeFileSync(
  TEST_ROLES_PATH,
  JSON.stringify(
    {
      claudeExecutable: realClaudeExe(),
      host: TEST_HOST,
      port: TEST_PORT,
      roles: [
        {
          id: 'test',
          name: 'Test',
          emoji: '🧪',
          cwd: TEST_CWD,
          model: 'opus',
          permissionMode: 'bypassPermissions',
        },
      ],
    },
    null,
    2
  )
);

// ---- helpers ----
function run(cmd, cmdArgs, opts = {}) {
  return spawnSync(cmd, cmdArgs, { cwd: REPO, encoding: 'utf8', ...opts });
}
async function get(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, ct: r.headers.get('content-type') || '', text: await r.text() };
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let server = null;
async function bootServer() {
  // Build first so dist exists, then run the compiled server with our test roles.
  const distIndex = join(REPO, 'server', 'dist', 'index.js');
  if (!existsSync(distIndex)) {
    run('npm', ['--workspace', 'server', 'run', 'build']);
  }
  server = spawn('node', [distIndex], {
    cwd: SANDBOX,
    env: { ...process.env, HOME: process.env.HOME, CLAUDE_MOBILE_ROLES: TEST_ROLES_PATH },
    detached: true, // own process group so we can kill the tree
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', (d) => (logs += d));
  server.stderr.on('data', (d) => (logs += d));
  // wait for listen (poll the roles endpoint)
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const r = await fetch(BASE + '/api/roles');
      if (r.ok) return logs;
    } catch {}
  }
  throw new Error('server did not start in time. logs:\n' + logs);
}
function killServer() {
  if (server) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
    try {
      server.kill('SIGKILL');
    } catch {}
  }
}

// =====================================================================
// STATIC TIER
// =====================================================================
async function staticTests() {
  section('STATIC · build & typecheck');
  const tcServer = run('npx', ['tsc', '-p', 'server/tsconfig.json', '--noEmit']);
  ok('server typechecks', tcServer.status === 0, tcServer.stderr?.slice(0, 300));
  const buildWeb = run('npm', ['run', 'build:web']);
  ok('web builds', buildWeb.status === 0, (buildWeb.stderr || '').slice(-300));
  ok('web dist emitted', existsSync(join(REPO, 'web', 'dist', 'index.html')));

  section('STATIC · config validation');
  // bad roles.json (missing cwd) should crash the server fast
  const badDir = mkdtempSync(join(tmpdir(), 'cm-bad-'));
  const badRoles = join(badDir, 'roles.json');
  writeFileSync(
    badRoles,
    JSON.stringify({ claudeExecutable: realClaudeExe(), roles: [{ id: 'x', cwd: '/no/such/dir/zzz' }] })
  );
  const bad = run('node', [join(REPO, 'server', 'dist', 'index.js')], {
    cwd: badDir,
    timeout: 8000,
    env: { ...process.env, CLAUDE_MOBILE_ROLES: badRoles },
  });
  ok(
    'rejects role with nonexistent cwd',
    (bad.stderr + bad.stdout).includes('cwd does not exist'),
    (bad.stderr || '').slice(0, 160)
  );

  section('STATIC · HTTP endpoints (live server, no LLM)');
  const roles = await get('/api/roles');
  ok('GET /api/roles → 200', roles.status === 200);
  let parsed;
  try {
    parsed = JSON.parse(roles.text);
  } catch {}
  ok('roles payload has our test role', !!parsed?.roles?.some((r) => r.id === 'test'));

  const frontend = await get('/');
  ok('GET / serves frontend (200 html)', frontend.status === 200 && frontend.text.includes('<div id="root">'));

  const files = await get('/api/roles/test/files');
  ok('GET /api/roles/:id/files → 200', files.status === 200);
  const fj = JSON.parse(files.text || '{}');
  ok('file tree lists seeded files', !!fj.entries?.some((e) => e.name === 'sample.txt'));
  ok('file tree includes NFC-named file', !!fj.entries?.some((e) => e.name.includes('散热器')));

  section('STATIC · artifact serving & guards');
  const txt = await get('/files/test/sample.txt');
  ok('serves ascii artifact (200)', txt.status === 200 && txt.text.includes('hello-artifact'));

  // NFC multibyte name, encoded exactly like the frontend does
  const enc = NFC_NAME.normalize('NFC')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const nfc = await get('/files/test/' + enc);
  ok('serves NFC multibyte filename (200)', nfc.status === 200 && nfc.text.includes('器 character'));

  const escape = await get('/files/test/..%2f..%2f..%2fetc%2fpasswd');
  ok('traversal via encoded .. → 400', escape.status === 400);

  const escape2 = await get('/files/test/' + encodeURIComponent('../../../../etc/passwd'));
  ok('traversal via encoded path → 400', escape2.status === 400);

  const unknownRole = await get('/files/nope/sample.txt');
  ok('unknown role → 404', unknownRole.status === 404);

  const missing = await get('/files/test/does-not-exist.pdf');
  ok('missing file → 404', missing.status === 404);

  const apiNotFound = await get('/api/totally-unknown');
  ok('unknown /api route → 404 (not SPA html)', apiNotFound.status === 404 && !apiNotFound.text.includes('<div id="root">'));

  const spaFallback = await get('/some/client/route');
  ok('client route → SPA index fallback', spaFallback.status === 200 && spaFallback.text.includes('<div id="root">'));
}

// =====================================================================
// LIVE TIER (drives real claude-code)
// =====================================================================
function wsConnect() {
  return new WebSocket(`ws://${TEST_HOST}:${TEST_PORT}/ws/test`);
}
/** Send a message, collect events until 'result'/'idle' or timeout. */
function turn(ws, text, timeoutMs = 150000) {
  return new Promise((resolveTurn, reject) => {
    const events = [];
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error('turn timeout'));
    }, timeoutMs);
    function onMsg(ev) {
      const e = JSON.parse(ev.data);
      events.push(e);
      if (e.type === 'result' || e.type === 'idle') {
        // wait one tick for a trailing idle after result
        if (e.type === 'idle') {
          clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
          resolveTurn(events);
        }
      } else if (e.type === 'error') {
        clearTimeout(timer);
        ws.removeEventListener('message', onMsg);
        resolveTurn(events);
      }
    }
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ type: 'user', text }));
  });
}
function waitOpen(ws) {
  return new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', () => rej(new Error('ws error')));
  });
}

async function liveTests() {
  section('LIVE · websocket multi-turn (drives claude-code)');
  const marker = join(TEST_CWD, 'regress_marker.txt');
  if (existsSync(marker)) rmSync(marker);
  // clear any stale leak file so the isolation negative-check is sound
  const homeLeakPre = join(process.env.HOME || '/root', 'regress_marker.txt');
  if (existsSync(homeLeakPre)) rmSync(homeLeakPre, { force: true });

  const ws = wsConnect();
  await waitOpen(ws);
  ok('websocket connects', ws.readyState === ws.OPEN);

  // turn 1: write a file. Use an explicit relative path so the assertion tests
  // cwd isolation (file lands in role cwd), not the model's guess at "current dir".
  const t1 = await turn(
    ws,
    'Use the Write tool to create a file at the relative path "regress_marker.txt" (relative, not absolute) whose only content is: alpha'
  );
  const session1 = t1.find((e) => e.type === 'session')?.sessionId;
  const result1 = t1.find((e) => e.type === 'result');
  ok('turn 1 emits session id', !!session1);
  ok('turn 1 streams text or tool_use', t1.some((e) => e.type === 'text_delta' || e.type === 'tool_use'));
  ok('turn 1 emits result', !!result1);
  ok('turn 1 result has usage', !!result1?.usage);
  ok('turn 1 wrote the file INTO the role cwd (isolation)', existsSync(marker));
  // negative check: it must NOT have leaked into $HOME
  const homeLeak = join(process.env.HOME || '/root', 'regress_marker.txt');
  ok('write did not leak into $HOME', !existsSync(homeLeak) || homeLeak === marker);

  // turn 2: rely on prior-turn context (continuity) — refers to "that same file"
  // from turn 1 using a relative path again.
  const t2 = await turn(
    ws,
    'Append a second line containing "beta" to that same file (relative path regress_marker.txt). Confirm it has two lines.'
  );
  const session2 = t2.find((e) => e.type === 'session')?.sessionId;
  ok('turn 2 keeps same session id (continuity)', session2 && session2 === session1, `${session1} vs ${session2}`);
  const content = existsSync(marker) ? readFileSync(marker, 'utf8') : '';
  ok('turn 2 understood "that same file" (alpha+beta present)', /alpha/.test(content) && /beta/.test(content), JSON.stringify(content));

  // new conversation resets session
  section('LIVE · new conversation resets session');
  const reset = new Promise((res) => {
    function onMsg(ev) {
      const e = JSON.parse(ev.data);
      if (e.type === 'idle') {
        ws.removeEventListener('message', onMsg);
        res();
      }
    }
    ws.addEventListener('message', onMsg);
  });
  ws.send(JSON.stringify({ type: 'new' }));
  await reset;
  const t3 = await turn(ws, 'Reply with exactly: fresh');
  const session3 = t3.find((e) => e.type === 'session')?.sessionId;
  ok('new conversation starts a different session id', session3 && session3 !== session1, `${session1} vs ${session3}`);

  ws.close();
  rmSync(marker, { force: true });
}

// =====================================================================
async function main() {
  console.log(`\x1b[1mclaude-mobile regression\x1b[0m  (static=${RUN_STATIC} live=${RUN_LIVE})`);
  console.log(`sandbox: ${SANDBOX}`);
  let logs = '';
  try {
    logs = await bootServer();
    if (RUN_STATIC) await staticTests();
    if (RUN_LIVE) await liveTests();
  } catch (e) {
    fail++;
    failures.push('harness: ' + e.message);
    console.error('\n\x1b[31mHARNESS ERROR\x1b[0m', e.message);
    if (logs) console.error(logs.slice(-800));
  } finally {
    killServer();
    rmSync(SANDBOX, { recursive: true, force: true });
  }

  console.log(`\n\x1b[1m──────── results ────────\x1b[0m`);
  console.log(`  pass: \x1b[32m${pass}\x1b[0m   fail: ${fail ? `\x1b[31m${fail}\x1b[0m` : 0}`);
  if (failures.length) {
    console.log('\n  failed:');
    for (const f of failures) console.log(`   - ${f}`);
  }
  process.exit(fail ? 1 : 0);
}
main();
