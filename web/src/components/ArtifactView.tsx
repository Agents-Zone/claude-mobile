import { useEffect, useState } from 'react';
import type { FileNode } from '../api';

export function ArtifactView({
  url,
  node,
  onBack,
}: {
  url: string;
  node: FileNode;
  onBack: () => void;
}) {
  return (
    <div className="artifact">
      <header className="artifact-header">
        <button className="icon-btn" onClick={onBack}>‹</button>
        <span className="artifact-name">{node.name}</span>
        <a className="icon-btn" href={url} target="_blank" rel="noreferrer" title="新窗口打开">⤢</a>
      </header>
      <div className="artifact-body">{render(url, node)}</div>
    </div>
  );
}

function render(url: string, node: FileNode) {
  switch (node.kind) {
    case 'pdf':
      // Browser-native PDF viewer (mobile Safari/Chrome render inline).
      return <iframe className="art-frame" src={url} title={node.name} />;
    case 'html':
      // Sandboxed: allow scripts so interactive decks work, but isolate origin.
      return (
        <iframe
          className="art-frame"
          src={url}
          title={node.name}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      );
    case 'image':
      return (
        <div className="art-image-wrap">
          <img className="art-image" src={url} alt={node.name} />
        </div>
      );
    case 'markdown':
    case 'text':
      return <TextView url={url} />;
    default:
      return (
        <div className="art-fallback">
          <p>无法预览此类型文件。</p>
          <a className="dl-btn" href={url} target="_blank" rel="noreferrer" download>
            下载 {node.name}
          </a>
        </div>
      );
  }
}

function TextView({ url }: { url: string }) {
  const [text, setText] = useState<string>('加载中…');
  useEffect(() => {
    fetch(url)
      .then((r) => r.text())
      .then((t) => setText(t.slice(0, 200_000)))
      .catch((e) => setText(`加载失败: ${e.message}`));
  }, [url]);
  return <pre className="art-text">{text}</pre>;
}
