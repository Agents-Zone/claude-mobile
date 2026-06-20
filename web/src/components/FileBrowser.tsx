import { useEffect, useState } from 'react';
import { fetchFiles, fileUrl, type FileNode, type Role } from '../api';
import { ArtifactView } from './ArtifactView';

export function FileBrowser({ role, onClose }: { role: Role; onClose: () => void }) {
  const [path, setPath] = useState('.');
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<FileNode | null>(null);

  useEffect(() => {
    setError(null);
    fetchFiles(role.id, path)
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e.message));
  }, [role.id, path]);

  if (viewing) {
    return (
      <ArtifactView
        url={fileUrl(role.id, viewing.path)}
        node={viewing}
        onBack={() => setViewing(null)}
      />
    );
  }

  const parent = path === '.' ? null : path.split('/').slice(0, -1).join('/') || '.';

  return (
    <div className="filebrowser">
      <div className="fb-path">
        <span>📁 /{path === '.' ? '' : path}</span>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="fb-list">
        {parent !== null && (
          <button className="fb-item dir" onClick={() => setPath(parent)}>
            <span className="fb-icon">↩</span>
            <span className="fb-name">..</span>
          </button>
        )}
        {entries.map((e) => (
          <button
            key={e.path}
            className={`fb-item ${e.isDir ? 'dir' : ''}`}
            onClick={() => (e.isDir ? setPath(e.path) : setViewing(e))}
          >
            <span className="fb-icon">{iconFor(e)}</span>
            <span className="fb-name">{e.name}</span>
            {!e.isDir && <span className="fb-size">{fmtSize(e.size)}</span>}
          </button>
        ))}
        {entries.length === 0 && !error && <div className="empty-hint">空目录</div>}
      </div>
    </div>
  );
}

function iconFor(e: FileNode): string {
  if (e.isDir) return '📂';
  switch (e.kind) {
    case 'pdf':
      return '📄';
    case 'html':
      return '🌐';
    case 'image':
      return '🖼️';
    case 'markdown':
      return '📝';
    default:
      return '📃';
  }
}

function fmtSize(n?: number): string {
  if (n == null) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}
