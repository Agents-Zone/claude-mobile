# Claude Mobile

A phone-friendly web client for driving `claude-code` running on your own
machine, over a private network (e.g. [Tailscale](https://tailscale.com)). Your
phone talks only to your machine; the Anthropic credentials never leave it and
the server is never exposed to the public internet.

> Built for personal use on a home machine reachable over Tailscale. It is
> intentionally single-user and trusts whoever can reach the port. Read the
> Security section before exposing it anywhere.

## Features

- **Multiple roles** — each role has its own working directory. A role's skills
  and slash commands come from the `.claude/` directory inside its `cwd`, so
  each role behaves like its own project.
- **Drawer menu** — tap ☰ for a slide-in list of all roles with live status.
- **Non-blocking role switching** — every role keeps its own live session, so a
  turn running for one role keeps streaming while you read another.
- **Multi-turn continuity** — one long-lived `claude-code` process per role,
  resumed across turns.
- **New conversation** — one tap (✎) discards the current session and starts fresh.
- **Artifact rendering** — a built-in file browser renders PDF / HTML / images /
  Markdown produced in a role's working directory, right on your phone.
- **Voice input** — just use your phone keyboard's dictation; it works in the
  message box like any web input.

## Architecture

```
Phone browser (React)
   │  HTTP + WebSocket, over your private network
   ▼
Node backend (Fastify, TypeScript)
   ├─ GET  /api/roles            role list
   ├─ WS   /ws/:id               streaming chat (one live session per role)
   ├─ GET  /api/roles/:id/files  working-dir file tree (read-only, guarded)
   └─ GET  /files/:id/*          artifact serving
        │  one Claude Agent SDK session per role, isolated by cwd
        ▼
   Anthropic / claude.ai  (credentials stay on this machine only)
```

**Driver**: [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
streaming-input mode keeps one process alive per role and `resume` continues the
same session across turns.

**Authentication**: by default the backend strips `ANTHROPIC_API_KEY`,
`ANTHROPIC_BASE_URL`, and `GLM_API_KEY` from the subprocess environment so the
spawned `claude-code` uses your interactive **claude.ai (Pro/Max) subscription**
login instead of an API key. To bill against an API key instead, remove those
deletes in `server/src/session.ts`.

## Setup

Requires Node.js 20+ and the `claude` CLI installed and logged in
(`claude` once interactively to authenticate).

```bash
git clone https://github.com/Agents-Zone/claude-mobile.git
cd claude-mobile
npm install
cp roles.example.json roles.json   # then edit roles.json (see below)
```

### Configure roles

Edit `roles.json` (gitignored — your working directories never get committed):

```json
{
  "claudeExecutable": "",
  "host": "0.0.0.0",
  "port": 8787,
  "roles": [
    {
      "id": "project-a",
      "name": "Project A",
      "emoji": "🚀",
      "cwd": "~/projects/project-a",
      "model": "opus",
      "permissionMode": "acceptEdits"
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `claudeExecutable` | Absolute path to the `claude` binary. Leave `""` to auto-detect via `which claude`. |
| `host` | Interface to bind. Use your private-network IP (e.g. your Tailscale IP) to avoid listening on the public internet, or `127.0.0.1` for local-only. |
| `port` | Port to listen on. |
| `cwd` | Role working directory (must exist). `~` is expanded. |
| `permissionMode` | `acceptEdits` (auto-approve edits) / `default` / `bypassPermissions` (no checks at all — see Security) / `dontAsk`. |
| `model` | `opus` / `sonnet` / omit for default. |
| `systemPromptAppend` | Optional text appended to the system prompt. |
| `allowedTools` | Optional tool allowlist; omit for all. |

Restart the server after editing `roles.json`.

## Run

### Development

```bash
# terminal 1 — backend
npm run dev:server
# terminal 2 — frontend (hot reload, proxies to the backend)
npm run dev:web    # open http://<your-host>:5173 from your phone
```

### Production (always-on, macOS)

```bash
bash deploy/install.sh
```

Installs a launchd user agent (`local.claude-mobile`) that starts at login and
restarts on crash. The installer generates the plist from your machine's paths.
Then open `http://<your-host>:<port>` from your phone.

```
Logs:      ~/Library/Logs/claude-mobile.{out,err}.log
Uninstall: launchctl bootout gui/$(id -u)/local.claude-mobile \
           && rm ~/Library/LaunchAgents/local.claude-mobile.plist
```

To keep the service reachable, the host machine must stay awake (disable
automatic sleep) — when it sleeps it drops off the network.

## Security

This is a single-user tool that trusts whoever can reach its port. Defaults
assume a private network (Tailscale) with no extra auth.

- Bind `host` to a private-network interface; do **not** put it on a public IP
  without adding your own authentication and TLS.
- File serving enforces a `realpath` containment check — `..` traversal and
  symlink escapes out of a role's `cwd` are rejected.
- HTML artifacts render inside a sandboxed `iframe`.
- `permissionMode: "bypassPermissions"` lets the model run **any** command in
  that role's working directory with no confirmation. Only use it for roles
  whose `cwd` you're comfortable handing full control of. `acceptEdits` is a
  safer default.
- There is no built-in login. If multiple people share your private network, add
  a token check before exposing it.

## Tests

`test/regression.mjs` is a self-contained regression suite. It boots an isolated
server instance on a test port with a temporary config (never touching your real
role directories) and cleans up afterward.

```bash
npm run test:static   # static tier: deterministic, no LLM calls, free (CI-friendly)
npm run test:live     # live tier: drives real claude-code (slower, costs tokens)
npm test              # both
```

- **Static tier**: typecheck, web build, bad-config rejection, `/api/roles`,
  file tree, frontend serving, artifact serving (incl. multibyte/NFC filenames),
  path traversal → 400, missing file → 404, unknown `/api` → 404, client route →
  SPA fallback.
- **Live tier**: WS connect, streaming, result with usage, **cwd isolation**
  (a relative write lands inside the role dir, never leaks to `$HOME`),
  **multi-turn continuity** (same session id; turn 2 understands "that same
  file"), new-conversation reset.

The suite locates its config via the `CLAUDE_MOBILE_ROLES` env var, which is also
how you override the config path in deployment.

## Roadmap / not yet implemented

- Codex adapter (the config layer can grow an `engine` field).
- Session-history browsing UI.
- Inline HTML rendering inside the chat stream (currently only working-directory
  files are rendered).

## License

MIT
