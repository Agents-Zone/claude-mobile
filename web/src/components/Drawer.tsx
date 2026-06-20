import { useEffect, useReducer } from 'react';
import type { Role } from '../api';
import { store } from '../store';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

export function Drawer({
  roles,
  activeId,
  open,
  onPick,
  onClose,
}: {
  roles: Role[];
  activeId: string | null;
  open: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  // re-render when any role session status/busy changes (live dots + indicators)
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const unsubs = roles.map((r) => store.get(r.id)?.subscribe(bump)).filter(Boolean) as (() => void)[];
    return () => unsubs.forEach((u) => u());
  }, [roles]);

  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onClose} />
      <nav className={`drawer ${open ? 'open' : ''}`}>
        <div className="drawer-head">角色</div>
        <div className="drawer-list">
          {roles.map((r, i) => {
            const sess = store.get(r.id);
            return (
              <button
                key={r.id}
                className={`drawer-item ${r.id === activeId ? 'active' : ''}`}
                style={{ ['--accent' as any]: COLORS[i % COLORS.length] }}
                onClick={() => onPick(r.id)}
              >
                <span className="di-emoji">{r.emoji ?? '🤖'}</span>
                <span className="di-text">
                  <span className="di-name">{r.name}</span>
                  <span className="di-cwd">{shortPath(r.cwd)}</span>
                </span>
                <span className="di-status">
                  {sess?.busy && <span className="di-busy" title="生成中">●</span>}
                  <span className={`dot ${sess?.status ?? 'connecting'}`} />
                </span>
              </button>
            );
          })}
        </div>
        <div className="drawer-foot">点角色切换 · 各角色对话互不中断</div>
      </nav>
    </>
  );
}

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/Users\/Shared/, '@shared');
}
