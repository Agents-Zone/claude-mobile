import { useState } from 'react';

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; result?: string; isError?: boolean }
  | { kind: 'meta'; text: string }
  | { kind: 'error'; text: string };

export function MessageView({ item, roleId }: { item: ChatItem; roleId: string }) {
  switch (item.kind) {
    case 'user':
      return <div className="msg user">{item.text}</div>;
    case 'assistant':
      return <div className="msg assistant">{renderText(item.text, roleId)}</div>;
    case 'thinking':
      return (
        <details className="msg thinking">
          <summary>思考</summary>
          <div className="thinking-body">{item.text}</div>
        </details>
      );
    case 'tool':
      return <ToolView item={item} />;
    case 'meta':
      return <div className="msg meta">{item.text}</div>;
    case 'error':
      return <div className="msg error">{item.text}</div>;
  }
}

function ToolView({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const done = item.result !== undefined;
  return (
    <div className={`tool ${item.isError ? 'err' : ''}`}>
      <button className="tool-head" onClick={() => setOpen((v) => !v)}>
        <span className="tool-icon">{done ? (item.isError ? '✕' : '✓') : '⏳'}</span>
        <span className="tool-name">{item.name}</span>
        <span className="tool-prev">{previewInput(item.input)}</span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="tool-body">
          <pre className="tool-input">{JSON.stringify(item.input, null, 2)}</pre>
          {item.result !== undefined && <pre className="tool-result">{item.result}</pre>}
        </div>
      )}
    </div>
  );
}

function previewInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const v = o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.query;
    if (typeof v === 'string') return v.length > 50 ? v.slice(0, 50) + '…' : v;
  }
  const s = JSON.stringify(input);
  return s.length > 50 ? s.slice(0, 50) + '…' : s;
}

/** Minimal markdown-ish rendering: code fences + inline code, links left as text. */
function renderText(text: string, _roleId: string) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((p, i) => {
    if (p.startsWith('```')) {
      const body = p.replace(/^```[a-zA-Z0-9]*\n?/, '').replace(/```$/, '');
      return (
        <pre className="code" key={i}>
          {body}
        </pre>
      );
    }
    return <span key={i}>{p}</span>;
  });
}
