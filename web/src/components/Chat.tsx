import { useEffect, useReducer, useRef, useState } from 'react';
import type { Role } from '../api';
import { store } from '../store';
import { MessageView } from './Message';
import { FileBrowser } from './FileBrowser';

export function Chat({ role, onMenu }: { role: Role; onMenu: () => void }) {
  const sess = store.ensure(role);
  const [, bump] = useReducer((x) => x + 1, 0);
  const [input, setInput] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // subscribe to THIS role's session; re-render on its events
  useEffect(() => sess.subscribe(bump), [sess]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [sess.items.length, role.id]);

  function send() {
    const text = input.trim();
    if (!text) return;
    sess.send(text);
    setInput('');
  }

  return (
    <div className="chat">
      <header className="chat-header">
        <button className="icon-btn" onClick={onMenu} title="角色菜单">☰</button>
        <div className="chat-title">
          <span className="role-emoji sm">{role.emoji}</span>
          <span>{role.name}</span>
          <span className={`dot ${sess.status}`} title={sess.status} />
        </div>
        <button className="icon-btn" onClick={() => setShowFiles((v) => !v)} title="文件">
          {showFiles ? '✕' : '📁'}
        </button>
        <button className="icon-btn" onClick={() => sess.newConversation()} title="新对话">✎</button>
      </header>

      {showFiles ? (
        <FileBrowser role={role} onClose={() => setShowFiles(false)} />
      ) : (
        <div className="messages" ref={scrollRef}>
          {sess.items.length === 0 && (
            <div className="empty-hint">在 {shortCwd(role.cwd)} 里开始对话</div>
          )}
          {sess.items.map((it, i) => (
            <MessageView key={i} item={it} roleId={role.id} />
          ))}
          {sess.busy && <div className="typing">···</div>}
        </div>
      )}

      {!showFiles && (
        <div className="composer">
          <textarea
            value={input}
            placeholder="发消息…"
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
          {sess.busy ? (
            <button className="send stop" onClick={() => sess.interrupt()}>停</button>
          ) : (
            <button className="send" onClick={send} disabled={!input.trim()}>↑</button>
          )}
        </div>
      )}
    </div>
  );
}

function shortCwd(p: string) {
  return p.replace(/^\/Users\/[^/]+/, '~');
}
