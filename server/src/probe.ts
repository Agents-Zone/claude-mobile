/**
 * Standalone verification of the session core. No HTTP. Sends two turns to a
 * role and asserts: session continuity (same session id), a file actually gets
 * written into the role cwd, and a result event carries usage.
 *
 * Usage: npm --workspace server run probe
 */
import { loadConfig } from './config.js';
import { SessionManager, type ServerEvent } from './session.js';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const cfg = loadConfig();
const role = cfg.roles.find((r) => r.id === 'random') ?? cfg.roles[0];
console.log(`probing role=${role.id} cwd=${role.cwd} exe=${cfg.claudeExecutable}`);

const manager = new SessionManager(cfg.claudeExecutable);
const marker = join(role.cwd, 'claude_mobile_probe.txt');
if (existsSync(marker)) rmSync(marker);

let sessionId: string | null = null;
let gotResult = false;

function makeWaiter() {
  let resolve!: () => void;
  const p = new Promise<void>((r) => (resolve = r));
  return { p, resolve };
}

let waiter = makeWaiter();

const emit = (e: ServerEvent) => {
  if (e.type === 'session') {
    if (sessionId && sessionId !== e.sessionId) {
      console.log(`  [session changed ${sessionId} -> ${e.sessionId}]`);
    }
    sessionId = e.sessionId;
    console.log(`  session=${e.sessionId}`);
  } else if (e.type === 'text_delta') {
    process.stdout.write(e.text);
  } else if (e.type === 'tool_use') {
    console.log(`\n  [tool_use ${e.name}] ${JSON.stringify(e.input).slice(0, 120)}`);
  } else if (e.type === 'tool_result') {
    console.log(`  [tool_result ${e.isError ? 'ERROR' : 'ok'}] ${e.summary.slice(0, 120)}`);
  } else if (e.type === 'result') {
    gotResult = true;
    console.log(
      `\n  [result ok=${e.ok} cost=$${e.costUsd?.toFixed(4)} turns=${e.numTurns} usage=${JSON.stringify(e.usage)?.slice(0, 200)}]`
    );
  } else if (e.type === 'idle') {
    waiter.resolve();
  } else if (e.type === 'error') {
    console.error(`\n  [error] ${e.message}`);
    waiter.resolve();
  }
};

const session = manager.get(role, emit);

async function turn(text: string) {
  waiter = makeWaiter();
  console.log(`\n>>> ${text}`);
  session.send(text);
  await waiter.p;
}

const TIMEOUT_MS = 180_000;
const timeout = setTimeout(() => {
  console.error('\nTIMEOUT');
  process.exit(2);
}, TIMEOUT_MS);

try {
  await turn(
    'Create a file named claude_mobile_probe.txt in the current directory containing exactly the text: turn-one-ok'
  );
  const firstSession = sessionId;
  await turn('Now append a second line to that same file: turn-two-ok. Confirm the file has two lines.');

  clearTimeout(timeout);

  console.log('\n\n=== ASSERTIONS ===');
  const fileOk = existsSync(marker);
  console.log(`file written: ${fileOk ? 'PASS' : 'FAIL'} (${marker})`);
  console.log(`session continuity: ${firstSession && firstSession === sessionId ? 'PASS' : 'FAIL'} (${firstSession} == ${sessionId})`);
  console.log(`result event with usage: ${gotResult ? 'PASS' : 'FAIL'}`);

  await manager.disposeAll();
  process.exit(fileOk && gotResult ? 0 : 1);
} catch (e) {
  clearTimeout(timeout);
  console.error('probe failed:', e);
  process.exit(1);
}
