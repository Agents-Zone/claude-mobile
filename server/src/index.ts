import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync, createReadStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, REPO_ROOT, type RoleConfig } from './config.js';
import { SessionManager, type ServerEvent } from './session.js';
import { listDir, safeResolve, PathEscapeError } from './files.js';

const cfg = loadConfig();
const manager = new SessionManager(cfg.claudeExecutable);
const rolesById = new Map(cfg.roles.map((r) => [r.id, r]));

const app = Fastify({ logger: { level: 'info' } });
await app.register(websocket);

// --- REST: roles list ---
app.get('/api/roles', async () => ({
  roles: cfg.roles.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, cwd: r.cwd, model: r.model })),
}));

// --- REST: file tree for a role ---
app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
  '/api/roles/:id/files',
  async (req, reply) => {
    const role = rolesById.get(req.params.id);
    if (!role) return reply.code(404).send({ error: 'unknown role' });
    try {
      return listDir(role, req.query.path ?? '.');
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  }
);

// --- Artifact serving: stream a file from the role cwd (guarded) ---
app.get<{ Params: { id: string; '*': string } }>('/files/:id/*', async (req, reply) => {
  const role = rolesById.get(req.params.id);
  if (!role) return reply.code(404).send({ error: 'unknown role' });
  let abs: string;
  try {
    abs = safeResolve(role, req.params['*']);
  } catch (e) {
    const code = e instanceof PathEscapeError ? 400 : 404;
    return reply.code(code).send({ error: (e as Error).message });
  }
  if (!existsSync(abs)) return reply.code(404).send({ error: 'not found' });
  // For HTML artifacts, a sandbox-friendly CSP; inline-render others.
  reply.header('X-Content-Type-Options', 'nosniff');
  return reply.type(contentType(abs)).send(createReadStream(abs));
});

function contentType(p: string): string {
  const e = p.toLowerCase();
  if (e.endsWith('.pdf')) return 'application/pdf';
  if (e.endsWith('.html') || e.endsWith('.htm')) return 'text/html; charset=utf-8';
  if (e.endsWith('.png')) return 'image/png';
  if (e.endsWith('.jpg') || e.endsWith('.jpeg')) return 'image/jpeg';
  if (e.endsWith('.gif')) return 'image/gif';
  if (e.endsWith('.webp')) return 'image/webp';
  if (e.endsWith('.svg')) return 'image/svg+xml';
  if (e.endsWith('.md') || e.endsWith('.txt') || e.endsWith('.csv')) return 'text/plain; charset=utf-8';
  if (e.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

// --- WebSocket: live chat per role ---
app.get('/ws/:id', { websocket: true }, (socket, req) => {
  const id = (req.params as any).id as string;
  const role = rolesById.get(id);
  if (!role) {
    socket.send(JSON.stringify({ type: 'error', message: 'unknown role' }));
    socket.close();
    return;
  }

  const emit = (e: ServerEvent) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(e));
  };

  let session = manager.get(role, emit);
  // Sync the (re)connecting client: session id + current busy/idle state, so a
  // client reconnecting after a turn finished doesn't stay stuck on a spinner.
  session.replayState();

  socket.on('message', async (raw: Buffer) => {
    let data: any;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return emit({ type: 'error', message: 'bad json' });
    }
    switch (data.type) {
      case 'user':
        if (typeof data.text === 'string' && data.text.trim()) session.send(data.text);
        break;
      case 'interrupt':
        await session.interrupt();
        break;
      case 'new':
        session = await manager.newConversation(role, emit);
        emit({ type: 'idle' });
        break;
      default:
        emit({ type: 'error', message: `unknown message type: ${data.type}` });
    }
  });

  socket.on('close', () => {
    // Keep the session alive across reconnects; just detach the emitter.
    session.setEmit(() => {});
  });
});

// --- Static frontend (built) ---
// The frontend ships with the server, so resolve relative to the project root
// (two levels up from server/dist or server/src), independent of where
// roles.json lives. Fall back to REPO_ROOT for unusual layouts.
const here = dirname(fileURLToPath(import.meta.url)); // server/dist or server/src
const projectRoot = resolve(here, '..', '..');
const webDist = [
  resolve(projectRoot, 'web', 'dist'),
  resolve(REPO_ROOT, 'web', 'dist'),
].find((p) => existsSync(p));
if (webDist) {
  await app.register(fastifyStatic, { root: webDist, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws') || req.url.startsWith('/files')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
  });
}

const start = async () => {
  try {
    await app.listen({ host: cfg.host, port: cfg.port });
    app.log.info(`claude-mobile listening on http://${cfg.host}:${cfg.port}`);
    app.log.info(`roles: ${cfg.roles.map((r) => r.id).join(', ')}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  await manager.disposeAll();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
