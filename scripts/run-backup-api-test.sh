#!/bin/bash
set -euo pipefail

project_root=$(cd "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d /private/tmp/nook-backup-api.XXXXXX)
server_pid=
cleanup() {
  result=$?
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ "$result" -ne 0 && -f "$test_dir/server.log" ]]; then
    cat "$test_dir/server.log"
  fi
  rm -rf "$test_dir"
}
trap cleanup EXIT

mkdir "$test_dir/project"
cp -R "$project_root/src" "$project_root/prisma" "$project_root/scripts" "$test_dir/project/"
cp "$project_root/package.json" "$project_root/package-lock.json" "$project_root/next.config.ts" "$project_root/tsconfig.json" "$project_root/postcss.config.mjs" "$test_dir/project/"
ln -s "$project_root/node_modules" "$test_dir/project/node_modules"
cd "$test_dir/project"

export DATABASE_URL="file:$test_dir/audit.db"
npx prisma db push --skip-generate
test_port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
npm run dev -- --webpack -p "$test_port" > "$test_dir/server.log" 2>&1 &
server_pid=$!
ready=false
for attempt in {1..60}; do
  if curl -fsS "http://127.0.0.1:$test_port/api/applications" >/dev/null 2>&1; then ready=true; break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$test_dir/server.log"
    exit 1
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  cat "$test_dir/server.log"
  exit 1
fi
SMOKE_BASE_URL="http://127.0.0.1:$test_port" node "${1:-scripts/backup-api-test.mjs}"
