# Fix the Nook audit findings

## Summary

Fix the three confirmed findings and the inferred partial settings restore risk. Backup settings will move from browser storage to SQLite so an import can commit applications and settings in one transaction. Existing browser preferences will be ignored after the change; SQLite settings will start from defaults, as requested.

## Implementation

- **Validate version 1 boards strictly.** Replace the unknown board array with a schema that accepts either `[]` (the server's default export) or all five statuses exactly once in their chosen order. Require valid status, color, label, and empty text; reject missing or extra fields, blank or overlong text, duplicates, and partial arrays. Preserve valid values exactly on export and import.
- **Check saved status against typed history.** In application snapshot validation, compare `application.status` with the final status when the history has an initial event and a fully typed, consistent sequence. Keep accepting genuinely incomplete legacy history, including unknown transitions.
- **Make settings part of the database transaction.** Add a single SQLite settings record containing the validated version 1 settings and a revision. `GET /api/settings` will return settings and revision; `PATCH /api/settings` will accept validated changes with an expected revision and return the committed state or a conflict. The import route will validate everything before writing, then import records and replace settings in its existing Prisma transaction. Export will read the stored settings.
- **Use database settings throughout the UI.** Provide the stored settings at page load and update the shared client state only after successful API writes. Move theme, motion, boards, startup page, thresholds, and backed-up sidebar preferences off browser storage; keep sidebar width local because it is outside the backup format. Replace the current browser-persisted theme behavior with a database-backed provider that still responds to system theme changes. Refresh settings from SQLite when returning to a tab. Remove the separate settings application step from the import hook.
- **Repair the smoke suite.** Assert that `/login` redirects to `/dashboard` and that `/dashboard` loads, while retaining the later CRUD and persistence assertions.

## Validation

- Extend isolated backup API tests for malformed board entries, duplicate or missing statuses, customized board round trips, status/history mismatch rejection, and valid incomplete legacy history.
- Test settings updates, revision conflicts, export of stored settings, and an import failure that leaves both applications and settings unchanged. Add a focused check that unavailable browser storage cannot cause a partial restore.
- Run the full isolated smoke suite, focused API suites, typecheck, lint, and build. Do not run Playwright or browser tests under the repository's testing instructions.

## Assumptions

- Backup format remains JSON version `1`; invalid files are rejected without repair or missing-field defaults.
- Existing SQLite application data stays in place. The repository's `prisma db push` setup adds the settings table; no application data reset is needed.
- "All or nothing" means persisted applications and backed-up settings commit together in SQLite. Browser rendering updates from the committed result and is not a second persistence step.
