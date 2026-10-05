# Nook Project Instructions

Nook is a local-only, single-user desktop job tracker: Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4, Prisma 6, and SQLite. It serves only `127.0.0.1` and has no auth, hosting, or cloud services.

## Scope

- Keep solutions local and simple; add hosting, cloud services, authentication, or deployment infrastructure only when requested.
- Desktop browser windows only. Don't add mobile or touch-specific layouts or report mobile or narrow-viewport issues unless asked.
- Don't create `README.md` or new screenshots until I approve the content: propose an outline first and wait for my OK.
- README screenshots (`docs/screenshots/*.png`): light theme, 1440×900 at 2x, reduced motion, made-up company names, taken from an isolated scratch clone (never the port-3000 app).
- For changes involving behavior (timers, undo, shortcuts, settings grouping), list in 3-5 bullets what you'll change and what you'll leave alone, and wait for my OK before editing. Layout and styling tweaks can proceed directly.

## Commands

- Node `>=24.21.0` (setup uses `node:sqlite`).
- `npm run setup`: creates `.env` from `.env.example`, then runs `prisma db push`. It also converts legacy databases (old `Application.interviewDate` column) with a rollback copy, using `prisma/interview-dates-to-copy.json` and `prisma/setup-rollback.json` as resume state.
- `npm run dev` / `npm run build` / `npm start`: bound to `127.0.0.1`, port 3000.
- `npm run db:generate` after schema edits; `npm run db:studio` to browse data.
- Typecheck: `npx tsc --noEmit` (run `npx next typegen` first if route types such as `PageProps<"/table">` are missing).
- Tests and their configs (ESLint, Playwright, test scripts) are dev-side and stay local and untracked. The last tracked versions are in `796c789^`.
- Local suites: `node scripts/local-test.mjs <suite>` (default `nonbrowser`; `e2e` runs `scripts/run-playwright.sh`). `npm run test:e2e`, named in `playwright.config.ts`, does not exist.
- ESLint and Playwright aren't in `package.json`. Install them for local lint/e2e with `npm i --no-save @playwright/test@1.63.0 eslint@9.39.5 eslint-config-next@16.3.8`; any plain `npm i`/`npm ci` prunes them again.

## Architecture

- **Schema**: `prisma/schema.prisma` is applied with `prisma db push`. `prisma/migrations/` is gitignored and unused. `DATABASE_URL` is relative to `prisma/` (default `prisma/dev.db`).
- **Pages**: `/dashboard` (plus `/analytics`, `/stale`), `/jobs` (kanban), `/table`, and `/interviews`. Each is a thin `force-dynamic` server page that renders `ApplicationPage`, which loads application summaries and hands them to the client `ApplicationDashboard` (`src/components/application-dashboard.tsx`). That component owns the client state, dialogs, toasts/undo, command palette, and shortcuts. `/` redirects to the startup page set in Settings, and unknown routes redirect to `/dashboard`.
- **Host guard**: `src/proxy.ts` (Next 16's replacement for middleware) rejects any Host other than localhost/127.0.0.1/[::1]. Security headers live in `next.config.ts`. The backup upload route is excluded from the proxy matcher and runs `checkMutationHeaders` itself.
- **Mutation routes** (`src/app/api/**`): `checkMutationRequest` (`src/lib/mutation-request.ts`) checks Host, same Origin, JSON content type, and the body size limit. Then `parseRequest` runs the Zod schema from `src/lib/*-schema.ts`. Writes run inside `serializeWrite(() => prisma.$transaction(...))`, because SQLite has one writer and the queue is capped at 64 waiters. Errors go through `apiError` (`src/lib/api.ts`), which maps contention and a full queue to 503 with `Retry-After`.
- **Optimistic concurrency**: `Application.revision` and `Settings.revision` are compared and incremented on every write (`updateMany where revision`). A mismatch returns 409 with the current record, and routes retry contention a bounded number of times.
- **History and undo**: status changes and follow-ups write `ApplicationEvent` rows (`src/lib/status-history.ts`, `src/lib/follow-up-event.ts`). Deletes store an `UndoSnapshot` with a 10-minute TTL, used by the `restore` and `bulk-restore` routes. `src/instrumentation.ts` starts snapshot cleanup and removes abandoned backup staging dirs on boot.
- **Pagination**: list endpoints return pages of 200. Client helpers in `src/lib/application-pages.ts` loop on `after` cursors, and mutation responses may omit child collections that the client then hydrates.
- **Settings**: one `Settings` row (id 1) holds a JSON string validated by `src/lib/backup-settings-schema.ts`, the same schema backups use. On the client, `src/lib/settings-store.ts` is an external store read through `useSyncExternalStore` hooks in `src/hooks/use-settings*.ts`.
- **Backup/restore**: the export is streamed by `src/workers/backup-export.worker.ts`. Import works in stages: `POST /api/applications/import/upload` streams the file into a temp dir (`nook-backup-stage-*`) through a validating worker. The client then reviews duplicates and commits with `/api/applications/import/[token]`. The format is `version: 1`, defined in `src/lib/backup-snapshot.ts`.
- **Workers**: start backup workers only through `startBackupWorker` (`src/lib/backup-staging.ts`). A bare `new Worker(...)` gets bundled by Turbopack and breaks the `.mjs` loader. `next.config.ts` `outputFileTracingIncludes` lists the worker files.
- **Dates**: calendar dates (applied, follow-up, and interview dates, stored at UTC midnight as `YYYY-MM-DD` keys) are distinct from timestamps. Use `src/lib/calendar-date.ts` and `src/lib/application-date.ts`. `Interview.time` is an optional local `"HH:MM"`.

## Conventions

- Business logic and Zod validation live in `src/lib/`, shared UI in `src/components/`, hooks in `src/hooks/`, and domain types in `src/types/`. Use the `@/` import alias.
- Two-space indent, double quotes, semicolons, strict TS, kebab-case filenames.
- Backup format changes: edit the `version: 1` schema in place (`src/lib/backup-snapshot.ts`, `src/lib/backup-settings-schema.ts`), with no Prisma migration, version migrations, legacy-format support, repairs, or defaults for missing fields. Invalid backups are rejected. Change the format in code only, never by rewriting or resetting the running app's database.
- API mutations: reuse `src/lib/mutation-request.ts` and the existing transaction patterns. Preserve revision conflict checks, status history, and undo behavior.
- Keep the light/dark/system themes and the reduced-motion behavior (`src/lib/motion-mode.ts`, `src/components/motion-preference.tsx`).

## Local Data

- The running app (port 3000) holds disposable test data. No backup is needed before adding sample data.
- Add sample data through the backup flow so it passes validation and keeps a consistent status history: `POST /api/applications/import/upload` with a `version: 1` backup body (settings from `GET /api/settings`), then `POST /api/applications/import` with the returned `{token}`. Import adds records and replaces settings, so reuse the current settings unless asked.
- Deleting or resetting the running app's data requires an explicit request.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
