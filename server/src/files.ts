import { realpathSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, relative, sep, extname } from 'node:path';
import type { RoleConfig } from './config.js';

export interface FileNode {
  name: string;
  path: string; // relative to role cwd, POSIX-ish
  isDir: boolean;
  size?: number;
  mtime?: number;
  kind?: string; // pdf | html | image | markdown | text | other
}

const IGNORE = new Set(['.git', 'node_modules', '.DS_Store', '.next', 'dist', '.cache']);

function classify(name: string): string {
  const e = extname(name).toLowerCase();
  if (e === '.pdf') return 'pdf';
  if (e === '.html' || e === '.htm') return 'html';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(e)) return 'image';
  if (e === '.md' || e === '.markdown') return 'markdown';
  if (['.txt', '.json', '.csv', '.yaml', '.yml', '.ts', '.js', '.py', '.sh', '.css'].includes(e))
    return 'text';
  return 'other';
}

/**
 * Resolve a user-supplied relative path against the role's cwd, guarding against
 * traversal AND symlink escapes (realpath both ends, require containment).
 */
export class PathEscapeError extends Error {}
export class NotFoundError extends Error {}

export function safeResolve(role: RoleConfig, relPath: string): string {
  const base = realpathSync(role.cwd);
  const target = resolve(base, relPath || '.');

  // 1. Lexical containment — rejects `..` traversal without touching the fs,
  //    so a missing file is reported as 404, not 400.
  const lexRel = relative(base, target);
  if (lexRel === '..' || lexRel.startsWith('..' + sep) || lexRel.startsWith(sep)) {
    throw new PathEscapeError('path escapes role working directory');
  }

  // 2. Symlink-escape guard — realpath whatever portion exists and re-check
  //    containment. A missing leaf is fine (NotFound handled by the caller).
  let probe = target;
  // walk up to the nearest existing ancestor
  // (resolve symlinks on the real part only)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const realProbe = realpathSync(probe);
      const probeRel = relative(base, realProbe);
      if (probeRel !== '' && (probeRel === '..' || probeRel.startsWith('..' + sep) || probeRel.startsWith(sep))) {
        throw new PathEscapeError('path escapes role working directory (via symlink)');
      }
      break;
    } catch (e) {
      if (e instanceof PathEscapeError) throw e;
      const up = resolve(probe, '..');
      if (up === probe) break;
      probe = up;
    }
  }

  return target;
}

export function listDir(role: RoleConfig, relPath: string): { dir: string; entries: FileNode[] } {
  const abs = safeResolve(role, relPath);
  const st = statSync(abs);
  if (!st.isDirectory()) throw new Error('not a directory');
  const base = realpathSync(role.cwd);
  const entries: FileNode[] = [];
  for (const name of readdirSync(abs)) {
    if (IGNORE.has(name) || name.startsWith('.')) continue;
    const full = join(abs, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    const isDir = s.isDirectory();
    entries.push({
      name,
      path: relative(base, full).split(sep).join('/'),
      isDir,
      size: isDir ? undefined : s.size,
      mtime: s.mtimeMs,
      kind: isDir ? undefined : classify(name),
    });
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return (b.mtime ?? 0) - (a.mtime ?? 0);
  });
  return { dir: relative(base, abs).split(sep).join('/'), entries };
}
