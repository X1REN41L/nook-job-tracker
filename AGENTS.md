# Nook Project Instructions

## Scope

- Nook is a local-only desktop job tracker built with Next.js, React, TypeScript, Tailwind CSS, Prisma, and SQLite. Keep solutions local and simple; add hosting, cloud services, authentication, or deployment infrastructure only when requested.
- Don't create `README.md` or new screenshots until I approve the content: propose an outline first and wait for my OK.
- Desktop browser windows only. Don't add mobile or touch-specific layouts or report mobile or narrow-viewport issues unless asked.

## Handoffs

- Handoff files: HANDOFF.md = next-session instructions and open items; STATUS.md = current state only; UPDATE.md = changelog. When I say "handoff", update the files that apply right away, without asking for approval. Otherwise leave them alone.

## Browser checks

- Never run browser checks automatically (browser or MCP browser tools, screenshots, in-browser measurements). If a layout, visual, motion, or interaction change really needs confirmation in the browser, flag it in one line and wait for my approval. Otherwise rely on typecheck, lint, and tests.
- For UI changes, name the Playwright spec that would cover the change and offer to run it. List any skipped check as unverified in the final summary.

## UI changes

- For changes involving behavior (timers, undo, shortcuts, settings grouping), list in 3-5 bullets what you'll change and what you'll leave alone, and wait for my OK before editing. Layout and styling tweaks can proceed directly.

## Implementation

- No Prisma migration for a backup-format change.
- Layout: business logic and Zod validation in `src/lib/`, shared UI in `src/components/`, hooks in `src/hooks/`, domain types in `src/types/`.
- Style: two-space indentation, double quotes, semicolons, strict TypeScript, `@/` imports for shared modules. Use `kebab-case` filenames, `PascalCase` components, and `use...` hook names; keep framework-required filenames.
- API mutations: reuse `src/lib/mutation-request.ts` and existing Prisma transaction patterns. Preserve revision conflict checks, status history, and undo behavior.
- Dates: reuse `src/lib/application-date.ts` and `src/lib/calendar-date.ts`, and keep calendar dates distinct from timestamps.
- Preserve light/dark/system themes, motion preferences, and reduced-motion behavior unless the task requires changing them.
- Open advisory SEC-05 ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)): dev-only `braces` 3.0.3 via `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` has no patched release, so `npm audit` reports 5 High entries (production audit is clean); it stays contained while `eslint.config.mjs` remains static and repository-controlled.

## Backup & Restore

- Keep `"version": 1` and edit the existing schema directly in `src/lib/backup-snapshot.ts` and `src/lib/backup-settings-schema.ts`.
- Reject invalid backups. Don't add version migrations, obsolete-format support, repairs for invalid backups, or defaults for missing fields.
- Change the backup format in code only, never by rewriting or resetting the running app's database.

## Local Data

- The user's running app (port 3000) holds disposable test data. No backup is needed before adding sample applications or other test data.
- Add sample data through the app's API so records pass the same validation and keep a consistent status history (e.g. `POST /api/applications/import` with the current settings from `GET /api/settings`). Import adds new records and replaces settings, so reuse the current settings unless asked to change them.
- Deleting or resetting the running app's data requires an explicit request.

## Validation

- Commands: `npm run typecheck`, `npm run lint`, `npm run build`. The ignored local harness runs from the repo root with `node scripts/local-test.mjs <suite>` (`all` runs unit, import-scale, setup, smoke, backup, dashboard, and contention in order).
- Run the API suites (`smoke`, `backup`, `dashboard`, `contention`) through `scripts/run-backup-api-test.sh`, which creates an isolated SQLite database and test server. Never target the user's running app.
- Start backup workers only through `startBackupWorker` (`src/lib/backup-staging.ts`). A bare `new Worker(...)` gets bundled by Turbopack and breaks the runtime loader; the `staging` suite guards this.

## Playwright

- Run only when I explicitly ask (`node scripts/local-test.mjs e2e`, alias `keyboard`, anything in `tests/e2e/`).
- It runs against a production build via `scripts/run-playwright.sh`. Don't switch back to `next dev`, and don't run long multi-route flows in dev mode.
- Tests must not rely on dev-only behavior. Use `gotoReady` in `tests/e2e/api-helpers.ts` to wait for a loaded page.
- A full run takes about 6 minutes: run it once, after the work is finished. After a failure, rerun only the affected specs (`node scripts/local-test.mjs e2e -- tests/e2e/<file>.spec.ts`).
- The full production Playwright run also runs the cross-route shortcut spec in dev mode to check hydration.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
