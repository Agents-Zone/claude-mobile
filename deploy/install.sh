#!/usr/bin/env bash
# Install claude-mobile as a launchd user agent (auto-start, restart on crash).
# Generates the plist from a template using THIS machine's paths, so nothing
# personal is hard-coded in the repo.
set -euo pipefail

LABEL="local.claude-mobile"
# Resolve repo root = parent of this script's dir.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/com.example.claude-mobile.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="$(command -v node)"

if [[ -z "$NODE_BIN" ]]; then
  echo "node not found on PATH. Install Node.js first." >&2
  exit 1
fi
if [[ ! -f "$REPO/roles.json" ]]; then
  echo "No roles.json found. Copy roles.example.json to roles.json and edit it first:" >&2
  echo "  cp '$REPO/roles.example.json' '$REPO/roles.json'" >&2
  exit 1
fi

echo "==> Building server + web"
cd "$REPO"
npm install
npm run build:web
npm --workspace server run build

echo "==> Generating launchd plist from template"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s|__NODE__|$NODE_BIN|g" \
    -e "s|__REPO__|$REPO|g" \
    -e "s|__HOME__|$HOME|g" \
    "$TEMPLATE" > "$PLIST_DST"

echo "==> Loading agent"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "==> Done. Status:"
launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|pid" || true

HOST=$(node -e "console.log(require('$REPO/roles.json').host || '127.0.0.1')")
PORT=$(node -e "console.log(require('$REPO/roles.json').port || 8787)")
echo ""
echo "Open from your phone (same Tailscale tailnet):  http://$HOST:$PORT"
echo "Logs:      ~/Library/Logs/claude-mobile.{out,err}.log"
echo "Uninstall: launchctl bootout gui/$(id -u)/$LABEL && rm '$PLIST_DST'"
