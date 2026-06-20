import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Expand a leading ~ to the user's home directory. */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Resolve the config file. Precedence:
 *   1. CLAUDE_MOBILE_ROLES env var (explicit path) — used by tests/deploy.
 *   2. roles.json next to the project (your real config; gitignored).
 *   3. roles.example.json (so a fresh clone still boots with sample roles).
 */
function resolveRolesPath(start: string): string {
  const envPath = process.env.CLAUDE_MOBILE_ROLES;
  if (envPath) return resolve(envPath);
  const candidates: string[] = [];
  candidates.push(resolve(process.cwd(), 'roles.json'));
  let dir = start;
  for (let i = 0; i < 6; i++) {
    candidates.push(resolve(dir, 'roles.json'));
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // then example files alongside any of the above
  for (const c of [...candidates]) candidates.push(c.replace(/roles\.json$/, 'roles.example.json'));
  for (const c of candidates) if (existsSync(c)) return c;
  return resolve(start, '..', '..', 'roles.json');
}

/** Best-effort lookup of the claude CLI when claudeExecutable is blank. */
function detectClaudeExecutable(): string {
  try {
    const p = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
    if (p && existsSync(p)) return p;
  } catch {}
  const guess = join(homedir(), '.local', 'bin', 'claude');
  return guess;
}

const ROLES_PATH = resolveRolesPath(__dirname);
export const REPO_ROOT = dirname(ROLES_PATH);

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'dontAsk';

export interface RoleConfig {
  id: string;
  name: string;
  emoji?: string;
  cwd: string;
  model?: string;
  permissionMode: PermissionMode;
  /** Optional extra text appended to the system prompt for this role. */
  systemPromptAppend?: string;
  /** null/undefined = inherit defaults (all tools). */
  allowedTools?: string[] | null;
}

export interface AppConfig {
  claudeExecutable: string;
  host: string;
  port: number;
  roles: RoleConfig[];
}

function fail(msg: string): never {
  throw new Error(`[config] ${msg}`);
}

export function loadConfig(): AppConfig {
  if (!existsSync(ROLES_PATH)) fail(`roles.json not found at ${ROLES_PATH}`);

  let raw: any;
  try {
    raw = JSON.parse(readFileSync(ROLES_PATH, 'utf8'));
  } catch (e) {
    fail(`roles.json is not valid JSON: ${(e as Error).message}`);
  }

  const claudeExecutable: string = raw.claudeExecutable
    ? expandHome(raw.claudeExecutable)
    : detectClaudeExecutable();
  if (!existsSync(claudeExecutable)) {
    fail(
      `claude CLI not found at "${claudeExecutable}". ` +
        `Set "claudeExecutable" in roles.json to its absolute path (find it with: which claude).`
    );
  }

  const host: string = raw.host ?? '127.0.0.1';
  const port: number = raw.port ?? 8787;

  if (!Array.isArray(raw.roles) || raw.roles.length === 0) {
    fail('roles must be a non-empty array');
  }

  const seen = new Set<string>();
  const roles: RoleConfig[] = raw.roles.map((r: any, i: number) => {
    if (!r.id) fail(`role[${i}] missing id`);
    if (seen.has(r.id)) fail(`duplicate role id: ${r.id}`);
    seen.add(r.id);
    if (!r.cwd) fail(`role ${r.id} missing cwd`);
    const cwd = resolve(expandHome(r.cwd));
    if (!existsSync(cwd)) fail(`role ${r.id} cwd does not exist: ${cwd}`);
    return {
      id: String(r.id),
      name: r.name ?? r.id,
      emoji: r.emoji,
      cwd,
      model: r.model,
      permissionMode: (r.permissionMode ?? 'bypassPermissions') as PermissionMode,
      systemPromptAppend: r.systemPromptAppend,
      allowedTools: r.allowedTools ?? null,
    };
  });

  return { claudeExecutable, host, port, roles };
}
