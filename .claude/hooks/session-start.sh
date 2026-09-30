#!/bin/bash
set -euo pipefail

# Only needed in Claude Code on the web, where the container starts without node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund
