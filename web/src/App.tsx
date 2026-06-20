import { useEffect, useState } from 'react';
import { fetchRoles, type Role } from './api';
import { store } from './store';
import { Drawer } from './components/Drawer';
import { Chat } from './components/Chat';

export function App() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRoles()
      .then((rs) => {
        setRoles(rs);
        // Eagerly create a live session for EVERY role so they all stay
        // connected in the background; switching never tears anything down.
        rs.forEach((r) => store.ensure(r));
        if (rs.length) setActiveId((cur) => cur ?? rs[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const active = roles.find((r) => r.id === activeId) ?? null;

  return (
    <div className="app">
      <Drawer
        roles={roles}
        activeId={activeId}
        open={drawerOpen}
        onPick={(id) => {
          setActiveId(id);
          setDrawerOpen(false);
        }}
        onClose={() => setDrawerOpen(false)}
      />
      {error && <div className="banner error">{error}</div>}
      {active ? (
        <Chat
          key={active.id}
          role={active}
          onMenu={() => setDrawerOpen(true)}
        />
      ) : (
        !error && <div className="empty-hint" style={{ marginTop: 80 }}>加载角色…</div>
      )}
    </div>
  );
}
