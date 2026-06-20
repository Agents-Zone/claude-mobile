import { ChatSocket, type Role, type ServerEvent } from './api';
import type { ChatItem } from './components/Message';

export type Status = 'connecting' | 'open' | 'closed';

/**
 * One persistent chat session per role. Lives OUTSIDE the React tree so that
 * switching roles never tears down a socket or loses message history. The
 * backend already keeps one claude-code process per role alive; this mirrors
 * that on the client so a turn in progress for Sales keeps streaming while you
 * read Marketing.
 */
export class RoleSession {
  readonly role: Role;
  items: ChatItem[] = [];
  status: Status = 'connecting';
  busy = false;
  private sock: ChatSocket;
  private listeners = new Set<() => void>();

  constructor(role: Role) {
    this.role = role;
    this.sock = new ChatSocket(
      role.id,
      (e) => this.onEvent(e),
      (s) => {
        this.status = s;
        this.emit();
      }
    );
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  private onEvent(e: ServerEvent) {
    this.items = reduce(this.items, e);
    if (e.type === 'result' || e.type === 'idle' || e.type === 'error') this.busy = false;
    this.emit();
  }

  send(text: string) {
    this.items = [...this.items, { kind: 'user', text }];
    this.busy = true;
    this.sock.send(text);
    this.emit();
  }

  interrupt() {
    this.sock.interrupt();
  }

  newConversation() {
    this.sock.newConversation();
    this.items = [];
    this.busy = false;
    this.emit();
  }

  dispose() {
    this.sock.close();
    this.listeners.clear();
  }
}

/** Global registry: one RoleSession per role id, created lazily, kept forever. */
class Store {
  private sessions = new Map<string, RoleSession>();

  ensure(role: Role): RoleSession {
    let s = this.sessions.get(role.id);
    if (!s) {
      s = new RoleSession(role);
      this.sessions.set(role.id, s);
    }
    return s;
  }
  get(roleId: string): RoleSession | undefined {
    return this.sessions.get(roleId);
  }
}

export const store = new Store();

/** Fold a server event into the message list. */
function reduce(items: ChatItem[], e: ServerEvent): ChatItem[] {
  const last = items[items.length - 1];
  switch (e.type) {
    case 'text_delta': {
      if (last && last.kind === 'assistant') {
        return [...items.slice(0, -1), { ...last, text: last.text + e.text }];
      }
      return [...items, { kind: 'assistant', text: e.text }];
    }
    case 'thinking_delta': {
      if (last && last.kind === 'thinking') {
        return [...items.slice(0, -1), { ...last, text: last.text + e.text }];
      }
      return [...items, { kind: 'thinking', text: e.text }];
    }
    case 'tool_use':
      return [...items, { kind: 'tool', id: e.id, name: e.name, input: e.input }];
    case 'tool_result': {
      const idx = items.findIndex((it) => it.kind === 'tool' && it.id === e.id);
      if (idx >= 0) {
        const t = items[idx] as Extract<ChatItem, { kind: 'tool' }>;
        const updated = { ...t, result: e.summary, isError: e.isError };
        return [...items.slice(0, idx), updated, ...items.slice(idx + 1)];
      }
      return items;
    }
    case 'result':
      if (e.costUsd != null)
        return [...items, { kind: 'meta', text: `· ${e.numTurns ?? ''} turns · $${e.costUsd.toFixed(3)}` }];
      return items;
    case 'error':
      return [...items, { kind: 'error', text: e.message }];
    default:
      return items;
  }
}
