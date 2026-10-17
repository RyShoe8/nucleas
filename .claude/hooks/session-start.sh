#!/bin/bash
set -euo pipefail

# Only needed in Claude Code on the web, where the container starts without node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
# Commits are authored as the repo owner, never as Claude: Vercel only deploys commits from team members.
git config user.name "RyShoe8"
git config user.email "30275036+RyShoe8@users.noreply.github.com"
# --no-save: install what the lockfile says without rewriting package.json or package-lock.json.
npm install --no-save --no-audit --no-fund
