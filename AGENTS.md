# Repository Guidelines

## Project Structure & Module Organization

Nook is a Next.js, React, and TypeScript job application tracker. `src/app/` contains the page, layout, styles, and `/api/applications` routes. Put reusable UI in `src/components/`, interaction hooks in `src/hooks/`, shared logic in `src/lib/`, and domain types in `src/types/`. The SQLite schema and migrations live in `prisma/`. Browser tests are in `tests/e2e/`; focused Node test scripts are in `scripts/`.

## Build, Test, and Development Commands

Use Node.js 20.9 or newer. Run `npm install`, copy `.env.example` to `.env`, then run `npm run db:generate` and `npm run db:migrate` to prepare a local database. `npm run dev` starts the development server at `localhost:3000`; `npm run build` creates a production build, and `npm run start` serves it. Run `npm run lint` for ESLint and `npm run typecheck` for TypeScript checks.

## Coding Style & Naming Conventions

Follow the existing two-space indentation, double-quoted strings, semicolons, and TypeScript strict mode. Use `kebab-case` filenames such as `application-dashboard.tsx`, `PascalCase` React components, and `use...` names for hooks. Import shared modules through the `@/` alias. Keep API validation and reusable business rules in `src/lib/`; follow the existing Next.js and TypeScript ESLint configuration in `eslint.config.mjs`.

## Testing Guidelines

Playwright specs use `tests/e2e/*.spec.ts`; run them with `npm run test:keyboard` (the script runs the full Playwright suite). Use `npm run test:duplicates` for duplicate matching and `npm run test:smoke` for API smoke tests against a running app. Add focused tests for changed behavior. Browser tests can create application records, so use an isolated SQLite database when testing changes that touch stored data. No numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

Recent commits use short, imperative subjects, sometimes with `fix:` or `refactor:` prefixes. Keep commits scoped to one change. In pull requests, describe the user-facing change, note relevant commands and results, link an issue when applicable, and include screenshots for visible UI changes. Mention schema migrations and configuration changes explicitly.

## Configuration & Data Safety

Keep `.env` and local SQLite data out of commits. `DATABASE_URL` in `.env.example` points to `file:./dev.db` relative to the Prisma schema. Review migrations before applying them to a database with real applications.
