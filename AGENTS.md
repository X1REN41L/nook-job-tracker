# Nook Project Instructions

Nook is a local-only job tracker built with Next.js, React, TypeScript, Tailwind CSS, Prisma, and SQLite. Keep solutions local and simple; add hosting, cloud services, authentication, or deployment infrastructure only when requested.

## Implementation

- Reuse existing components, hooks, utilities, and patterns. Avoid unnecessary migrations, abstractions, dependencies, and compatibility layers.
- Keep reusable business logic and Zod validation in `src/lib/`, shared UI in `src/components/`, hooks in `src/hooks/`, and domain types in `src/types/`.
- Use two-space indentation, double quotes, semicolons, strict TypeScript, and `@/` imports for shared modules. Use `kebab-case` filenames, `PascalCase` components, and `use...` hook names; retain framework-required filenames.
- For API mutations, reuse `src/lib/mutation-request.ts` and existing Prisma transaction patterns. Preserve revision conflict checks, status history, and undo behavior.
- Reuse `src/lib/application-date.ts` and `src/lib/calendar-date.ts` for date handling; preserve the distinction between calendar dates and timestamps.
- Preserve light/dark/system themes, motion preferences, and reduced-motion behavior unless the task requires changes.

## Backup & Restore

- Keep `"version": 1` and update the existing schema directly in `src/lib/backup-snapshot.ts` and `src/lib/backup-settings-schema.ts`.
- Reject invalid backups. Do not add backup-version migrations, obsolete-format support, invalid-backup repairs, or defaults for missing backup fields.
- Never reset real application data to change the backup format.

## Validation Commands

- Typecheck, lint, build, focused/unit tests, API tests, and smoke tests are allowed. Use the scripts in `package.json` for the relevant check: `npm run typecheck`, `npm run lint`, `npm run build`.
- `npm test` runs every non-browser suite: `test:unit`, `test:import-scale`, `test:setup`, `test:smoke`, `test:backup`, `test:dashboard`, and `test:contention`.
- Unit tests (`test:unit`, `test:shortcuts`, `test:duplicates`, `test:import-scale`) load TypeScript through `scripts/unit-loader-register.mjs`, which needs the Node version in `package.json` `engines`.
- `npm run test:smoke`, `test:backup`, `test:dashboard`, and `test:contention` use `scripts/run-backup-api-test.sh`, which creates an isolated SQLite database and test server. Use this runner for API checks instead of targeting the user's running app.
- Playwright and browser tests require an explicit user request, including `npm run test:e2e` (alias `test:keyboard`) and tests in `tests/e2e/`. `scripts/run-playwright.sh` uses an isolated SQLite database and removes its `.next-playwright/` and `tsconfig.playwright.json` artifacts on exit. The user handles manual UI/browser testing; do not ask them to test the UI.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
