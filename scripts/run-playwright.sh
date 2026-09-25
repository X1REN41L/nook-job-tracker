#!/bin/bash
set -euo pipefail
project_root=$(cd "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d /private/tmp/nook-playwright.XXXXXX)
next_dist_dir=$(mktemp -d "$project_root/.next-playwright.XXXXXX")
cleanup() { rm -rf "$test_dir" "$next_dist_dir"; }
trap cleanup EXIT
cd "$project_root"
export DATABASE_URL="file:$test_dir/playwright.db"
export PLAYWRIGHT_NEXT_DIST_DIR="${next_dist_dir#"$project_root/"}"
export PLAYWRIGHT_PORT=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PLAYWRIGHT_PORT"
npx prisma db push --skip-generate
npx playwright test "$@"
