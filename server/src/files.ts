import { realpathSync, statSync, readdirSync, mkdirSync, lstatSync } from 'node:fs';
import { resolve, join, relative, sep, extname, dirname } from 'node:path';
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

/**
 * Resolve a write target inside a role cwd. Used by the decision write-back
 * endpoint — the ONLY HTTP path that writes into a role cwd, and only ever to a
 * fixed relative path the server controls (never raw user input).
 *
 * safeResolve alone is NOT sufficient for writes: it was built for the read
 * path, and a dangling leaf symlink (e.g. `.data/decisions.json -> ../evil`
 * whose target does not yet exist) slips past its realpath check — realpath
 * throws ENOENT on the missing target, the guard walks up to the in-cwd parent
 * and passes, and then writeFileSync would FOLLOW the symlink out of the cwd.
 * So here we additionally lstat the leaf and refuse to write through a symlink.
 */
export function safeResolveForWrite(role: RoleConfig, relPath: string): string {
  const abs = safeResolve(role, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  // No-follow guard: if the target already exists and is a symlink, refuse —
  // writing would follow it, potentially escaping the cwd. A regular file is
  // fine (overwrite in place); a missing target is fine (fresh create).
  try {
    if (lstatSync(abs).isSymbolicLink()) {
      throw new PathEscapeError('refusing to write through a symlink');
    }
  } catch (e) {
    if (e instanceof PathEscapeError) throw e;
    // ENOENT — target doesn't exist yet, safe to create.
  }
  return abs;
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
