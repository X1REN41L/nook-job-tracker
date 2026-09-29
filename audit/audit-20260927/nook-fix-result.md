# Nook audit fix result

## Outcome

Implemented the findings in [nook-fix-plan.md](nook-fix-plan.md). Backup JSON remains version `1`. Settings now persist in SQLite and import with applications in one Prisma transaction. The existing local database was subsequently removed at the user's request; no replacement database has been created.

## Changes

### Backup validation

- `src/lib/backup-settings-schema.ts` now validates board entries with exact `status`, `color`, `label`, and `emptyText` fields. Boards must be either an empty array, which represents defaults, or an array containing all five statuses exactly once. Invalid colors, missing or extra fields, blank or overlong text, duplicate statuses, and partial arrays fail validation. Valid order and text are preserved.
- `src/lib/backup-snapshot.ts` now checks an application's saved status against the final possible status of a complete, typed status history. A genuinely incomplete legacy history, including an unknown transition, remains importable.
- The version `1` format remains strict. Invalid backups are rejected without repairing values or supplying missing fields.

### SQLite settings and APIs

- `prisma/schema.prisma` adds one `Settings` record with a JSON value and integer revision.
- `src/lib/settings-defaults.ts` defines the initial settings, and `src/lib/database-settings.ts` reads and validates the stored value.
- `GET /api/settings` returns `{ settings, revision }`. `PATCH /api/settings` validates changes and an expected revision, writes the committed settings, and returns the new state. A stale revision returns HTTP `409` with the current state.
- `POST /api/applications/import` validates the entire backup before writing. It creates applications and replaces settings inside the same Prisma transaction. A validation error or application ID conflict leaves both unchanged. The response includes the committed settings and revision.
- `GET /api/applications/export` includes the settings read from SQLite rather than substituting browser values or defaults.

### Client settings

- `src/lib/settings-store.ts` holds the shared client settings state. It updates state after successful API writes, serializes local settings writes, and ignores older refresh results. Settings refresh when the tab becomes visible or receives focus.
- The root layout reads settings at request time. Its theme script applies the stored light, dark, or system choice before hydration. The database backed theme provider continues to react to system color scheme changes.
- General preferences, board configuration, motion, startup page, stale threshold, and backed-up sidebar preferences now use the shared settings state. Only sidebar width remains in browser storage because it is outside the backup format. Existing browser preferences are ignored.
- Backup export uses the server response as received. After a successful import, the dashboard applies the settings returned by the committed transaction; the import hook no longer performs a separate settings restore.
- The startup redirect refreshes settings before choosing its destination.

### Smoke suite and focused tests

- The smoke suite now expects `/login` and the legacy `/api/auth/session` path to redirect to `/dashboard`, and verifies that `/dashboard` loads. Its CRUD, persistence, and history assertions remain.
- The isolated backup API suite now covers malformed boards, duplicate or missing statuses, customized board order and values, saved status versus typed history, incomplete legacy history, settings updates, revision conflicts, export of stored settings, and failed restore atomicity.
- The motion unit test now verifies that effective motion follows database settings even when browser storage is unavailable.

## Validation performed

| Check | Result |
| --- | --- |
| `npm run test:backup` with isolated SQLite | Passed |
| `npm run test:smoke` with isolated SQLite | Passed |
| `bash scripts/run-backup-api-test.sh scripts/dashboard-api-test.mjs` | Passed |
| `node --test scripts/motion-preference-test.mjs` | Passed: 2 tests |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed; routes render dynamically where settings are needed |
| `git diff --check` | Passed |

The first backup API run failed because a new test fixture omitted `archived`; the fixture was corrected and the suite passed. The first smoke run found another outdated `404` expectation for `/api/auth/session`; that expectation was corrected and the suite passed. The first build compiled but failed while prerendering `/_not-found` against the old local database, which did not have the new table. The root layout was made dynamic, and the build passed. Playwright and browser tests were not run, as required by the repository instructions.

## Local database state

After implementation and validation, the user requested removal of the existing database. Before deletion, `prisma/dev.db` passed SQLite integrity checking, contained the `Application`, `ApplicationEvent`, and `UndoSnapshot` tables, and had no WAL or shared memory sidecar files. No running Nook server was found. A SQLite backup was created and passed integrity checking at:

`/private/tmp/nook-dev-db-before-removal-20260927.XXXXXX.db`

`prisma/dev.db` was then removed and verified absent. The application will need a fresh database schema before it can run against that path. The repository's existing `npm run setup` invokes `prisma db push` to create the database and the new `Settings` table. That setup was not run after deletion.
