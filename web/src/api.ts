export interface Role {
  id: string;
  name: string;
  emoji?: string;
  cwd: string;
  model?: string;
}

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  kind?: string;
}

export type ServerEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; summary: string; isError: boolean }
  | { type: 'result'; ok: boolean; usage?: any; costUsd?: number; numTurns?: number; text?: string }
  | { type: 'error'; message: string }
  | { type: 'sync'; sessionId: string | null; busy: boolean }
  | { type: 'idle' };

export async function fetchRoles(): Promise<Role[]> {
  const r = await fetch('/api/roles');
  const j = await r.json();
  return j.roles;
}

export async function fetchFiles(roleId: string, path = '.'): Promise<{ dir: string; entries: FileNode[] }> {
  const r = await fetch(`/api/roles/${roleId}/files?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error((await r.json()).error ?? 'failed');
  return r.json();
}

export function fileUrl(roleId: string, path: string): string {
  return `/files/${roleId}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

// --- Review queue (App-in-Skill handoff) ---

export type Verdict = 'approve' | 'reject' | 'edit';

/** One item a skill has queued for human review (.data/current_batch.json). */
export interface BatchItem {
  id: string;
  title?: string;
  before?: string;
  after?: string;
  risk?: 'low' | 'high';
  action?: string;
}

export interface ReviewBatch {
  items: BatchItem[];
}

export interface Decision {
  itemId: string;
  verdict: Verdict;
  editedText?: string;
}

/**
 * Read the role's review batch. Reuses the read-only artifact route, so a role
 * with no queued batch simply 404s — callers treat that as "nothing to review".
 */
export async function fetchBatch(roleId: string): Promise<ReviewBatch | null> {
  const r = await fetch(fileUrl(roleId, '.data/current_batch.json'));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'failed');
  const j = await r.json();
  return { items: Array.isArray(j.items) ? j.items : [] };
}

/** Write the human's decisions back for the skill to act on. */
export async function postDecisions(roleId: string, decisions: Decision[]): Promise<void> {
  const r = await fetch(`/api/roles/${roleId}/decisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decisions }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'failed');
}

/** Thin reconnecting WebSocket wrapper for one role's chat. */
export class ChatSocket {
  private ws: WebSocket | null = null;
  private roleId: string;
  private onEvent: (e: ServerEvent) => void;
  private onStatus: (s: 'connecting' | 'open' | 'closed') => void;
  private closedByUser = false;
  private retry = 0;

  constructor(
    roleId: string,
    onEvent: (e: ServerEvent) => void,
    onStatus: (s: 'connecting' | 'open' | 'closed') => void
  ) {
    this.roleId = roleId;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.connect();
  }

  private connect() {
    this.onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws/${this.roleId}`);
    this.ws.onopen = () => {
      this.retry = 0;
      this.onStatus('open');
    };
    this.ws.onmessage = (ev) => {
      try {
        this.onEvent(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    };
    this.ws.onclose = () => {
      this.onStatus('closed');
      if (!this.closedByUser) {
        this.retry = Math.min(this.retry + 1, 6);
        setTimeout(() => this.connect(), 400 * this.retry);
      }
    };
    this.ws.onerror = () => this.ws?.close();
  }

  send(text: string) {
    this.ws?.send(JSON.stringify({ type: 'user', text }));
  }
  interrupt() {
    this.ws?.send(JSON.stringify({ type: 'interrupt' }));
  }
  newConversation() {
    this.ws?.send(JSON.stringify({ type: 'new' }));
  }
  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}
