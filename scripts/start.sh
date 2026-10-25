#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f dist/server/index.js ]; then
  echo "还没有构建。请先运行: pnpm install && pnpm build"
  exit 1
fi
exec node dist/server/index.js
