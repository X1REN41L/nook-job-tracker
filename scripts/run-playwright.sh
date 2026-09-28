#!/bin/bash
set -euo pipefail
project_root=$(cd "$(dirname "$0")/.." && pwd)
next_dist_dir="$project_root/.next-playwright"
if [[ -e "$next_dist_dir" || -e "$project_root/tsconfig.playwright.json" ]]; then
  echo "Playwright artifacts already exist; refusing to overwrite them" >&2
  exit 1
fi
test_dir=$(mktemp -d /private/tmp/nook-playwright.XXXXXX)
cleanup() { rm -rf "$test_dir" "$next_dist_dir" "$project_root/tsconfig.playwright.json"; }
trap cleanup EXIT
cd "$project_root"
cat > tsconfig.playwright.json <<'EOF'
{
  "extends": "./tsconfig.json",
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next-playwright/types/**/*.ts",
    ".next-playwright/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
EOF
export DATABASE_URL="file:$test_dir/playwright.db"
export PLAYWRIGHT_NEXT_DIST_DIR=".next-playwright"
export PLAYWRIGHT_PORT=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PLAYWRIGHT_PORT"
npx prisma db push --skip-generate
npx playwright test "$@"
