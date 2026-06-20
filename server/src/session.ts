import { query, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { RoleConfig } from './config.js';

/**
 * Normalized events we forward to the browser. The SDK message stream is rich;
 * we flatten it into a small, stable protocol the frontend can render.
 */
export type ServerEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text'; text: string } // a complete assistant text block (fallback when no partials)
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; summary: string; isError: boolean }
  | { type: 'result'; ok: boolean; usage?: unknown; costUsd?: number; numTurns?: number; text?: string }
  | { type: 'error'; message: string }
  | { type: 'sync'; sessionId: string | null; busy: boolean }
  | { type: 'idle' };

type Emit = (e: ServerEvent) => void;

/**
 * An async queue that lets us push user messages into a live SDK query.
 * The query consumes this as its `prompt` AsyncIterable, keeping ONE
 * claude-code subprocess alive for the whole conversation (multi-turn).
 */
class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = [];
  private resolver: ((v: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(text: string) {
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    };
    if (this.resolver) {
      const r = this.resolver;
      this.resolver = null;
      r({ value: msg, done: false });
    } else {
      this.pending.push(msg);
    }
  }

  close() {
    this.closed = true;
    if (this.resolver) {
      const r = this.resolver;
      this.resolver = null;
      r({ value: undefined as any, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      if (this.pending.length > 0) {
        yield this.pending.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<SDKUserMessage>>((res) => {
        this.resolver = res;
      });
      if (next.done) return;
      yield next.value;
    }
  }
}

/**
 * Build the subprocess environment.
 *
 * We strip ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / GLM_API_KEY so the spawned
 * claude-code authenticates with your interactive claude.ai (Pro/Max)
 * subscription login instead of an API key. If you DO want to bill against an
 * API key, remove these deletes (or set the keys in the role config).
 *
 * Note: the SDK does NOT merge with process.env when `env` is provided, so we
 * spread it ourselves first.
 */
function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;
  delete env.GLM_API_KEY;
  return env;
}

function summarize(content: unknown, max = 600): string {
  let s: string;
  if (typeof content === 'string') s = content;
  else if (Array.isArray(content)) {
    s = content
      .map((b: any) => (typeof b === 'string' ? b : b?.text ?? JSON.stringify(b)))
      .join('\n');
  } else s = JSON.stringify(content);
  return s.length > max ? s.slice(0, max) + `\n…(+${s.length - max} chars)` : s;
}

/**
 * One persistent conversation for one role. Holds the live SDK query and the
 * input queue. "New conversation" = dispose() then create a fresh Session.
 */
export class Session {
  readonly role: RoleConfig;
  readonly executable: string;
  private queue = new MessageQueue();
  private q: Query | null = null;
  private emit: Emit;
  private resumeId: string | null;
  sessionId: string | null = null;
  private pumpStarted = false;
  /** True while a turn is in flight (between send and result/error). */
  busy = false;

  constructor(role: RoleConfig, executable: string, emit: Emit, resumeId: string | null = null) {
    this.role = role;
    this.executable = executable;
    this.emit = emit;
    this.resumeId = resumeId;
  }

  setEmit(emit: Emit) {
    this.emit = emit;
  }

  /**
   * Replay current state to a (re)connecting client via a dedicated `sync`
   * event (NOT the turn-lifecycle `idle`/`result`, which clients resolve on).
   * Carries the session id and whether a turn is in flight, so a client that
   * reconnects after a turn finished can clear its spinner instead of hanging.
   */
  replayState() {
    this.emit({ type: 'sync', sessionId: this.sessionId, busy: this.busy });
  }

  /** Send a user message. Lazily starts the subprocess on first send. */
  send(text: string) {
    if (!this.pumpStarted) this.start();
    this.busy = true;
    this.queue.push(text);
  }

  private start() {
    this.pumpStarted = true;
    this.q = query({
      prompt: this.queue,
      options: {
        cwd: this.role.cwd,
        pathToClaudeCodeExecutable: this.executable,
        permissionMode: this.role.permissionMode,
        ...(this.role.permissionMode === 'bypassPermissions'
          ? { dangerouslyBypassPermissions: true }
          : {}),
        model: this.role.model,
        env: buildEnv(),
        includePartialMessages: true,
        ...(this.role.allowedTools ? { allowedTools: this.role.allowedTools } : {}),
        ...(this.role.systemPromptAppend
          ? { customSystemPrompt: this.role.systemPromptAppend, appendSystemPrompt: this.role.systemPromptAppend }
          : {}),
        ...(this.resumeId ? { resume: this.resumeId } : {}),
      } as any,
    });
    this.pump().catch((e) => {
      this.busy = false;
      this.emit({ type: 'error', message: `session crashed: ${(e as Error).message}` });
      this.emit({ type: 'idle' });
    });
  }

  private async pump() {
    if (!this.q) return;
    for await (const msg of this.q as AsyncIterable<SDKMessage>) {
      this.handle(msg);
    }
  }

  private handle(msg: SDKMessage) {
    switch (msg.type) {
      case 'system': {
        if ((msg as any).subtype === 'init') {
          const sid = (msg as any).session_id;
          if (sid) {
            this.sessionId = sid;
            this.emit({ type: 'session', sessionId: sid });
          }
        }
        break;
      }
      case 'stream_event': {
        const ev = (msg as any).event;
        if (ev?.type === 'content_block_delta') {
          const d = ev.delta;
          if (d?.type === 'text_delta' && d.text) this.emit({ type: 'text_delta', text: d.text });
          else if (d?.type === 'thinking_delta' && d.thinking)
            this.emit({ type: 'thinking_delta', text: d.thinking });
        }
        break;
      }
      case 'assistant': {
        // Full assistant message: surface tool_use blocks (deltas already streamed text).
        const blocks = (msg as any).message?.content;
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            if (b?.type === 'tool_use') {
              this.emit({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
            }
          }
        }
        break;
      }
      case 'user': {
        // tool results come back as user messages with tool_result blocks
        const blocks = (msg as any).message?.content;
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            if (b?.type === 'tool_result') {
              this.emit({
                type: 'tool_result',
                id: b.tool_use_id,
                summary: summarize(b.content),
                isError: !!b.is_error,
              });
            }
          }
        }
        break;
      }
      case 'result': {
        const r = msg as any;
        if (r.session_id) this.sessionId = r.session_id;
        this.busy = false;
        this.emit({
          type: 'result',
          ok: r.subtype === 'success',
          usage: r.usage,
          costUsd: r.total_cost_usd,
          numTurns: r.num_turns,
          text: r.result,
        });
        this.emit({ type: 'idle' });
        break;
      }
    }
  }

  async interrupt() {
    try {
      await this.q?.interrupt();
    } catch {
      /* ignore */
    }
  }

  async dispose() {
    this.queue.close();
    try {
      await (this.q as any)?.return?.();
    } catch {
      /* ignore */
    }
    this.q = null;
  }
}

/** Manages one live Session per role. */
export class SessionManager {
  private sessions = new Map<string, Session>();
  constructor(private executable: string) {}

  /** Get the live session for a role, or create one. */
  get(role: RoleConfig, emit: Emit): Session {
    let s = this.sessions.get(role.id);
    if (!s) {
      s = new Session(role, this.executable, emit);
      this.sessions.set(role.id, s);
    } else {
      s.setEmit(emit);
    }
    return s;
  }

  /** Discard the current conversation and start fresh (no resume). */
  async newConversation(role: RoleConfig, emit: Emit): Promise<Session> {
    const old = this.sessions.get(role.id);
    if (old) await old.dispose();
    const s = new Session(role, this.executable, emit);
    this.sessions.set(role.id, s);
    return s;
  }

  async disposeAll() {
    for (const s of this.sessions.values()) await s.dispose();
    this.sessions.clear();
  }
}
