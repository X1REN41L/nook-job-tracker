# Nook remediation: fix report (2026-09-28)

This report covers the completed sessions of `audit-remediation.md`:

| Session | Phases | State |
|---|---|---|
| 1 | 1.0 (TEST-007 runner), 1A (SEC-001, SEC-002), 1B (BAK-001) | Committed as `dea6986` |
| 2 | 2A (ARCH-001, DATA-002, CLEAN-002 bounds) | Implemented and verified; **not committed yet** (see [Session 2](#session-2-phase-2a-arch-001--data-002--clean-002-bounds)) |

---

# Session 1

Session 1 of `audit-remediation.md`: **Phase 1.0 (TEST-007 runner) + 1A (SEC-001, SEC-002) + 1B (BAK-001)**.

- **Base:** `5f74723` (the audited commit; the tree was clean).
- **Result:** committed as `dea6986` "fix: address high-risk audit findings". That is one commit, where the plan allowed three. It changes 9 files: +166 / −24.
- **Status:** all three phases are done. Every required check is green, and each new test was shown to fail against the unfixed code.

| Finding | Severity | Status after Session 1 |
|---|---|---|
| SEC-001 | High | **Fixed**, with a regression test in `smoke-test.mjs` |
| SEC-002 | Low | **Fixed**: limiter removed; the body-size cap is now authoritative, with a regression test in `backup-api-test.mjs` |
| BAK-001 | High | **Fixed**: (a), (b) and (c) all implemented, with regression tests in `backup-api-test.mjs` |
| TEST-007 | Low | **Runner part fixed.** The screenshot part is still open (Phase 4). |
| TEST-005 | Medium | **Partly closed**: both High findings now have tests. The unit gaps are still open (Phase 3). |

---

## Baseline (before any change)

The baseline was run on the clean tree at `5f74723`:

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run test:backup` | pass |
| `npm run test:smoke` | pass |

---

## 1.0: TEST-007 (runner)

**Change:** `scripts/run-backup-api-test.sh` now copies only `prisma/schema.prisma`, not the whole `prisma/` directory.

```sh
mkdir -p "$test_dir/project/prisma"
cp -R "$project_root/src" "$project_root/scripts" "$test_dir/project/"
cp "$project_root/prisma/schema.prisma" "$test_dir/project/prisma/"
```

**Checked first:** `prisma/` contains only `dev.db` and `schema.prisma`, and there is no `prisma.config.*`. The runner sets `DATABASE_URL` to its own temp DB and runs `prisma db push`, so it needs nothing else.

**Verified:** a watcher polled `/private/tmp/nook-backup-api.*/project/prisma/` every 0.5 s during a full `test:backup` run.
- It polled 31 times and never saw `dev.db`.
- A 72-poll run across both `test:backup` and `test:smoke` also saw nothing.
- No `nook-backup-api.*` directory was left after any run.

---

## 1A: SEC-001 + SEC-002

### Changes

- **`src/lib/allowed-host.ts` (new):** `isAllowedHost(host)` accepts only `localhost`, `127.0.0.1` and `[::1]`, with an optional port. The match is case-insensitive and anchored: `/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i`.
  - The port is deliberately not checked, because `run-backup-api-test.sh` and `run-playwright.sh` pick random ports.
  - A missing Host is rejected.
- **`src/proxy.ts`:**
  - Returns `403 {"error":"Host is not allowed"}` for any disallowed Host.
  - The matcher is widened from `/api/:path*` to `/((?!_next/static|_next/image|favicon.ico).*)`, so it covers every page and API route and excludes only static assets.
  - The Origin check in `mutation-request.ts` is unchanged.
- **SEC-002 decision: the rate limiter was removed**, not scoped to mutations.
  - It was one process-global bucket, not a per-client one. Any local page (or a rebinding page) could use it to lock the UI out of every API call for up to a minute.
  - Once Host is enforced, it gave no protection the Host check doesn't already give.
- **`next.config.ts`:** sets `experimental.proxyClientMaxBodySize: MAX_BACKUP_FILE_BYTES + 1024 * 1024`. This is 11 MiB, imported from `src/lib/backup-limits.ts`.
  - **Why not 10 MB + 1 byte:** that value was tried first, and the new test caught it failing. In Next 16.3.5 `getCloneableBody` (`next/dist/server/body-streams.js`), when the buffer limit is crossed, Next **drops the whole crossing chunk** and ends the stream. The route therefore always sees fewer bytes than the limit. With a limit of 10 MB + 1, an 11 MB chunked body reached the route under 10 MB and failed JSON parsing (400).
  - **How the fix works:** the headroom must be larger than one socket chunk (≤ 64 KB). With 1 MiB of headroom, any body over 10 MB still reaches the route with more than 10 MB, so the route returns its own 413.
- **Documentation read first**, as AGENTS.md requires:
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`;
  - the `proxyClientMaxBodySize` config page (`middlewareClientMaxBodySize` is deprecated in favour of it);
  - `next/dist/server/config-schema.js`, which confirmed that the option exists in 16.3.5.

### Tests added

**`scripts/smoke-test.mjs`.** These use a new `hostRequest()` helper built on `node:http`, because `fetch` cannot override Host. Requests always connect to 127.0.0.1 and send a spoofed Host, plus a matching Origin for mutations. The disallowed Hosts are:
- `evil.test:<port>`
- `localhost.evil.test:<port>`
- `127.0.0.1.evil.test:<port>`
- `evil.test` (no port)

For each of them:
- `GET /api/applications/export` returns 403, and the body does not contain the test record.
- `GET /dashboard` returns 403, and the body does not contain the test record.
- `PATCH /api/settings` returns 403. It carries the current revision and a real theme change, so without the fix it would return 200.
- `DELETE /api/applications/purge` with body `{}` returns 403.

After those requests:
- the application count is unchanged (1);
- `GET /api/settings` is deep-equal to its value before the requests.

The allowed Hosts are `localhost:<port>`, `127.0.0.1:<port>` and `[::1]:<port>`. For each, export returns 200 and contains the record, and `/dashboard` returns 200.

**`scripts/backup-api-test.mjs`:** a chunked `POST /api/applications/import` of 11 × 1 MiB with no Content-Length returns **413**, and no records are created. The existing Content-Length case still returns 413.

---

## 1B: BAK-001

### Changes

- **(a) Structural restore schema** (`src/lib/backup-snapshot.ts`): `applicationRestoreSnapshotSchema` is now a separate strict schema covering field types only.
  - It uses its own `storedTimestamp` and `storedEventSchema`.
  - It does not run the history `superRefine` or the per-event transition checks.
  - It does not share `applicationSnapshotSchema`'s field rules, so ARCH-001's stricter import rules will not reach undo-restore.
  - `revision` is now required, where it used to be `.default(0)`. The server always stores it in the snapshot payload.
  - `src/app/api/applications/[id]/restore/route.ts` needed no change.
- **(b) Monotonic event time** (`src/lib/status-history.ts`): `nextStatusEventTime(latestEventAt, now = new Date())` returns `max(now, latestEventAt + 1 ms)`.
  - `updateApplication` in `src/app/api/applications/[id]/route.ts` reads the latest event's `createdAt` inside the same serializable transaction and uses the helper.
  - PATCH (status) and PUT share that path, so there is one call site.
  - CALC-001 (Phase 2C) can build on the helper.
- **(c) Future-dated import rejection** (`src/lib/backup-snapshot.ts`): `backupSnapshotSchema` gets a top-level `superRefine` that rejects any event whose `createdAt` is after the time of parsing. It reports the error at `applications[i].events[j].createdAt` with the message "Event time must not be in the future". This is a rejection, not a repair.
  - It sits on the backup schema, not on `applicationSnapshotSchema`, so `canonicalSnapshot()` does not apply it to stored rows.
  - The client import worker (`src/workers/backup-import.worker.ts`) uses the same schema, so it rejects these files before upload.
- `"version": 1` is unchanged. There is no migration, no defaults for missing fields, and no repair of invalid backups.

### Tests added (`scripts/backup-api-test.mjs`)

Import now rejects future-dated events, so the bad states are seeded directly through Prisma on the runner's temp DB.

1. **Clock skew, which tests (b):**
   - Seed a record whose initial event is 1.5 s in the future.
   - `PATCH status: INTERVIEW` returns 200. The new event sorts **after** the initial one (`[[null,"APPLIED"],["APPLIED","INTERVIEW"]]`, strictly increasing `createdAt`).
   - Wait until both events are in the past, then export → purge (200, count 0) → import the export: **201**.
   - The export after the import is deep-equal to the one before it.
2. **Out-of-order stored history, which tests (a):**
   - Seed a record at `INTERVIEW`, revision 3, whose `APPLIED→INTERVIEW` event is dated an hour *before* its initial event.
   - Import still **rejects** that record's export (400), which confirms the state is invalid by the import rules.
   - `DELETE ?undoable=1` returns 200, then restore returns **201**.
   - Status, revision (3), and every event's id, type, from/to status, detail, emailSnippet and createdAt are identical to before the delete.
3. **Future-dated import, which tests (c):** a record whose only event is dated one day ahead returns **400**, with the issue path `applications[0].events[0].createdAt`. No record is created.

The suite's "Passed:" line now ends with: `chunked size limit, clock-skewed status events, out-of-order undo restore, future-dated import rejection`.

---

## Verification

These ran on the final code, which is the content of `dea6986`.

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (0 warnings) |
| `npm run test:backup` | pass: "Passed: version 1 backup round trip, …, chunked size limit, clock-skewed status events, out-of-order undo restore, future-dated import rejection." |
| `npm run test:smoke` | pass: "Passed: no-login routing, CRUD, all status moves, SQLite persistence, event history, validation, and cascade deletion." |
| `npm run build` | pass. The build prints `proxyClientMaxBodySize: 11534336` and `ƒ Proxy (Middleware)`. |

### Each new test fails against the unfixed code

These ran on a `git archive HEAD` copy of `5f74723` in the scratchpad, using the new runner and new test scripts. The fixes were applied one layer at a time. The copy was deleted afterwards.

| Run | Code under test | First failure (expected) |
|---|---|---|
| N1 | HEAD, smoke test | `Export must reject Host evil.test:<port>`: SEC-001 reproduced |
| N0 | HEAD + 1A, with the first 10 MB + 1 byte limit (first verification run) | `Chunked bodies over 10 MB must reach the route's own size limit`. A limit under route limit + one chunk truncates the body just as HEAD's default 10 MB does, so this reproduces SEC-002's truncation. HEAD itself was not run separately for this test. |
| N2 | HEAD + 1A | `A new status event must sort after the latest existing event`: BAK-001 (b) |
| N3 | HEAD + 1A + (b) | restore returns 400: `An initial status event must be first` / `Saved status must match the final status in history`. This is BAK-001 (a). |
| N4 | HEAD + 1A + (b) + (a) | the future-dated import is accepted instead of returning 400: BAK-001 (c) |

### Data safety

- **`prisma/dev.db`:** 53248 B, mtime 2026-09-27 11:46, sha256 `416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`. This is **identical to the audit baseline**; the file was never opened.
- No test targeted the user's running app. Every API run used `run-backup-api-test.sh` with its own temp DB.
- No `/private/tmp/nook-backup-api.*` directories remain. The scratch scripts and logs are in the session scratchpad only.

---

## Problems hit during the session (and resolved)

1. **The body limit was one byte over the route limit.** This is the `proxyClientMaxBodySize` issue described above. It was caught by the new chunked-body test and fixed by adding 1 MiB of headroom.
2. **The first `dev.db` watcher was invalid.** A zsh glob with no match (`nomatch`) killed the polling loop, so its "0 sightings" proved nothing. It was rewritten with a null-glob (`(N)`) and a poll counter, which gave the 31 and 72 polls above.
3. **The first future-import fixture was malformed.** It lacked `archived`, so the schema rejected it for the wrong reason (`applications[0].archived`). `archived: false` was added, and the test now fails and passes for the intended reason (N4).

---

## Behaviour changes and caveats

- **Access is now local-only by Host.** Opening Nook through a LAN IP, a custom `/etc/hosts` name or a reverse proxy with a different Host returns 403. Neither was supported before.
- **The API has no rate limit** (SEC-002 decision).
- **A backup exported on a machine whose clock ran ahead** is rejected until that time passes. The plan listed this as a known behaviour risk.
- **Pre-existing out-of-order histories.** These can only exist if future-dated events were imported before this fix.
  - Undo-delete now preserves them.
  - Exporting and re-importing them is still rejected (400), because the history is invalid by the import rules. Per AGENTS.md, no repair was added.
  - Also, if such a record exists and a backup containing the same ID is imported, the import's `canonicalSnapshot()` comparison runs the strict schema on the stored row and returns 400 rather than 409. This was left alone because it is outside BAK-001's scope. **Resolved in Session 2**: the comparison now reads stored rows with the field-types-only schema, and a regression test asserts 409.

---

## Not done in Session 1 (per the plan)

- **TEST-007:** Playwright screenshots in fixed `/private/tmp` paths (Phase 4).
- **TEST-005:** the unit-level gaps (Phase 3).
- **No client or UI changes, and no Playwright runs.**

---

# Session 2: Phase 2A (ARCH-001 + DATA-002 + CLEAN-002 bounds)

- **Base:** `dea6986` (Session 1).
- **Result:** implemented and verified, **not committed**. It changes 5 files and adds 1: +157 / −28, plus the new `src/lib/application-api-path.ts`.
- **Status:** Phase 2A is complete. Every required check is green, and the new tests were shown to fail against the unfixed code. Phase 2B was not started.

| Finding | Severity | Status after Session 2 |
|---|---|---|
| ARCH-001 | Medium | **Fixed**, with regression tests in `backup-api-test.mjs` |
| DATA-002 | Low | **Fixed**, with regression tests in `smoke-test.mjs` |
| CLEAN-002 | Low | **Bounds added**, with regression tests in `backup-api-test.mjs`. `NOTE_ADDED` and `emailSnippet` are kept, as the plan recommends. |
| TEST-005 | Medium | **Further closed**: ARCH-001 and DATA-002 now have API tests. The unit gaps are still open (Phase 3). |

## ARCH-001: shared field validators

### Changes

- **`src/lib/application-schema.ts`** now exports the rules that import uses for stored values. Each one checks a value exactly as Nook stores and exports it, and never trims or converts it:

  | Export | Rule |
  |---|---|
  | `recordIdSchema` | `^[A-Za-z0-9_-]{1,64}$` (used for event IDs) |
  | `applicationIdSchema` | `recordIdSchema`, and also not `export`, `import` or `purge` |
  | `storedCalendarDateSchema` | exactly `YYYY-MM-DDT00:00:00.000Z`; the date part must pass `parseCalendarDateKey` from `calendar-date.ts` |
  | `storedRequiredText(max)` | non-empty, at most `max` characters, already trimmed (company, role) |
  | `storedOptionalText(max)` | `null`, or the same rule as required text (source, notes) |
  | `storedJobUrlSchema` | `null`, or trimmed, at most 2,000 characters, a valid URL, `http:`/`https:` only |
  | `eventTextSchema` | `null`, or at most `MAX_EVENT_TEXT_LENGTH` (5,000) characters (event `detail` and `emailSnippet`) |

  - The form URL rule (`optionalUrl`) and `storedJobUrlSchema` share one `isHttpUrl` function and message, so the two can't drift apart again.
  - The app's own form and PATCH validators are otherwise unchanged. They still trim input and turn `""` into `null`.
- **`src/lib/backup-snapshot.ts`:** `applicationSnapshotSchema` and the event schema are built from these exports.
  - The old `z.string().trim()` on company and role is gone. Import now **rejects** padded text instead of quietly trimming it.
  - Real timestamps stay offset-tolerant. `createdAt`, `lastUpdated` and event `createdAt` still use `z.iso.datetime({ offset: true })`, renamed from `date` to `timestamp` so it isn't confused with calendar dates.
  - `"version": 1` is unchanged. There is no migration, no repair and no defaults for missing fields.
  - The restore schema from BAK-001 (`applicationRestoreSnapshotSchema`) was **not** changed and does not use the new rules.
- **Client URLs:**
  - `src/lib/application-api-path.ts` (new) has `applicationApiPath(id, action?)`, which applies `encodeURIComponent` to the ID.
  - All 5 `fetch` calls in `src/components/application-dashboard.tsx` use it: PUT, the undoable DELETE, the status/archive PATCH, the interview-date PATCH and restore.

### `canonicalSnapshot` and older stored rows

- **Before:** the import duplicate check ran `applicationSnapshotSchema.parse` on the stored row. A row stored under older rules (an out-of-order history, `""` text, a `javascript:` URL, a non-midnight date) threw a `ZodError`. The import then returned **400** before conflict detection could run.
- **After:** `canonicalSnapshot()` reads both sides with `storedComparisonSchema`, which is `applicationRestoreSnapshotSchema.omit({ revision: true })` and checks field types only.
  - The incoming record has already passed the strict import schema by then.
  - A stored older row that differs from the incoming record now gets **409** with its ID in `conflicts`.
  - An identical record is still skipped. The regression test checks this with a full round trip.
- Stored data is never repaired or rewritten.

## DATA-002: strict create and status schemas

- `applicationInputSchema` (POST) and `applicationStatusSchema` (the status branch of PATCH) are now `.strict()`.
- **Checked first that no client sends extra keys:**
  - `JobFormState` and `blankForm()` have exactly the 8 schema fields. The dashboard's client-side `applicationInputSchema.safeParse(form)` therefore still passes.
  - The status PATCH bodies (move, undo, interview-date save and skip) send only `revision`, `status`, `archived`, `interviewDate` and `interviewDatePromptDismissed`.
  - `dashboard-api-test.mjs`, `backup-api-test.mjs`, `smoke-test.mjs` and the Playwright fixtures in `tests/e2e/` send only schema fields.
- Unknown keys are reported as `Unrecognized field` at the key's path, the same as PUT, archive, settings and import.

## CLEAN-002: bounds

- Imported event `detail` and `emailSnippet` are limited to 5,000 characters. They used to be unbounded, and 2 MB strings were accepted.
- `NOTE_ADDED`, `emailSnippet` and `detail` stay in the Prisma schema and in the v1 backup format.

## Tests added

**`scripts/backup-api-test.mjs`:**
- **Rejection table:** 23 non-conforming imports built from a valid record, each required to return 400 at the expected issue path. The loop collects every failure before asserting, so one run reports all of them. The cases:
  - **Dates:** `appliedDate` of `2026-10-01T00:00:00+06:00`, `2026-10-01T15:45:00.000Z`, `2026-10-01T00:00:00Z` and `2026-02-30T00:00:00.000Z`; `interviewDate` of `2026-10-05T00:00:00+06:00`.
  - **Job URL:** `javascript:…`, `data:text/html,…`, `ftp://…`, `not a url`, `"  https://…  "` and `""`.
  - **Text:** `source: ""`, `source: " Referral"`, `notes: "   "` and `company: " Padded company"`.
  - **IDs:** `a/b`, `x?undoable=1`, 65 characters, `export`, `purge`, and an event ID of `event/1`.
  - **Event text:** a `NOTE_ADDED` event with a 5,001-character `detail`, and one with a 5,001-character `emailSnippet`.
  - After the table, the application count is unchanged.
- **Accepted values:** a fully populated record imports with **201**. It has a source, notes, an `https` URL with a query, midnight dates, `+06:00` timestamps, and a `NOTE_ADDED` event with 5,000-character `detail` and `emailSnippet`.
  - The stored `createdAt` is `2026-09-24T01:00:00.000Z`, which confirms timestamps still accept offsets.
  - Its export re-imports with **201** (skipped as identical).
- **Older stored row:** a row seeded through Prisma with `source ""`, `notes "   "`, a `javascript:` URL, a non-midnight `appliedDate` and an out-of-order history. Importing a conforming record with the same ID returns **409** with that ID in `conflicts`.
- The existing round trip (export → delete → import → export deep-equal) still passes.

**`scripts/smoke-test.mjs`:** each of these returns **400**, names the key with `Unrecognized field`, and creates no record:
- POST with `foo`;
- POST with `id: "chosen-id"`;
- status PATCH with `company: "Injected"`;
- status PATCH with `archived: true, foo: 1`.

## Verification

### Each new test fails against the unfixed code

These ran on a `git archive HEAD` copy of `dea6986` in the session scratchpad, with the new test scripts copied in and the runner's isolated temp DB.

| Run | First failure (expected) |
|---|---|
| `backup-api-test.mjs` | `Non-conforming import values must be rejected`: **22 of 23** cases returned 201. Only `2026-02-30T00:00:00.000Z` was already rejected, by `z.iso.datetime`. |
| `smoke-test.mjs` | `POST with unknown key foo must be rejected` (201 !== 400) |
| Older-row probe (scratch script) | Import of a conforming record whose ID matches an older stored row returned **400** `events[1].fromStatus: An initial status event must be first`, instead of 409 |

### On the final code

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run test:backup` | pass: "Passed: version 1 backup round trip, …, future-dated import rejection, shared import field rules, legacy-row conflict detection." |
| `npm run test:smoke` | pass: "Passed: no-login routing, CRUD, all status moves, SQLite persistence, event history, validation, and cascade deletion." |
| `npm run test:duplicates` | pass |
| Dashboard API suite (`bash scripts/run-backup-api-test.sh scripts/dashboard-api-test.mjs`) | pass |
| `npm run build` | pass |

### Data safety

- **`prisma/dev.db`:** 53248 B, mtime 2026-09-27 11:46:19, the same before and after every run. It was checked with `stat` only; it was never opened, queried, copied or hashed in this session.
- No test targeted the user's running app.
- No `/private/tmp/nook-*` directories remain.

## Deviations from the plan, and open items

- **Reserved IDs (a small addition to the plan).** The plan's pattern accepts `export` and `purge`. The audit listed those as IDs the UI cannot edit, move or delete, because `/api/applications/<id>` resolves to the static route. `applicationIdSchema` also rejects `export`, `import` and `purge`. Event IDs never appear in URLs, so they use only the pattern.
- **One Playwright test will now fail (not run, not changed).** The near-10 MB fixture in `tests/e2e/backup-import-limits.spec.ts` uses `appliedDate: new Date().toISOString()` (not midnight) and a 9.5 MB event `detail`. Both are now rejected by the server and by the client import worker. The fixture needs another way to reach about 9.5 MB within the new bounds. This belongs in Phase 4, which is where Playwright work happens.
- **Your own backup may no longer re-import.** Records imported under the old rules can hold values the new schema rejects. Your own export of them would then fail to re-import. The plan's suggested check hasn't been done yet: export once from the UI, then validate that file against the new schema with a scratch script that reads only that file, never `dev.db`. It needs your approval.
- **Union error reporting (unchanged, cosmetic).** An extra key on a status PATCH that has no `archived` field is reported through the archive branch of the union. The issues then include `archived` (missing) alongside the `Unrecognized field`. The status is correctly 400.

## Not done in Session 2 (per the plan)

- DATA-001 and BAK-003 (Phase 2B), and CALC-001 and DATE-001 (Phase 2C).
- No Playwright runs or Playwright infrastructure changes, no React/UI/accessibility changes, no removal of compatibility fields, no migrations and no manual UI testing.

---

## Repository state when this report was written

- `HEAD` is `dea6986` (Session 1). `audit/` is gitignored, so this report is not part of any commit.
- Uncommitted Session 2 changes:

  ```
   M scripts/backup-api-test.mjs
   M scripts/smoke-test.mjs
   M src/components/application-dashboard.tsx
   M src/lib/application-schema.ts
   M src/lib/backup-snapshot.ts
  ?? src/lib/application-api-path.ts
  ```

## Next

- Optionally, validate one UI export against the new schema before committing Session 2 (see the open items above).
- Commit Session 2.
- Session 3 is **Phase 2B: DATA-001 + BAK-003**.

---

# Session 3: Phase 2B (DATA-001 + BAK-003)

- **Base:** `589dfc2` (Sessions 1 and 2 committed). The preceding Session 2 repository-state paragraph above is historical; this section records the current state.
- **Result:** Phase 2B is implemented and verified. No Phase 2C work, migrations, `.env` edits, Playwright runs, manual UI tests, or commits were made.

## Root causes and implementation

### DATA-001

- The applications list GET and `ApplicationPage` each ran `undoSnapshot.deleteMany()` before reading. A write lock held by import could therefore make a read or page render fail. Removed those cleanup calls from `src/app/api/applications/route.ts` and `src/components/application-page.tsx`.
- Cleanup remains on delete and restore, but `cleanupExpiredUndoSnapshots()` now catches and logs failures so maintenance cannot prevent the requested operation. Restore still checks `held.expiresAt <= new Date()` inside its transaction and returns 404 for an expired token, independently of cleanup.
- `apiError()` recognizes Prisma `P1008`, `P2034`, relevant `P2028` transaction expiry/closure messages, SQLite busy/locked messages, and socket timeout messages. Temporary contention returns 503, a retry message, and `Retry-After: 1`. Unrelated internal errors remain 500.
- Concurrent same-revision PATCHes exposed a second part of the root cause: each transaction read the row before trying to update it, allowing competing read transactions to block the winning write. `updateApplication()` now reads the row before opening the transaction, then makes the revision-guarded `updateMany()` its first transaction operation. If the revision changed, it returns the existing 409 conflict with the current row. The status event and final read remain in the same transaction as the successful update. Transient contention is retried up to six attempts; an exhausted attempt returns 503.
- Import maps validated backup applications and events before entering the transaction. It checks conflicts and occupied event IDs, then uses `createMany` for applications and events in the same transaction as the settings upsert. It reads the inserted applications back in input order for the existing response shape. Settings write failure still rolls back all inserted rows. No backup-version or schema change was made.

### BAK-003

- `readSettings()` now logs malformed JSON or schema-invalid persisted settings and returns defaults with the stored revision. It does not rewrite the row. The same parser lets settings PATCH use defaults as its base and overwrite a corrupt row when the request carries the current revision.
- Export can return a valid v1 backup with default settings and all applications even when the stored settings value is corrupt.
- Request JSON and request schema errors are explicitly marked in `parseMutationJson()` and `parseRequest()`, so those still return 400. A server-side `SyntaxError` or `ZodError` no longer becomes a client request error; it returns 500 if it reaches `apiError()`.

## Files changed

- Application code: `src/lib/api.ts`, `src/lib/mutation-request.ts`, `src/lib/database-settings.ts`, `src/lib/undo-snapshots.ts`, `src/app/api/applications/route.ts`, `src/app/api/applications/[id]/route.ts`, `src/app/api/applications/[id]/restore/route.ts`, `src/app/api/applications/import/route.ts`, `src/app/api/settings/route.ts`, `src/components/application-page.tsx`.
- Tests: `scripts/backup-api-test.mjs` updated; `scripts/contention-api-test.mjs` added.
- Report: `audit/audit-20260928/audit-fix.md` (gitignored).

## Regression coverage and old-behavior evidence

- The new contention test runs only through `scripts/run-backup-api-test.sh` on its isolated temporary SQLite database. During a 2,000-record import, list and dashboard GETs return 200. Five concurrent same-revision PATCHes return one 200 and four 409s; the final revision is 1 with two status events. It also checks corrupt-row export (200), settings repair PATCH (200), no rewrite on read, list/page reads leaving an expired snapshot alone, expired restore (404), and a held-write-lock settings PATCH (503 with `Retry-After: 1`). The final run reported `importMs: 3760` and all of those expected statuses.
- `backup-api-test.mjs` replaces the cleanup-on-load assertion with reads that leave an expired snapshot untouched and a restore that rejects it. It also covers both malformed JSON and schema-invalid settings, page availability, export, repair, and no rewrite on read. Its existing forced settings-write failure continues to verify atomic import rollback.
- Against temporary `git archive` source at `589dfc2`, the new contention test failed as intended: same-revision PATCH statuses were `409, 500, 500, 500, 500, 500, 409, 200`; server logs identified SQLite socket timeouts and an expired transaction. The 2,000-record import completed in about 3.9 seconds there, so its list and page GETs both returned 200; this test run did not reproduce the old GET failure because the write lock was shorter than the timeout.
- A separate old-source probe on another isolated runner database recorded `expiredSnapshotsAfterList: 0`, corrupt-row export 400, corrupt-row settings PATCH 400, and dashboard 500. Both 400s incorrectly said `Request body must be valid JSON`. The scratch checkout and probe were removed after recording the results.

## Verification

| Command | Final result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run test:backup` | pass; expiry enforcement and corrupt-settings recovery included |
| `npm run test:smoke` | pass |
| `bash scripts/run-backup-api-test.sh scripts/contention-api-test.mjs` | pass; 2,000 import, GETs 200, PATCHes 200/409, export/repair, expired restore 404, held-lock PATCH 503 with retry header |
| `node scripts/import-scale-test.mjs` | pass; 5,000 records, 8,211 ms, longest batch 251 ms. This script checks the client duplicate index at scale; the 2,000-record API import is covered by the new contention test. |
| `git diff --check` | pass |

## Problems, plan assumptions, and expected behavior

- The first contention fixture omitted required `archived`; import correctly rejected all 2,000 rows with 400. The fixture was corrected before drawing contention conclusions.
- An initial transaction change that only retried socket timeouts still produced 503s under eight-way PATCH contention, and a later five-way run exposed Prisma `P2028` (“Transaction not found”) as another temporary transaction failure. Moving the read before the transaction and classifying the relevant `P2028` messages resolved the final regression. Under heavy concurrent load, retries can still take substantial time; exhausted retries return 503 rather than a generic 500.
- A seven-second held write lock ended before a settings PATCH timed out; that PATCH returned 200 after waiting. A 16-second hold exercised the 503 and `Retry-After` path. The plan's expected lock/timeout threshold was therefore not a fixed five seconds for every Prisma operation.
- The approved plan said export should no longer depend on settings. The v1 backup format requires a settings object, so export still reads the row but substitutes defaults when its value is corrupt. It remains dependent on the database read itself. This is the interpretation used for BAK-003.
- Checked the installed Prisma 6.12 client/source and local package documentation before considering busy-timeout changes. No verified local support for the proposed SQLite URL setting was found, so no timeout configuration or `.env` change was made.
- Read-only requests no longer delete expired undo snapshots. Cleanup during mutation is best-effort. Expired tokens remain unusable even if cleanup fails. Corrupt settings now appear as defaults until repaired by PATCH; reading or exporting does not alter the stored row. Request-caused validation stays 400; transient database contention uses 503; internal validation/parsing errors use 500.
- Deferred work remains Phase 2C (CALC-001 and DATE-001), plus the earlier Session 2 backup-compatibility caveat and later planned phases. No such work was started here.

## Data safety and final repository state

- `prisma/dev.db` was not queried or mutated; it was read only for the integrity hash. Its size is **53,248 bytes**, mtime epoch **1790487979**, and SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`**, unchanged from the pre-session baseline. API tests used the runner's isolated temporary databases. The temporary old-source checkout was removed.
- Final `git status -sb`:

  ```text
  ## main...origin/main [ahead 2]
   M scripts/backup-api-test.mjs
   M src/app/api/applications/[id]/restore/route.ts
   M src/app/api/applications/[id]/route.ts
   M src/app/api/applications/import/route.ts
   M src/app/api/applications/route.ts
   M src/app/api/settings/route.ts
   M src/components/application-page.tsx
   M src/lib/api.ts
   M src/lib/database-settings.ts
   M src/lib/mutation-request.ts
   M src/lib/undo-snapshots.ts
  ?? scripts/contention-api-test.mjs
  ```

**Session 3 / Phase 2B is complete.**

---

# Session 4: Phase 2C (CALC-001 + DATE-001)

- **Base:** Sessions 1–3 are committed; this session has no commit. Only Phase 2C was changed.
- **Result:** CALC-001 and DATE-001 are fixed and verified. No migration, historical-data repair, Playwright run, manual UI test, or Phase 3 work was done.

## Root causes and implementation

### CALC-001

The client previously undid a status move by sending a normal status PATCH back to the previous status. PATCH correctly appended a real status event, so the undone move still counted as an offer/interview/rejection milestone and reset the stale clock.

- The status PATCH now returns `latestStatusEventId` when it creates a transition. The client records that ID and the resulting revision in the undo toast, along with the previous archived, interview-date and prompt-dismissed values.
- New `POST /api/applications/[id]/undo-status` validates the JSON request through the existing mutation guard and a strict schema. It checks the move's revision and latest status-event ID. In a serializable transaction it increments the revision, verifies that the expected event is still the latest status event and matches the current status, deletes that event, and restores the event's `fromStatus` plus the previous archived, interview-date and prompt state. It returns the updated application. A revision or event mismatch returns the existing 409 shape with the current application. An event mismatch rolls the transaction back, so neither the event nor the revision changes.
- Status-move undo uses this route. Archive-only undo continues through PATCH. No compensating status event is added. Existing reverse events in stored histories are not repaired.

### DATE-001

The analytics query built its exclusive upper bound by adding a day, slicing `toISOString()` to a date key, and parsing that key again. For `9999-12-31`, the key becomes `+010000-01`, which reparses as an invalid date. Direct `Date.UTC` arithmetic produces a valid year 10000 JavaScript Date, but Prisma 6.12 rejects its extended ISO timestamp. The final query uses `Date.UTC` to select the last millisecond of `9999-12-31` as an inclusive bound for that boundary only. Other periods keep an exclusive upper bound computed from UTC date parts; years 0000–0099 use the existing `dateFromParts` helper because `Date.UTC` interprets those years as 1900–1999. The custom-month weekly bucket calculation also stops at the last day rather than stepping into year 10000. Normal month/year ranges and milestone calculations are unchanged.

## Files changed

- Application code: `src/app/api/applications/[id]/route.ts`, new `src/app/api/applications/[id]/undo-status/route.ts`, `src/components/application-dashboard.tsx`, `src/hooks/use-toast-undo.ts`, `src/lib/application-api-path.ts`, `src/lib/application-schema.ts`, `src/lib/dashboard-analytics.ts`.
- Regression tests: `scripts/dashboard-api-test.mjs`.
- Report: `audit/audit-20260928/audit-fix.md` (gitignored).

## Regression coverage and old-behavior evidence

- The dashboard API test creates an application with an aged initial event, moves it to OFFER while changing archived/interview-date/prompt state, then undoes it. It asserts the added event is gone, original event IDs and status/state are restored, revision increases, offer-rate numerator returns to its prior value, and stale-list membership returns. It also checks that an incorrect event ID returns 409 without deleting the event or changing the application, and that an intervening archive mutation returns 409 with the current application while retaining the event.
- The same suite checks `CUSTOM_YEAR&year=9999` and `CUSTOM_MONTH&month=9999-12` return 200 with the expected range; its existing ordinary custom month/year and early-year assertions still pass.
- Against a temporary `git archive HEAD` copy of the pre-Phase-2C source and an isolated runner database, the updated dashboard test failed at `assert.ok(movedForUndo.latestStatusEventId)` because the old PATCH returned no event ID. A separate pre-change API probe recorded **500** for both year 9999 requests, where the new assertions require 200. The temporary checkout was removed.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `bash scripts/run-backup-api-test.sh scripts/dashboard-api-test.mjs` | pass; all dashboard API assertions, including Phase 2C cases |
| `npm run test:smoke` | pass; CRUD/status PATCH response behavior directly affected |
| `git diff --check` | pass |

The API suites used the runner's isolated SQLite databases. `test:backup` was not run because backup/restore behavior was not changed. No Playwright or manual UI testing was performed.

## Problems, plan assumptions, and behavior

- The first dashboard run passed the new undo assertions but left its fixture in the database, breaking an older exact application-count assertion. The fixture is now deleted before the older cases run.
- The first year-boundary implementation used a year 10000 exclusive bound. JavaScript accepted it, but Prisma rejected the timestamp and returned 500. The plan's assumption that safe `Date.UTC` arithmetic alone would be sufficient was therefore incorrect. The last millisecond of year 9999 is the inclusive database bound for that case. The month bucket loop also needed to stop before producing a year 10000 key.
- One test fixture initially sent an ISO interview timestamp to the new undo route; the request schema correctly requires a `YYYY-MM-DD` calendar date. The fixture now sends the date key, matching the client.
- A successful status undo now removes only the latest move event and restores the previous state with one revision increment. A later application change, or a different latest event ID, returns 409 and leaves history intact. Archive-only undo remains a PATCH. Historical reverse events remain as stored; later phases and unrelated analytics/business-logic findings are deferred.

## Data safety and final repository state

- `prisma/dev.db` was not opened or changed by tests. Its post-session size **53,248 bytes**, mtime epoch **1790487979**, and SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`** match the pre-session values.
- Final `git status -sb`:

  ```text
  ## main...origin/main [ahead 3]
   M scripts/dashboard-api-test.mjs
   M src/app/api/applications/[id]/route.ts
   M src/components/application-dashboard.tsx
   M src/hooks/use-toast-undo.ts
   M src/lib/application-api-path.ts
   M src/lib/application-schema.ts
   M src/lib/dashboard-analytics.ts
  ?? src/app/api/applications/[id]/undo-status/
  ```

**Session 4 / Phase 2C is complete.**

---

# Session 5 / Phase 3 — Unit regression net

## Findings and root causes

- **TEST-004:** unit files each used their own `typescript.transpileModule`, `new Function`, data-URL imports, or source-string import rewriting. The settings and motion tests supplied a fake module for any unrecognized import, so a changed dependency could be hidden.
- **TEST-003:** interview grouping, motion preference, settings store, import scale, dashboard API, and contention API checks had no package script or aggregate test path. `test:keyboard` actually launched the full Playwright suite.
- **TEST-005 (unit portion):** backup snapshot validation, status-history ordering, analytics period boundaries, and calendar-date behavior lacked direct unit coverage. Existing API tests still provide the end-to-end coverage of the Session 1–4 fixes.

## Loader, migration, and scripts

- Added `scripts/unit-loader-register.mjs` and `scripts/unit-loader.mjs`. Node 26's native TypeScript stripping loads `.ts` sources. One synchronous `registerHooks` resolve hook maps `@/` to `src/` and resolves extensionless relative imports within `src/` to existing `.ts` files. All other imports use Node's normal resolver; missing imports raise `ERR_MODULE_NOT_FOUND`. No TypeScript transpiler or test framework was added.
- Migrated `duplicate-match-test.mjs`, `import-scale-test.mjs`, `interviews-grouping-test.mjs`, `keyboard-shortcuts-test.mjs`, `motion-preference-test.mjs`, and `settings-store-test.mjs` to real source imports. The setup test needs no source loader and remains on Node's native test runner.
- Motion tests now exercise stored Motion settings and OS media preference without the obsolete localStorage failure scenario. The shortcut test checks unique shortcut IDs and actual labels, routes, and scope behavior instead of asserting exactly 21 definitions.
- Added `test:unit`, `test:import-scale`, `test:dashboard`, `test:contention`, and `test:e2e`; `test:keyboard` is a compatibility alias for `test:e2e`. Updated `test:shortcuts` and `test:duplicates` to use the loader. `npm test` runs unit, import scale, setup, smoke, backup, dashboard, and contention suites in sequence; it excludes Playwright.

## New direct unit coverage and regression evidence

- `backup-snapshot-test.mjs`: complete and legacy status histories, duplicate initial and disconnected transitions, detail/status mismatch, equal timestamps, future event rejection, stored field rules, v1 settings validation, restore of stored rows, and canonical event ordering.
- `status-history-test.mjs`: monotonic timestamps when the clock is behind or equal to the latest event, sorted history analysis, equal-time ambiguity, and the milestone trail after a status move is removed by undo.
- `analytics-period-test.mjs`: current and custom periods, leap month, month/year rollover, year 9999, and early-year date construction.
- `calendar-date-test.mjs`: leap-year rules, invalid dates, month/year and week boundaries, timezone conversion around DST, and time-zone validation. It passes under the process default, `America/New_York`, and `Asia/Dhaka` time zones.
- Each of the four new test files was run against its own deliberately broken **scratch copy** of its source module, without editing application code. All four runs failed with assertion errors: backup snapshot 3 failures, status history 1, analytics period 2, calendar date 2. Scratch copies were removed. The loader was also checked with a nonexistent `@/` import and raised `ERR_MODULE_NOT_FOUND`.
- The Session 4 year-9999 query bug lives in `dashboard-analytics.ts`, beyond `analytics-period.ts`. The new period unit test guards period range construction; the existing dashboard API test guards the actual query and passed. Thus the plan's implication that a pure period unit test alone could catch the complete Session 4 regression was too broad.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run test:unit` | pass: 28 main tests plus 3 New York and 3 Dhaka calendar tests |
| `npm run test:shortcuts` | pass: 4 tests; migrated loader path |
| `npm run test:duplicates` | pass; migrated loader path |
| `npm run test:dashboard` | pass; isolated runner database |
| `npm run test:contention` | pass; 2,000-record isolated import, concurrent PATCH, lock and settings checks |
| `npm test` | pass: unit, import scale (5,000 records), setup (4 tests), smoke, backup, dashboard, contention; no Playwright |
| `git diff --check` | pass |

## Problems, behavior, and deferred work

- The first loader version rewrote relative imports inside React's CommonJS package. That made `useSyncExternalStore` unavailable in the test process. The hook now handles relative imports only for project `src/` modules; the affected tests pass with the real React package.
- A first scratch regression probe outside the repository could not resolve the repository's packages, and one mutation search string did not match the source. The probe was corrected to use a temporary project-local directory and exact source strings; all four assertion failures were then observed. Both scratch directories were removed.
- Node emits `MODULE_TYPELESS_PACKAGE_JSON` warnings while loading `.ts` ESM under the package's current module setting. They do not fail tests, and changing the package module mode was outside this phase.
- Expected application behavior changes: none. Test commands and test expectations changed as described above. Playwright infrastructure, UI/accessibility findings, and later remediation phases remain deferred. No Playwright or manual UI test ran; no migration or real-database operation ran.

## Data safety and final repository state

- `prisma/dev.db` remained **53,248 bytes**, mtime epoch **1790487979**, SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`**, matching the pre-session fingerprint. API and setup tests used temporary databases.
- Final `git status -sb`:

  ```text
  ## main...origin/main [ahead 4]
   M package.json
   M scripts/duplicate-match-test.mjs
   M scripts/import-scale-test.mjs
   M scripts/interviews-grouping-test.mjs
   M scripts/keyboard-shortcuts-test.mjs
   M scripts/motion-preference-test.mjs
   M scripts/settings-store-test.mjs
  ?? scripts/analytics-period-test.mjs
  ?? scripts/backup-snapshot-test.mjs
  ?? scripts/calendar-date-test.mjs
  ?? scripts/status-history-test.mjs
  ?? scripts/unit-loader-register.mjs
  ?? scripts/unit-loader.mjs
  ```

`audit/audit-20260928/audit-fix.md` is gitignored but was updated in place. No commit was created.

**Session 5 / Phase 3 is complete.**

---

# Session 6 / Phase 4 — Playwright infrastructure

## Findings, causes, and infrastructure changes

- **TEST-002:** `run-playwright.sh` created a new `.next-playwright.*` build directory on every invocation. Installed Next 16.3.5's `writeConfigurationDefaults` appends the dist directory's `types/**/*.ts` and `dev/types/**/*.ts` globs to the tsconfig file it receives. This left six committed random pairs in `tsconfig.json` and caused new tracked-file mutations on every run. The runner now uses one fixed `.next-playwright` directory and creates an ignored `tsconfig.playwright.json` that extends the real config and includes the fixed type paths. `next.config.ts` selects this file with `typescript.tsconfigPath` only for the Playwright environment. The installed Next function returns early when the selected config has `extends`; its installed TypeScript guide confirms custom `tsconfigPath` applies to `next dev`. The six stale pairs were removed from the real config, which now excludes `.next-playwright`. `.gitignore` and ESLint `globalIgnores` cover the fixed build directory and generated config, retaining the old random-directory ignore for historical artifacts. The runner refuses to overwrite pre-existing artifacts and removes its own build directory, generated config, and isolated SQLite directory on exit.
- **TEST-008 / TEST-004 (touched selectors):** every spec imports a shared Playwright `test` fixture. Before and after each test it purges applications and resets settings to source defaults through `GET /api/settings` and revision-checked `PATCH /api/settings` with the required same-origin `Origin` header. This removes cross-test application and SQLite-backed settings leakage, including failures after a timed-out test. Browser tests continue to use the runner's isolated SQLite database; no test targets the real database. Specs that need non-default settings call `resetSettings(request, overrides)`, and settings assertions read the API. Sidebar width remains in localStorage because the current component still reads and writes `nook-sidebar-width` there.
- **TEST-008:** Job Board tests now open `/jobs` directly. A dedicated test checks that `/` redirects to each configured startup page. The first cold Next compile exceeded the default URL assertion timeout, so that redirect test allows the compilation to complete while retaining the URL assertion. The old dashboard sidebar “Recent applications” assertions and removed “applications total” copy were replaced with current Job Board counts, dashboard previews, and route checks. The obsolete partial-import-on-localStorage-failure test was removed: import and settings restore are atomic under the earlier R3 fix. Backup import's sidebar setting test now seeds and verifies SQLite settings through the API. The interview-date Undo test now checks the Phase 2C `POST /undo-status` operation and payload. Settings keyboard order now includes Startup Page, Stale Application Threshold, and Delete All Data. Current sidebar selectors, 50 px collapsed rail geometry, and sidebar width change event are reflected in the tests.
- **TEST-001:** the grouping case freezes the browser clock at Monday 2026-09-28 with Playwright `page.clock.setFixedTime`, then checks Today, Tomorrow, Later This Week, and Next Week according to the application's Monday–Sunday grouping. It no longer branches on the actual weekday.
- **TEST-007:** the three empty-state screenshots use `testInfo.outputPath()` and Playwright's ignored `test-results` area. No `/private/tmp/nook-empty-*` screenshot is created.
- **DEP-003 (Playwright/ESLint portion):** ESLint ignores fixed and historical Playwright build directories and the generated Playwright tsconfig.

## Expected failures and deliberate application deferrals

- `keyboard.spec.ts` retains a narrowly scoped `test.fail()` for **UI-001**: after focus is redirected within Add and Add is cancelled, opening Edit focuses Close instead of Company. The expected-failure marker is placed immediately before that assertion; independent Edit/Delete and Settings focus tests now run and pass separately. The Settings shortcut case formerly at `keyboard.spec.ts:233` passed after waiting for the closing Settings dialog to become hidden before testing the search field. The audit had classified that symptom as unresolved and likely exit-animation timing, so it was **not** marked as an expected failure.
- `sidebar-interactions.spec.ts` retains a narrowly scoped `test.fail()` for **REACT-002**: from an API-seeded collapsed sidebar, `/` expands the sidebar but focus runs while the search input is still inert during the asynchronous settings update. The expansion assertion must pass before the expected-failure marker; only the final focus assertion is expected to fail. This is a newly reproduced symptom of the audit's non-optimistic settings writes. Product behavior was not changed.
- UI-001, REACT-002, and all other application, React, accessibility, and product findings remain unfixed. No Phase 5 work, migration, or manual UI test was done.

## Verification and problems resolved

| Check | Result |
|---|---|
| `npm run typecheck` | pass after final edits |
| `npm run lint` | pass, no warnings after final edits |
| `npm run test:e2e`, final full run 1 | pass: **51 tests**, including the two intentional expected failures; no unexpected failures; isolated database; 7.3 min |
| `npm run test:e2e`, final full run 2 | pass: **51 tests**, same two intentional expected failures; no unexpected failures; fresh isolated database; 7.4 min |
| `git diff --check` | pass |
| Post-run artifact and process checks | no `.next-playwright*`, `tsconfig.playwright.json`, `/private/tmp/nook-empty-*`, or `/private/tmp/nook-playwright.*` remnants; escalated process listing found no orphaned Next, Playwright, or headless Chrome process |

The first diagnostic full run passed 37 of 49 tests and exposed 12 test-side failures; the two marked application failures were expected. Focused runs distinguished stale selectors, navigation, fixture state, an obsolete import fixture, the new Undo route, and the REACT-002 focus defect. The near-limit import fixture had a single 9.5 MB event detail, invalid after Phase 2 introduced a 5,000-character event limit; it now uses 1,900 valid bounded note events and still exercises a backup larger than 9 MiB. A broad UI-001 expected-failure marker initially covered unrelated dialog checks. Splitting those tests revealed the General and Backup & Restore controls omitted by the old tab-order array; the independent tests now pass. The initial plan's assumption that only `keyboard.spec.ts:122` and `:233` needed expected-failure review was incomplete: `:233` was a test timing issue, while the clean collapsed-sidebar shortcut exposed REACT-002. The plan also predates the Phase 2C status Undo route and Phase 2 event-text bound.

The tracked `tsconfig.json` SHA-256 was **`a29cf08a338763877be4872ac4b5d0db2bd06640c6269815f422ab626751fc2a`** before the full verification runs and after each of them. Next did not mutate it, and no random build directory was created. The literal requested `git diff --exit-code tsconfig.json` returns **1** because the required removal of six *committed* include pairs and addition of the fixed-directory exclude are intentionally unstaged changes. That check cannot return 0 without staging or committing the requested edit; neither was done. The unchanged file hash across runs is the direct mutation check. This is a contradiction in the remediation plan's verification assumption, not a Playwright side effect.

## Files, data safety, and final repository state

- Configuration and runner: `.gitignore`, `eslint.config.mjs`, `next.config.ts`, `scripts/run-playwright.sh`, `tsconfig.json`.
- Shared fixture: `tests/e2e/api-helpers.ts`.
- E2E specs: `analytics-heading`, `application-revision`, `backup-import-limits`, `backup-recovery`, `deletion-recovery`, `duplicate-import-focus`, `empty-state-copy`, `import-overlap`, `interview-date`, `interviews`, `kanban-layout`, `keyboard`, `navigation`, `origin-protection`, `scrollbars`, `settings-zoom`, `shortcut-panel-sections`, `shortcut-scope`, `sidebar-context`, `sidebar-interactions`, `sidebar-layout`, `sidebar-navigation`, `sidebar-resize` (all under `tests/e2e/`). Some specs changed only to use the shared fixture or direct Job Board route.
- Report: `audit/audit-20260928/audit-fix.md` (gitignored, appended in place).

`prisma/dev.db` was never opened, queried, copied, or modified by Playwright. Its final size **53,248 bytes**, mtime epoch **1790487979**, and SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`** match the pre-session values. A separate untracked `CLAUDE.md` appeared during the session, contains only `@AGENTS.md`, and was left untouched.

Final `git status -sb`:

```text
## main...origin/main [ahead 5]
 M .gitignore
 M eslint.config.mjs
 M next.config.ts
 M scripts/run-playwright.sh
 M tests/e2e/analytics-heading.spec.ts
 M tests/e2e/api-helpers.ts
 M tests/e2e/application-revision.spec.ts
 M tests/e2e/backup-import-limits.spec.ts
 M tests/e2e/backup-recovery.spec.ts
 M tests/e2e/deletion-recovery.spec.ts
 M tests/e2e/duplicate-import-focus.spec.ts
 M tests/e2e/empty-state-copy.spec.ts
 M tests/e2e/import-overlap.spec.ts
 M tests/e2e/interview-date.spec.ts
 M tests/e2e/interviews.spec.ts
 M tests/e2e/kanban-layout.spec.ts
 M tests/e2e/keyboard.spec.ts
 M tests/e2e/navigation.spec.ts
 M tests/e2e/origin-protection.spec.ts
 M tests/e2e/scrollbars.spec.ts
 M tests/e2e/settings-zoom.spec.ts
 M tests/e2e/shortcut-panel-sections.spec.ts
 M tests/e2e/shortcut-scope.spec.ts
 M tests/e2e/sidebar-context.spec.ts
 M tests/e2e/sidebar-interactions.spec.ts
 M tests/e2e/sidebar-layout.spec.ts
 M tests/e2e/sidebar-navigation.spec.ts
 M tests/e2e/sidebar-resize.spec.ts
 M tsconfig.json
?? CLAUDE.md
```

**Session 6 / Phase 4 implementation and two-run Playwright verification are complete.** The literal `git diff --exit-code tsconfig.json` acceptance check remains unmet for the intentional unstaged tsconfig edit explained above.

---

# Session 7 / Phase 5A — Settings state and React synchronization

## Findings, causes, and changes

- **REACT-001:** The old module store started with defaults; a passive `ThemeProvider` effect loaded the server snapshot after children rendered, while several `useSyncExternalStore` server snapshots were hard-coded defaults. `ThemeProvider` now passes the server snapshot through `SettingsInitialStateContext` and initializes the client store during render before descendants subscribe. `useSettings` and `useBoards` read the context snapshot during SSR and hydration. The server singleton is never seeded. The root `<html>` renders persisted `data-motion` immediately. The first-DOM Playwright case checks collapsed sidebar, custom board label, Motion Off, and dark theme before hydration changes.
- **REACT-002:** Board text changes previously PATCHed per keystroke, toggles used render-time booleans, drag auto-expansion wrote transient state, refreshes notified at equal revision, and errors used alerts or toasts inconsistently. The store now keeps a committed server state and a visible optimistic state, serializes revisioned PATCHes, and rebases queued functional updates after success or failure. Failed writes roll back; 409 adopts server state and rejects the failed operation while later updates rebase; 503 remains an error surfaced to callers. Equal-revision refreshes are ignored. Sidebar, Archived, and All applications toggles use functional updates. Board name and empty text use 350 ms drafts with blur commit; board color, reorder, and reset return errors to the caller. Drag auto-expansion is local hook state and creates no settings PATCH. One `visibilitychange` listener handles refreshes. `useSettingsUpdate` routes settings errors to the existing toast; `window.alert` was removed from settings preference code.
- **A11Y-004:** Collapse from a shortcut or separator now detects focus in sidebar content or on the resize separator before changing state. `ApplicationSidebar` hands focus to the Expand button after the collapsed state commits, using its existing visibility-aware focus path. The shortcut focus regression passes. The search shortcut waits until the expanded search field is visible and no longer inert before focusing it.
- **UI-004:** The inline theme script and client provider now call the same `applyTheme` function. The dead `:root.light` rule was removed. Persisted dark theme is checked in the first-DOM regression.
- **REACT-008:** `/` is now a server component that reads persisted settings and calls Next `redirect()` to the existing dashboard, Job Board, or Interviews destination. The client-only blank redirect component and extra `/api/settings` fetch were removed. Playwright checks both configured destinations and zero settings API requests.
- **ARCH-003 (Phase 5A portion):** `useSettings` and `useBoards` moved from `src/lib/` to `src/hooks/`; preference code no longer calls `window.alert`. Other ARCH-003 type-placement work remains deferred.
- **CLEAN-003 (Phase 5A portion):** Removed stringly typed `setPreference`, its four `*_KEY` exports, and the preference subscription alias. The Settings modal uses typed `useSettingsUpdate` calls. Remaining width, TTL, cutoff, and sensor constants are deferred.

## Regression evidence and verification

- **Old REACT-002 failure:** Before application changes, the Phase 4 `sidebar-interactions.spec.ts` case ran on an isolated Playwright database. The expansion assertion passed, and the search focus assertion produced the expected failure under `test.fail()` (the run exited 0 because the failure was expected). The marker was removed after the fix; the unmarked case passed in both full targeted runs.
- `settings-store-test.mjs` now covers queued board updates, rapid double functional toggles with distinct revisioned payloads, equal-revision refresh silence, 503 rollback, and 409 adoption plus rebase of a later edit. `motion-preference-test.mjs` uses increasing revisions to match the new equal-revision rule.
- `sidebar-interactions.spec.ts` adds first-DOM settings, collapse focus with rapid toggle persistence, and one PATCH for a board name typing burst even after blur. `navigation.spec.ts` asserts that persisted startup pages redirect with no `/api/settings` request. Existing sidebar archive and route-navigation cases also passed.
- `npm run typecheck`: pass. `npm run lint`: pass. `npm run test:unit`: pass, 31 main tests plus 3 New York and 3 Dhaka calendar tests. `npm run test:backup`: pass on the runner's isolated SQLite database, including settings conflict and validation cases. `git diff --check`: pass.
- Targeted Playwright `sidebar-interactions.spec.ts` and `navigation.spec.ts`: **8/8 pass**, followed by **8/8 pass** again from a fresh isolated runner database. The full E2E suite was not run. No manual UI test was performed.

## Problems, assumptions, and behavior

- The first targeted Playwright run passed 7/8. The new focus test pressed the sidebar shortcut while a text input was focused; the existing shortcut matcher intentionally ignores editable targets. The test now starts from a focused sidebar application row. The affected case passed, then both complete targeted runs passed. This was a test setup error, not a product regression.
- The old motion unit fixture repeatedly supplied revision 0. The new equal-revision rule correctly ignored those updates, so the fixture now increments revisions. No remediation-plan behavior assumption proved incorrect beyond the test setup's editable-target assumption.
- Expected behavior changes: persisted settings appear on first render; user toggles update immediately and survive rapid input; board text persists once per pause or blur; transient drag expansion is local; failed settings writes revert the optimistic value and display a toast; collapse preserves keyboard focus; `/` redirects on the server. Revision-checked API behavior and supported startup pages are unchanged.
- Session 8 / Phase 5B dialog architecture and UI-001 focus work, Phase 5C Board semantics/accessibility, Phase 5D dashboard mutations, and the later ARCH-003/CLEAN-003 portions were not started.

## Files, data safety, and final repository state

- Application: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/application-dashboard.tsx`, `src/components/application-sidebar.tsx`, `src/components/board-settings.tsx`, `src/components/dashboard-overview.tsx`, `src/components/dashboard-stale-applications.tsx`, `src/components/motion-preference.tsx`, `src/components/settings-modal.tsx`, `src/components/theme-provider.tsx`, `src/hooks/use-board-drag.ts`, `src/hooks/use-boards.ts`, `src/hooks/use-settings.ts`, `src/hooks/use-settings-update.ts`, `src/lib/apply-theme.ts`, `src/lib/board-preferences.ts`, `src/lib/general-preferences.ts`, `src/lib/settings-store.ts`. Removed `src/components/startup-redirect.tsx`.
- Tests: `scripts/motion-preference-test.mjs`, `scripts/settings-store-test.mjs`, `tests/e2e/navigation.spec.ts`, `tests/e2e/sidebar-interactions.spec.ts`.
- Report: `audit/audit-20260928/audit-fix.md` (gitignored, appended in place).
- `prisma/dev.db` was not opened, queried, copied, or modified by the tests. Final size **53,248 bytes**, mtime epoch **1790487979**, and SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`** match the known baseline. All browser/API tests used isolated temporary databases.
- Final `git status -sb`:

  ```text
  ## main...origin/main [ahead 7]
   M scripts/motion-preference-test.mjs
   M scripts/settings-store-test.mjs
   M src/app/globals.css
   M src/app/layout.tsx
   M src/app/page.tsx
   M src/components/application-dashboard.tsx
   M src/components/application-sidebar.tsx
   M src/components/board-settings.tsx
   M src/components/dashboard-overview.tsx
   M src/components/dashboard-stale-applications.tsx
   M src/components/motion-preference.tsx
   M src/components/settings-modal.tsx
   D src/components/startup-redirect.tsx
   M src/components/theme-provider.tsx
   M src/hooks/use-board-drag.ts
   M src/lib/board-preferences.ts
   M src/lib/general-preferences.ts
   M src/lib/settings-store.ts
   M tests/e2e/navigation.spec.ts
   M tests/e2e/sidebar-interactions.spec.ts
  ?? src/hooks/use-boards.ts
  ?? src/hooks/use-settings-update.ts
  ?? src/hooks/use-settings.ts
  ?? src/lib/apply-theme.ts
  ```

**Session 7 / Phase 5A is complete.**

---

# Session 8 / Phase 5B — Shared dialog and focus behavior

- **Base:** `11f1da0` (Session 7 committed; tree clean at start). No commit was created in this session.
- **Scope:** UI-001, REACT-003, A11Y-003, the former `keyboard.spec.ts:233` case, and REACT-006. Phase 5C and 5D were not started.

## Root causes

All five items come down to two defects in how dialogs handled their lifecycle, plus one state-ownership defect.

1. **A closing dialog kept its trap and Escape handling for its whole exit animation.** `MotionPresence` keeps a dialog mounted for about 160 ms after it closes, so its `focusin` redirect and its keydown handler stayed live. Any focus that moved elsewhere during that window was pulled back into the dialog that was closing. Focus was returned to the trigger only on unmount, after the exit.
2. **Reopening a dialog during its exit reused the same mounted instance.** `JobModal` ran its setup (initial focus, trigger capture) in a mount-only effect (`[]` deps). Reopening during the exit therefore did not focus anything.
3. **There was no shared dialog stack.** Every dialog registered its own document listeners. Escape for Settings and Shortcuts was handled by the page-shortcut listener, which ran before dnd-kit's delayed keyboard-sensor listener.
4. **REACT-006:** one `error` state was shared by the page banner and the job form. A failed delete from Edit left the modal closed and did not reset `reopenModalAfterDelete`.

## Findings

| Finding | Cause (from the list above) | Fix |
|---|---|---|
| **UI-001** | 1 + 2, and five dialogs duplicating trap, Escape and backdrop code, including `JobModal`'s own copy of the trap | One `Dialog` component with one dialog-stack hook. All seven dialogs use it. |
| **REACT-003** | 1: the Edit modal's trap was still active while the prompt mounted. When a card moves column its old DOM node is removed, so the Edit modal's late `trigger.focus()` hit a disconnected node and focus stayed on `<body>`. | The Edit dialog releases its trap and returns focus as its exit starts. The prompt then captures that as its return target and focuses its date input. |
| **A11Y-003** | 3: the shortcut hook closed Settings on Escape before dnd-kit's keyboard sensor could cancel the reorder. | The shortcut hook no longer handles Escape. The stack routes Escape to the topmost dialog only, and ignores it while a dnd-kit drag is active (`[aria-roledescription=draggable][aria-pressed=true]`). |
| **keyboard.spec.ts:233** | 1: this was a **real application defect**, not only test timing (see below). | Fixed by releasing the trap as soon as the exit starts. |
| **REACT-006** | 4 | Split into `error` (page banner) and `formError` (job form). A failed delete from Edit reopens the modal with the unchanged form and shows the error inside it. `reopenModalAfterDelete` is always reset. |

## Dialog and focus architecture changes

- **`src/hooks/use-dialog-stack.ts` (new):** a module-level stack of open dialogs, with one set of document listeners that exists only while the stack is non-empty.
  - **Tab trap:** Tab and Shift+Tab cycle within the topmost dialog only (capture phase).
  - **Focus containment:** a `focusin` outside the topmost dialog is sent back to that dialog's initial control.
  - **Escape:** handled in the bubble phase. It is ignored if it is already `defaultPrevented` or a dnd-kit drag is active; otherwise it goes to the topmost dialog only.
  - **Suspension:** dialogs below the top are suspended automatically. This replaces Settings' `suspendFocusTrap` prop and its "refocus Close after suspension" effect.
  - **Lifecycle:** `useDialogStack` activates while the dialog's presence is open. On activation it records the return target (the explicit `returnFocusRef`, or the focused element) and focuses the initial control. On deactivation, at the **start** of the exit, it leaves the stack. If it was the topmost dialog and focus was inside it or on `<body>`, it returns focus to the trigger. Reopening during an exit re-runs activation.
  - **Why this is a passive effect:** I first wrote it as a layout effect. A focus probe showed that React DOM's post-mutation focus restore (`resetAfterCommit`) immediately re-focused the exiting dialog's still-connected button. Passive effects run after that restore. All passive cleanups in a commit still run before any passive setup, so a closing dialog returns focus before a newly opened one records its return target.
- **`src/components/motion-presence.tsx`:** provides a presence context (`usePresence()`), which is `false` while a dialog is mounted only for its exit animation. Exit timing is unchanged, and no `setTimeout` was added.
- **`src/components/dialog.tsx` (new):**
  - It renders the backdrop and the labelled `section` with `role`, `aria-modal`, `aria-labelledby`, `aria-describedby` and `aria-busy`.
  - Props cover initial focus, return focus, `closeDisabled` (blocks Escape and backdrop while saving or deleting) and `closeOnBackdrop` (off for the interview prompt, as before).
  - Every class string, including z-indices and backdrop classes, is passed through unchanged.
- **Migrated to `Dialog`:** `JobModal`, `DeleteDialog`, `DeleteAllDataDialog`, `DuplicateWarningDialog`, `InterviewDateDialog`, `SettingsModal` and `ShortcutOverlay`.
- **Removed:** `src/hooks/use-dialog-focus-trap.ts`, the duplicated trap in `JobModal`, every per-dialog Escape `keydown` effect, all no-op `document.body.style.overflow` locks, the shortcut hook's `close` branch with `onCloseShortcuts` and `onCloseSettings`, and the dashboard's `settingsConfirmationOpen` state with Settings' `onConfirmationChange`. `settingsConfirmationOpen` had no remaining use once Escape moved to the stack.
- **`DeleteAllDataDialog`:** now a sibling of the Settings `Dialog` instead of a child of its backdrop. Both are fixed-position overlays with the same z-indices, so nothing changes visually.

## keyboard.spec.ts:233: investigation and result

- **Reproduced on the unchanged code with the Phase 4 infrastructure.** The new case clicks Close settings and then uses the search field without waiting for the exit animation. It failed: search never received focus (`toBeFocused` on search timed out). The exiting Settings trap redirected focus to its Close button, a non-editable target, so the shortcut was no longer suppressed.
- **Conclusion: this is an application defect.** Phase 4's green result came from waiting until Settings was hidden, which skipped the 160 ms window where the defect lives. The audit's "exiting trap reclaims focus" inference was correct.
- After the fix, focus stays in search, the shortcut is suppressed, and the value is kept. The Phase 4 version with the wait still passes too.

## UI-001: reproducing the old failure and removing its `test.fail()`

- **The existing marker no longer reproduced.** On the unchanged `11f1da0` code, the Phase 4 `test.fail()` case at `keyboard.spec.ts:120` passed ("Expected to fail, but passed") in 6 of 6 runs (1 run, then `--repeat-each=5`). The symptom depended on Playwright's row click landing inside the exit window, and after Session 7 it no longer did.
- **I wrote a deterministic reproduction** in `dialog-focus.spec.ts`. In the page, it clicks Cancel and then, two animation frames later, focuses and clicks the Edit row. It first asserts that the Add dialog is still in `data-motion-presence="closing"`. On the unchanged code it failed **3 of 3** runs at `expect(Company).toBeFocused()`. That is the exact Phase 4 symptom: the exiting trap moved focus to Close, and the reused instance never set initial focus.
- **Removed:** the `test.fail(true, "UI-001: …")` line in `keyboard.spec.ts`. The normal assertion `expect(editDialog.getByLabel("Company")).toBeFocused()` is unchanged and passes.
- **One intentional expectation change in the same test (line 128).** Escaped focus in the Add dialog now goes to **Company**, the dialog's initial control, instead of Close.
  - Before, `JobModal`'s own trap sent escaped focus to its first control. Every other dialog sent it to its initial control.
  - The shared trap uses one rule, so the assertion now expects Company.
  - The assertion is just as strict; only the target changed.

## Tests added and updated

**`tests/e2e/dialog-focus.spec.ts` (new, 8 cases):**

| Case | Checks | On unchanged code |
|---|---|---|
| REACT-003 (board card) | Edit from a card (Enter), change status to Interview, save: the prompt's date input is focused | **failed** (focus stayed on `<body>`) |
| REACT-003 (sidebar row) | prompt focus; Tab and Shift+Tab cycle through date, Skip, Add date; focus escaping to the page is sent back; Escape closes the prompt and returns focus to the Edit trigger | **failed** at the focus return |
| UI-001 (deterministic) | Edit opened during the Add dialog's exit focuses Company; Escape returns focus to the row | **failed** 3/3 |
| keyboard:233 | search used during the Settings exit keeps focus and value; the shortcut stays suppressed | **failed** |
| A11Y-003 (D3) | Space, ArrowDown, Escape on "Reorder Applied board" cancels the drag, Settings stays open, boards stay `[]`, focus stays in Settings; a second Escape closes Settings and focus returns to the Settings button | **failed** (Settings closed) |
| Nested Delete All | the confirmation traps focus both ways and pulls escaped focus back; Escape closes only the confirmation, and focus returns to the Delete All Data button; the Settings trap resumes; Escape closes Settings and focus returns to its trigger | passed (coverage for the new stack) |
| REACT-006 | `page.route` returns 500 for the undoable DELETE; the Edit modal reopens with the unsaved Role and Notes, the error is inside the modal and not in a page banner, and Company is focused | **failed** (modal did not reopen) |

**`tests/e2e/keyboard.spec.ts`:** the UI-001 `test.fail()` was removed, and the escaped-focus expectation was changed as described above.

## Targeted Playwright results

Every run used `scripts/run-playwright.sh` with its own isolated SQLite database.

| Run | Result |
|---|---|
| Reproduction on the unchanged code | failures as listed in the table above; `keyboard:120` "expected to fail but passed" 6/6 |
| First run after the fix (29 tests in 10 specs) | 23 passed, 6 failed: focus was not returned after animated closes (the layout-effect problem above), plus the line-128 expectation. Both were fixed. |
| Rerun of those specs (plus a temporary probe spec, since deleted) | 11/11 passed |
| **Final pass 1**, fresh database: 15 specs, 43 tests (`dialog-focus`, `keyboard`, `shortcut-scope`, `duplicate-import-focus`, `interview-date`, `deletion-recovery`, `backup-recovery`, `backup-import-limits`, `import-overlap`, `shortcut-panel-sections`, `settings-zoom`, `application-revision`, `sidebar-interactions`, `sidebar-navigation`, `interviews`) | **42 passed, 1 failed.** The failure was `keyboard.spec.ts:291` in its Phase 4 `afterEach` cleanup: `apiRequestContext.delete: read ECONNRESET` on concurrent cleanup DELETEs to the dev server. The test body (Tab order) passed, and this is not related to dialogs. It was not changed or marked. |
| **Final pass 2**, fresh database, same 43 tests | **43/43 passed** |

The full `npm run test:e2e` was not run. The plan does not require it, and the 15 specs cover every dialog, the shortcut hook and the sidebar focus paths.

## Other verification

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors, 2 warnings. Both are unused `useSyncExternalStore` imports in `dashboard-overview.tsx:4` and `dashboard-stale-applications.tsx:3`, which already exist at HEAD `11f1da0` (Session 7). Those files were not touched here. |
| `npm run test:unit` | pass: 31 tests, plus 3 under New York and 3 under Dhaka |
| `git diff --check` | pass |

## Files changed

- **Added:** `src/components/dialog.tsx`, `src/hooks/use-dialog-stack.ts`, `tests/e2e/dialog-focus.spec.ts`.
- **Modified:** `src/components/application-dashboard.tsx`, `delete-all-data-dialog.tsx`, `delete-dialog.tsx`, `duplicate-warning-dialog.tsx`, `interview-date-dialog.tsx`, `job-modal.tsx`, `motion-presence.tsx`, `settings-modal.tsx`, `shortcut-overlay.tsx`, `src/hooks/use-dashboard-shortcuts.ts`, `tests/e2e/keyboard.spec.ts`.
- **Deleted:** `src/hooks/use-dialog-focus-trap.ts`.
- **Report:** this file (gitignored).

## Problems encountered

- **The Phase 4 UI-001 marker no longer failed** on the unchanged code, and my first Alt+N reopen variant also missed the exit window. A deterministic in-page sequence was needed to reproduce the defect.
- **My first REACT-003 case used a sidebar row, and the date input got focus anyway.** The Edit modal's late `trigger.focus()` on the still-connected row caused a `focusin` that the prompt's trap redirected. The audit's D2 used a board card, whose node is removed when it changes column, and that path does reproduce the bug. Both paths are now tested.
- **Focus return from a layout-effect cleanup was undone by React DOM's post-commit focus restore.** A temporary focus-logging probe found this, and the logic moved to a passive effect.
- **My first final-verification command ran no tests** ("No tests found"), because zsh does not word-split an unquoted variable. It was rerun with an explicit argument array. The failed launch touched nothing.
- **Bash tool approvals failed intermittently** during the session. Affected steps were retried or done with file edits. There was no effect on results.

## Remediation-plan assumptions that proved incorrect

- **"`keyboard:122` and `keyboard:233` flip from `test.fail()` to passing."** The `:233` case was never marked `test.fail()` (Phase 4 made it pass by waiting), and the `:122`/`:120` marker was already passing on the unchanged code. Both defects were real; they needed deterministic tests to show them.
- **"REACT-003, A11Y-003 and `keyboard:233`: fixed by UI-001."** This held for REACT-003 and `:233`, since they share the exiting-trap cause. It did not hold for A11Y-003, which needed the Escape routing change and the drag-in-progress check.
- **"The trap supports suspension."** No explicit suspension flag was needed. Suspension follows from stack position, which removed Settings' `suspendFocusTrap` and `onConfirmationChange` plumbing.

## Behavior intentionally changed

- Dialogs return focus to their trigger **when the exit starts**, and stop trapping focus and handling Escape at the same moment.
- Escaped focus in the job dialog goes to Company, the initial control, instead of Close.
- After the duplicate-import warning closes, focus returns to the control that was focused when it opened, inside Settings. Before, Settings' suspension effect always focused Close settings. Focus escaping Settings is still sent to Close settings (checked by `duplicate-import-focus.spec.ts`). The exact return target after the warning closes is known from the source only; no test asserts it.
- A failed delete from the Edit modal reopens the modal with its form and error. A failed delete from elsewhere still shows the page banner. Page errors are no longer cleared by opening the job form, because the form now has its own error.

## Behavior intentionally left unchanged

- Dialog copy, actions, classes, z-order, backdrop behavior (including no backdrop close on the interview prompt), exit animation timing and reduced-motion handling.
- Shortcut scope rules, the dnd-kit sensors and announcements, and the shortcut listener being re-registered on every render. With Escape removed from it, its registration order no longer matters.
- The toast region above dialogs (A11Y-005, deferred).

## Deferred (not started)

- **Phase 5C:** A11Y-001, A11Y-002, A11Y-006, A11Y-007 and BIZ-002, including all Board card and sidebar-row semantics.
- **Phase 5D:** REACT-004 and REACT-005, plus the dashboard mutation client.
- **Not fixed here:** the pre-existing lint warnings from Session 7, and the `keyboard.spec.ts` afterEach concurrent-DELETE cleanup, which can hit a transient `ECONNRESET`.

## Data safety and final repository state

- **`prisma/dev.db`** was never opened, queried or copied. After the session it is **53,248 bytes**, mtime epoch **1790487979**, SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`**, which matches the baseline.
- **Temporary artifacts:** no `.next-playwright*`, `tsconfig.playwright.json` or `/private/tmp/nook-*` remains, and no Next or Playwright process is running. The temporary probe spec was deleted.
- **Final `git status -sb`:**

  ```text
  ## main...origin/main [ahead 8]
   M src/components/application-dashboard.tsx
   M src/components/delete-all-data-dialog.tsx
   M src/components/delete-dialog.tsx
   M src/components/duplicate-warning-dialog.tsx
   M src/components/interview-date-dialog.tsx
   M src/components/job-modal.tsx
   M src/components/motion-presence.tsx
   M src/components/settings-modal.tsx
   M src/components/shortcut-overlay.tsx
   M src/hooks/use-dashboard-shortcuts.ts
   D src/hooks/use-dialog-focus-trap.ts
   M tests/e2e/keyboard.spec.ts
  ?? src/components/dialog.tsx
  ?? src/hooks/use-dialog-stack.ts
  ?? tests/e2e/dialog-focus.spec.ts
  ```

**Session 8 / Phase 5B is complete.** One non-dialog cleanup flake appeared in the first of the two final passes; the second pass was fully green.

---

# Session 9 / Phase 5C — Board semantics and accessibility

- **Base:** `d32170a` (Session 8 committed; tree clean at start). No commit was created in this session.
- **Scope:** A11Y-001, A11Y-007, A11Y-006, A11Y-002 and BIZ-002. Phase 5D was not started. Settings and the Session 8 `Dialog`/dialog-stack architecture were not changed.

## Findings fixed and root causes

| Finding | Root cause | Fix |
|---|---|---|
| **A11Y-001 (card)** | dnd-kit `attributes` (`role="button"`, `tabIndex`, `aria-describedby`) were spread on the card `<article>`, which contained the `h4` and, with a URL, the posting `<a>`. The result was nested interactive content, a heading inside a button, and an `aria-label` that replaced the dates. | The `<article>` is now a plain container. One native `<button>` (`.kanban-card-action`, `absolute inset-0`) carries the dnd `attributes` and `listeners`, is the dnd activator node, and has the name "Edit or move {role} at {company}" plus `aria-describedby` = the dates block and the dnd instructions. The `h4` and link are siblings of the button, and the link sits above it (`relative z-10`). |
| **A11Y-001 (sidebar and archived rows)** | The rows spread `listeners` and then overrode `onKeyDown`, so they had no keyboard drag, but their labels promised "Edit or archive" and "Edit or move archived". Keyboard drag cannot work for sidebar rows as built: `collisionDetectionStrategy` accepts a sidebar drag only through `pointerWithin` on the Archived zone, and a keyboard drag has no pointer. | The plan's second option: the labels are now "Edit {role} at {company}" and "Edit archived {role} at {company}". Enter and Space edit, and pointer drag is unchanged. Keyboard users still archive with Alt+A on a board card and restore with the Restore button. |
| **A11Y-007** | The Settings `BoardSettings` `DndContext` set only `screenReaderInstructions`, so dnd-kit's defaults announced internal IDs. | `announcements` built from board labels and positions: "Picked up Sent board. It is in position 1 of 5." / "Sent board is over Online assessment, position 2 of 5." / "Sent board was moved to position 2 of 5." / "Reordering canceled. Sent board stays in position 2 of 5." `onDragOver` returns nothing while the board is over its own slot. |
| **A11Y-006** | One `<main>` wrapped the whole app, including `<aside>` and `<nav>`. `/jobs` had no `h1`. Metric labels were `h2`. The `h2 aria-label="All applications"` hid its count. The Interviews link had `aria-label="Interviews"` with an `aria-hidden` badge. | The outer element is now a `<div>`, and the page-content scroller (`.board-scroll`) is the `<main>`. DOM, classes and tab order are unchanged. `/jobs` has an `sr-only` `<h1>Job Board</h1>`. `DashboardMetricCard` labels are `<p>`. The `h2`'s `aria-label` was removed, so its name is "All applications N". The link name is "Interviews, N upcoming". |
| **A11Y-002** | The Interviews tabs were both in the Tab order with no roving `tabIndex`, and ArrowLeft/Right were a page-global shortcut (`switch-interview-tabs`) that fired from any non-editable focus. | The ARIA tabs pattern is now local: the selected tab has `tabIndex=0` and the other `-1`. ArrowLeft/Right (wrapping), Home and End work on the tablist only and select with focus. The global binding was removed from `shortcutDefinitions`, `useDashboardShortcuts` and the dashboard. The tab refs moved into `InterviewsList`. |
| **BIZ-002** | Analytics and Stale rendered `STATUS_META` labels and dots (with a hard-coded "Online Assessment"). The job form's status `<select>` iterated `Object.values(Status)`. | Analytics Status Breakdown uses `useBoards()` with `boardLabel`/`boardDot`, and the Stale row uses `boardLabel`. The job form's options are `boards` in board order. Boards always hold all five statuses (`boardsSchema` enforces this), so no option can be lost. |

## Implementation notes

- **Card structure (`kanban-board.tsx`):**
  - `data-kanban-card-id` moved to the button, the focusable element. The existing consumers (`focusKanbanCard`, arrow focus navigation, Alt+A and Delete in `use-dashboard-shortcuts.ts`, and several specs) therefore work unchanged.
  - The FLIP reorder animation now queries `article[data-application-id]`, so the whole card still animates.
  - The date icons got `aria-hidden`, and the applied date got an `sr-only` "Applied " prefix, so the description reads "Applied 9/22/2026 Interview 10/2/2026". Nothing visible changed.
- **Focus ring:** `.kanban-card-focus:focus-visible` became `.kanban-card-focus:has(> .kanban-card-action:focus-visible)`, with the same declarations, so the ring renders on the card exactly as before.
- **Unchanged behavior:**
  - The button's `onKeyDown` keeps the old routing: Enter edits, and other keys go to the dnd listener. The sensor starts on Space only.
  - Pointer and touch listeners are on the button, which covers the whole card except the link. The link still stops pointer, click and key propagation.
  - No colors, spacing or visible text changed.

## Tests

**New `tests/e2e/board-accessibility.spec.ts` (7 cases):**

| Case | Checks |
|---|---|
| A11Y-001 card semantics | The card control is a `BUTTON`. There is no `a` or `h1`–`h4` inside any button or `[role=button]`, and no non-native `[role=button]`. The `h4` is exposed. The link is hit-testable above the overlay (`elementFromPoint`). The description contains "Applied …", "Interview …" and the dnd instructions. A real mouse click on the title opens Edit, Escape returns focus to the card, and Enter opens Edit. |
| A11Y-001 keyboard path | Space picks up (`aria-pressed`), ArrowRight and Space move APPLIED to ONLINE_ASSESSMENT (PATCH 200). Focus lands on the moved card, and no dialog opens from the Space keyup. ArrowRight focuses the next column's card, and Alt+A archives it. |
| A11Y-001 rows | No "Edit or archive" or "Edit or move archived" names remain. Enter and Space on both row types open Edit and return focus. Pointer-dragging a sidebar row onto Archived archives it (PATCH 200). Pointer-dragging an archived row onto the Applied column restores it. |
| A11Y-007 | With the Applied board renamed "Sent": the exact pick-up, over, drop and cancel announcements. The saved order becomes `[ONLINE_ASSESSMENT, APPLIED, …]`. Settings stays open after Escape. No live region contains `reorder:`, `APPLIED` or `ONLINE_ASSESSMENT`. |
| A11Y-006 | There is exactly one `main`, with no `navigation` or `complementary` inside it. The `h1` "Job Board" is in `main`, with exactly one `h1`. The `h2` is "All applications 1". The link is "Interviews, 1 upcoming". Overview and Analytics metric labels are visible text but not headings. |
| A11Y-002 | Roving `tabindex` 0/-1. Tab from Upcoming goes to search (skipping Past), and Shift+Tab goes back. Arrows wrap, and Home and End work. ArrowRight/Left on the Sort button or on `<body>` do not switch tabs. |
| BIZ-002 | Custom boards (Offer first; ONLINE_ASSESSMENT renamed "Screening" and colored rose). Analytics breakdown shows "Screening" with `bg-rose`, and no "Online assessment". The Add-job status options equal the board labels in board order. Stale (browser clock +20 days, so a new record is 20 days stale) shows "Screening". |

**Existing tests updated because they pinned the old names or behavior:**

- **Label renames (rows only):** `deletion-recovery`, `dialog-focus`, `keyboard` (including the tab-order list), `navigation`, `sidebar-context` and `sidebar-interactions`. Card names ("Edit or move …") are unchanged.
- **`sidebar-context`:**
  - The heading is "All applications 2".
  - The two absence checks now use `/^All applications\b/`. With the count in the name, an exact "All applications" check would pass trivially.
- **Interviews link names:**
  - `interviews.spec` expects "Interviews, 3 upcoming".
  - `sidebar-navigation` expects "Interviews, 0 upcoming".
  - `keyboard` uses `/^Interviews, \d+ upcoming$/`.
  - `navigation.spec` already used a substring match and was unchanged.
- **`interviews.spec`:** Tab from Upcoming → Past plus Enter (the old non-roving behavior) became ArrowRight, and it now asserts that Past starts at `tabindex=-1`.
- **`shortcut-scope`:**
  - ArrowRight on `<body>` no longer switches tabs, so the test now asserts it doesn't. It then switches from the focused tab.
  - The "← / →" panel row is now asserted absent.
- **`shortcut-panel-sections`:** the "Switch tabs" row was removed, so the expected row count is 20 (was 21).
- **`scripts/keyboard-shortcuts-test.mjs`:** `switch-interview-tabs` is asserted absent, and ArrowRight matches nothing on Interviews.

No `test.fail()` was added. No assertion was loosened except the stated name updates, and each one still checks the element's identity.

## Old-failure evidence (new spec against unchanged `d32170a`)

`npm run test:e2e -- tests/e2e/board-accessibility.spec.ts` gave **6 failed, 1 passed**:

- **A11Y-001 card:** `tagName` expected "BUTTON", received **"ARTICLE"**.
- **A11Y-001 rows:** `getByRole('button', { name: /^Edit or archive / })` expected 0, received **1**.
- **A11Y-007:**
  - The failure snapshot's live region read **"Draggable item reorder:APPLIED was moved over droppable area APPLIED."**
  - dnd-kit's default `onDragOver` fires right after pick-up with over = self, so it overwrote the "Picked up draggable item reorder:APPLIED." announcement and the filter found nothing.
  - This confirms the finding, and it is why the new `onDragOver` stays silent over its own slot.
- **A11Y-006:** `getByRole('main').getByRole('navigation')` expected 0, received **1**.
- **A11Y-002:** the Upcoming tab's `tabindex` expected "0", and the attribute was **absent**.
- **BIZ-002:** Status Breakdown item "Screening" expected 1, received **0**.
- **Keyboard-path case:** **passed** on the old code, as expected. It guards behavior that must not regress.

## Targeted Playwright results

Every run used `scripts/run-playwright.sh` with its own isolated SQLite database. The 18 specs were: `board-accessibility`, `keyboard`, `shortcut-scope`, `shortcut-panel-sections`, `interviews`, `sidebar-interactions`, `sidebar-context`, `sidebar-navigation`, `navigation`, `deletion-recovery`, `dialog-focus`, `interview-date`, `application-revision`, `kanban-layout`, `scrollbars`, `analytics-heading`, `empty-state-copy` and `sidebar-layout` (59 tests).

| Run | Result |
|---|---|
| Reproduction on unchanged code | 6 failed, 1 passed (above) |
| First pass after the fix (18 specs) | **55 passed, 4 failed**, all test-side:<br>(1) Playwright refused to `click()` the `h4` because the overlay button "intercepts pointer events", which is the intended design. The test now does a real `page.mouse.click` at the title's coordinates and asserts the hit target is the card button.<br>(2) The keyboard-drag race (below).<br>(3) My A11Y-006 assertion wrongly treated Overview's real "Upcoming Interviews" *section* heading as the metric label. It now uses the metric-only "Active Pipeline".<br>(4) `shortcut-scope:104` expected the removed "← / →" row. |
| Keyboard-drag race: probe, then repeats | A temporary probe spec (deleted) showed ArrowRight moves the card 239 px and announces "is over Online assessment". The app works.<br>The failing runs announced "Picked up" and then "not moved", with no "is over". The arrow arrived before dnd-kit was ready: its `KeyboardSensor` adds its `keydown` listener in a `setTimeout(0)`, and droppable rects are measured in a later commit. The app's `kanbanKeyboardCoordinates` (unchanged) returns the current coordinates while a `targetRect` is missing.<br>A `setTimeout(0)` wait alone still failed 1 of 3 (the first drag on a cold dev server). The final helper waits two animation frames and then one timer, and passed **5/5** on a fresh server, including the cold first drag. |
| **Final pass 1**, fresh DB, 18 specs | **58 passed, 1 failed.** A11Y-007 failed at the Settings "Board" click after "6.4m" under a 45 s timeout. The trace shows `main-app.js` failed with **`net::ERR_NETWORK_IO_SUSPENDED`** and a ~378 s gap in the trace clock: the host was suspended, so the page never hydrated. Environmental. |
| **Final pass 2**, fresh DB, same 18 specs | **58 passed, 1 failed.** `sidebar-layout.spec.ts:3` failed. The trace shows a transient dev-server `GET /jobs` **500**, then "[Fast Refresh] performing full reload". The Collapse click (478,600 ms) ran before `jobs/page.js` loaded (480,269 ms), and the page sent no settings PATCH. That spec has no hydration wait. It passed in the three other runs, `/jobs` returned 200 everywhere else, and the tree showed no stray changes. Environmental dev-server flake. |
| Fresh-DB rerun of the two affected specs | **9/9 passed** (`board-accessibility` 7, `sidebar-layout` 2) |

The two final-pass failures were in different tests with different environmental causes, and each of those tests passed in the other pass. The full `npm run test:e2e` was not run.

## Other verification

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors, 2 warnings. Both are the pre-existing unused `useSyncExternalStore` imports (`dashboard-overview.tsx:4`, `dashboard-stale-applications.tsx:3`) recorded in Session 8. I edited `dashboard-stale-applications.tsx`, but left that import alone because it is unrelated to this phase. |
| `npm run test:unit` | pass: 31 tests, plus 3 under New York and 3 under Dhaka |
| `git diff --check` | pass. The new untracked spec was also checked for trailing whitespace. |
| API tests | Not run. No API route, `src/lib` server logic, schema or backup code changed; only client components, one CSS selector and the shortcut table did. |

## Files changed

- **Added:** `tests/e2e/board-accessibility.spec.ts`.
- **Modified (app):**
  - components: `kanban-board.tsx`, `application-sidebar.tsx`, `application-dashboard.tsx`, `board-settings.tsx`, `dashboard-analytics.tsx`, `dashboard-stale-applications.tsx`, `dashboard-metric-card.tsx`, `interviews-list.tsx`, `job-modal.tsx`;
  - other: `src/hooks/use-dashboard-shortcuts.ts`, `src/lib/keyboard-shortcuts.ts`, `src/app/globals.css` (one selector).
- **Modified (tests):** `scripts/keyboard-shortcuts-test.mjs`; `tests/e2e/deletion-recovery`, `dialog-focus`, `interviews`, `keyboard`, `navigation`, `shortcut-panel-sections`, `shortcut-scope`, `sidebar-context`, `sidebar-interactions`, `sidebar-navigation` (`.spec.ts`).
- **Report:** this file (gitignored).

## Problems encountered and incorrect assumptions

- **A11Y-007 reproduction:** I expected to see "Picked up … reorder:APPLIED". The default `onDragOver` fires immediately with over = self and replaces it, so the reproduction showed the over-announcement instead. The finding still holds, and it changed the fix: the new `onDragOver` is silent over the board's own slot.
- **Actionability versus the overlay design:** Playwright correctly reports the overlay button over the title. The test now clicks the way a user does, by coordinates, instead of forcing the click.
- **The keyboard-drag readiness race** took two iterations to make deterministic (above). It was never an app regression; the probe proved the app works on the new code.
- **The A11Y-006 test assumption was wrong:** Overview has a real "Upcoming Interviews" section heading, which should stay a heading.
- **Remediation-plan assumption:** "Sidebar rows: forward the key listener" is not viable without new keyboard collision support for the Archived zone. Sidebar collision is `pointerWithin` only, and archived rows would move 25 px per arrow press toward the board. The plan's alternative (honest labels) was used, and this is recorded as a limitation rather than a fix of keyboard drag for rows.
- **Plan note: "`@axe-core/playwright` is a new dependency, so it needs your approval".** It was not added. The spec asserts the relevant rules directly: no interactive or heading content inside a button, landmark containment, and heading levels.

## Behavior intentionally changed

- Sidebar and archived row names are "Edit …" and "Edit archived …".
- The Interviews link name includes its upcoming count.
- The "All applications" heading name includes its count.
- ArrowLeft/Right switch Interviews tabs only when focus is on a tab. The Keyboard Shortcuts panel and Settings → Shortcuts no longer list "Switch tabs ← / →" (now 20 rows).
- The Interviews tabs use roving tabindex, so only the selected tab is in the Tab order.
- Analytics shows the board's name for each status, which changes "Online Assessment" to "Online assessment" by default. Its colors follow the board. Stale shows the board name.
- The job form's status options follow board order.
- Metric labels are no longer headings.
- `<main>` covers only the page content.

## Behavior intentionally left unchanged

- Visual design of the board, cards, sidebar, tabs and dashboards: classes, spacing, colors and copy. The only changed CSS is the focus-ring selector, with identical declarations.
- Pointer and keyboard drag, the board card's Enter/Space/Alt+A/Delete/arrow behavior, board reorder, status moves and undo, FLIP and reduced-motion handling, and settings persistence.
- The Phase 5B `Dialog`, dialog stack and focus return.
- The Kanban `DndContext` announcements (already correct, per the audit), and the sidebar rows' pointer drag.
- The order of the Analytics Status Breakdown: the fixed status order, not board order. The plan asked only for labels and colors there.

## Deferred (not started)

- **Phase 5D:** REACT-004 and REACT-005, plus the dashboard mutation client.
- **Not fixed here:**
  - keyboard drag for sidebar and archived rows (needs keyboard-aware collision for the Archived zone; see above);
  - the pre-existing lint warnings;
  - `sidebar-layout.spec.ts`, which has no hydration wait before its first click (the pass-2 flake);
  - A11Y-005 and UI-002 (deferred by the plan).

## Data safety and final repository state

- **`prisma/dev.db`** was never opened, queried or copied. After the session it is **53,248 bytes**, mtime epoch **1790487979**, SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`**, matching the baseline.
- **Temporary artifacts:**
  - No `.next-playwright*`, `tsconfig.playwright.json` or `/private/tmp/nook-*` remains, and no Next or Playwright process is running.
  - The temporary probe spec `tests/e2e/zz-probe-5c.spec.ts` was deleted.
  - Logs and extracted traces are in the session scratchpad.
  - The gitignored `test-results/` holds Playwright's output from the last run. Playwright recreates it on each run, and it was left in place.
- **Final `git status -sb`:**

  ```text
  ## main...origin/main [ahead 9]
   M scripts/keyboard-shortcuts-test.mjs
   M src/app/globals.css
   M src/components/application-dashboard.tsx
   M src/components/application-sidebar.tsx
   M src/components/board-settings.tsx
   M src/components/dashboard-analytics.tsx
   M src/components/dashboard-metric-card.tsx
   M src/components/dashboard-stale-applications.tsx
   M src/components/interviews-list.tsx
   M src/components/job-modal.tsx
   M src/components/kanban-board.tsx
   M src/hooks/use-dashboard-shortcuts.ts
   M src/lib/keyboard-shortcuts.ts
   M tests/e2e/deletion-recovery.spec.ts
   M tests/e2e/dialog-focus.spec.ts
   M tests/e2e/interviews.spec.ts
   M tests/e2e/keyboard.spec.ts
   M tests/e2e/navigation.spec.ts
   M tests/e2e/shortcut-panel-sections.spec.ts
   M tests/e2e/shortcut-scope.spec.ts
   M tests/e2e/sidebar-context.spec.ts
   M tests/e2e/sidebar-interactions.spec.ts
   M tests/e2e/sidebar-navigation.spec.ts
  ?? tests/e2e/board-accessibility.spec.ts
  ```

**Session 9 / Phase 5C is complete** for all five findings. For sidebar and archived rows, A11Y-001 was resolved with the plan's label option, not with keyboard drag. Each final targeted pass had one environmental failure (host suspend; dev-server reload). The affected specs passed on a fresh-DB rerun.

---

# Session 10 / Phase 5D — Dashboard mutation behavior

- **Base:** `da0a8e6` (Session 9 committed; tree clean at start). No commit was created in this session.
- **Scope:** REACT-005 and REACT-004. Phase 6 was not started. Settings, the Session 8 `Dialog`/dialog stack and the Session 9 board semantics were not changed.

## Findings fixed and root causes

| Finding | Root cause | Fix |
|---|---|---|
| **REACT-005** | `ApplicationDashboard` passed `refreshKey={applications}` to Overview, Analytics and Stale, and each view listed `refreshKey` as a fetch-effect dependency. Every array identity change refetched: the optimistic `setApplications`, the reconciled one, and also the rollback of a failed move. One Archive therefore gave 2 `GET /api/dashboard/stale`, and a failed Archive gave 2 as well, with no server change. | A `dataRevision` counter is bumped by `reconcileApplications(update)`, which applies a **server-confirmed** result. The three views receive `refreshKey={dataRevision}`. The optimistic update and the rollback still use `setApplications` directly, so they no longer refetch. `reconcileApplications` is used for every server-confirmed write: import, purge, save and its 409 reload, delete, move and its 409 reload, interview date and its 409 reload, undo-status and its 409 reload, and delete-restore. The child components' effects are unchanged. |
| **REACT-004** | One render-scoped `movingId` state was both the guard and the UI lock. (1) A second move of **any** application during an in-flight PATCH returned early with no feedback. (2) Two calls in one render both passed the guard, and the first `finally` cleared the flag while the second was in flight. (3) Undo through the `moveApplication` fallback, which archive/restore undo uses because archive-only PATCHes return `latestStatusEventId: null`, resolved normally when dropped. `performUndo` had already dismissed the toast, so the undo was consumed. (4) A 409 inside that undo also resolved normally, so the toast was not re-offered. | **In-flight tracking:** per application, in a ref-backed `Set` (`movingIdsRef`, current within a render) with a mirrored `movingIds` state for rendering. `beginMove`/`endMove` add and remove only their own id.<br>**Result value:** `moveApplication` returns `"moved" \| "unchanged" \| "busy" \| "conflict" \| "failed"`. The busy check runs **before** the no-op check, because an in-flight move has already applied its optimistic state. A busy direct action (offerUndo) shows a toast: "{company} is still being updated. Try again in a moment."<br>**Undo:** `restoreLatestChange` throws on `busy` or `conflict`. `useToastUndo.performUndo`'s existing catch then re-offers the toast with its Undo. The `undo-status` branch also registers in the in-flight set and throws when busy. A 409 in the undo fallback no longer sets the page banner; the re-offered toast carries the same message the `undo-status` branch uses. |

## Implementation notes

- **Per-application UI lock:** the card, sidebar row, archived row and Stale Archive button are disabled only for their own in-flight application (`movingIds.has(id)`) instead of for every application. Delete-all in Settings stays disabled while any move is in flight (`movingIds.size > 0`). Purge clears the set, as it cleared `movingId` before.
- **Changed props:**
  - `KanbanBoard`/`KanbanColumn` and `ApplicationSidebar`/`ArchivedSection`: `movingId: string | null` became `movingIds: ReadonlySet<string>`.
  - `DashboardStaleApplications`/`StaleSeveritySection`: `archiveDisabled: boolean` became `movingIds`.
  - The `onRestore` prop keeps its `Promise<void>` type.
- **Unchanged:**
  - server revision checks, status history and undo-status semantics (no API or `src/lib` change);
  - the optimistic update and its rollback (status, archive, interview date and prompt flag);
  - the interview-date prompt after a move, focus after keyboard drop and undo, the toast timers, and the delete-recovery flow;
  - the child dashboard components' fetch, abort and keep-last-result logic, and every visual style.
- **Optional plan item not done:** moving the fetch calls into `src/lib/application-client.ts` (a first ARCH-004 slice). It was not needed for either fix and would have widened the diff.

## Reproduction evidence (unchanged code)

The new `tests/e2e/dashboard-mutations.spec.ts` was run against unchanged `da0a8e6` three times while its locators were corrected. The final pre-fix run (`repro3`) gave **6 failed**, each on the defect:

| Case | Pre-fix failure |
|---|---|
| REACT-005 Stale Archive | `stale.started` expected 1, **received 2** (neither aborted, as in D6) |
| REACT-005 failed Archive (PATCH fulfilled 500) | `stale.started` expected 0, **received 2** (optimistic plus rollback) |
| REACT-004 Alt+A on card 2 while card 1's PATCH is held | card 2 PATCH count expected 1, **received 0**: silently dropped |
| REACT-004 Undo of card A while card B's PATCH is held | Undo sent **no PATCH** (waitForResponse hit the 45 s test timeout): undo consumed |
| REACT-004 Undo of A while A's own restore PATCH is held | the shown toast was not found. The snapshot shows the wrapper `inert aria-hidden="true"` without `nook-toast-show`: Undo consumed, not re-offered |
| REACT-004 Undo that hits a real 409 (revision bumped through the API) | the same: toast dismissed, and only the page banner "This application changed elsewhere…" |

This moves REACT-004 from *Inferred* to **Confirmed** (all four symptoms), and it re-confirms REACT-005 (D6) plus the rollback variant.

Earlier pre-fix runs failed partly on test-side locators, which were then corrected:

- `getByRole("status")` also matched dnd-kit's live region. `getByRole("alert")` also matched Next's route announcer.
- A dismissed toast keeps its last text in the hidden wrapper. The helper now matches only `.nook-toast-wrap.nook-toast-show`.
- The first draft had an "Overview Restore" case, which was invalid: the archived section renders only on the Job Board, and the only in-page mutations on dashboard routes are Stale's Archive, Edit and Delete. It was replaced by the failed-Archive rollback case.

## Tests

**New `tests/e2e/dashboard-mutations.spec.ts` (6 cases):**

- REACT-005: one Stale Archive gives exactly one `/api/dashboard/stale` request, not aborted.
- REACT-005: a failed Stale Archive (500) rolls back, shows the banner, and makes zero stale requests.
- REACT-004 (held PATCH):
  - Alt+A on a second card during an in-flight move is sent and persisted.
  - Undo of a different application runs during an in-flight move.
  - Undo of the application whose own restore is in flight is re-offered with the "still being updated" message. No extra PATCH is sent, and the restore then completes.
  - A real 409 during Undo re-offers the toast with "changed elsewhere", and the second Undo applies.

Holds use `page.route` with a promise gate. No existing test was changed, and no `test.fail()` was added.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors, 2 warnings (the pre-existing unused `useSyncExternalStore` imports in `dashboard-overview.tsx:4` and `dashboard-stale-applications.tsx:3`, recorded in Sessions 8 and 9; left alone) |
| `npm run test:unit` | pass: 31 tests, plus 3 under New York and 3 under Dhaka |
| `npm run test:dashboard` (isolated DB) | pass: "Dashboard API states, history, rates, stale boundaries…" |
| `npm run test:smoke` (isolated DB) | **fail, pre-existing and unrelated:** `Dashboard must open without authentication` (307 !== 200) at `smoke-test.mjs:46`. `src/app/page.tsx` has been a server `redirect()` since Session 7 (`11f1da0`, REACT-008), and the smoke assertion was never updated. Session 7 onwards did not run the smoke suite. This session changed no route or server code. The rest of the smoke suite did not run after that first assertion, so its CRUD coverage is **unverified** this session. |
| `git diff --check` | pass. The new untracked spec has no trailing whitespace. |
| `git diff --exit-code tsconfig.json` | clean |

**Targeted Playwright** (each run through `scripts/run-playwright.sh` with its own isolated SQLite database):

| Run | Result |
|---|---|
| Post-fix pass 1: the new spec plus 21 affected specs (`analytics-heading`, `application-revision`, `backup-import-limits`, `backup-recovery`, `board-accessibility`, `deletion-recovery`, `dialog-focus`, `duplicate-import-focus`, `empty-state-copy`, `import-overlap`, `interview-date`, `interviews`, `kanban-layout`, `keyboard`, `navigation`, `scrollbars`, `settings-zoom`, `shortcut-panel-sections`, `shortcut-scope`, `sidebar-context`, `sidebar-interactions`) | **66 passed, 1 failed**: `shortcut-scope.spec.ts:5`, the Interviews search not focused after `/`. That test presses `/` straight after `goto` with no hydration wait, and the change doesn't touch the Interviews search path. It **passed** in the fresh rerun. Flake. |
| Fresh isolated rerun of the most affected specs (`dashboard-mutations`, `shortcut-scope`, `board-accessibility`, `sidebar-interactions`, `keyboard`, `backup-recovery`, `deletion-recovery`, `interview-date`, `empty-state-copy`, `analytics-heading`) | **42 passed, 1 failed**: `board-accessibility.spec.ts:113`. The live region read "…was not moved" and no PATCH was sent. The trace shows the first `/jobs` compile on that server, hydration done at 56.60 s, and Space/ArrowRight/Space at 56.67 s, 56.82 s and 56.84 s. This is the keyboard-sensor readiness race documented in Session 9 for a cold first drag. No move started, so no Phase 5D code ran. It passed in pass 1. |
| Isolated rerun of `board-accessibility` and `dashboard-mutations` | **13/13 passed** |

All 6 Phase 5D cases passed in all three post-fix runs. The full `npm run test:e2e` was not run.

## Files changed

- **Modified (app):** `src/components/application-dashboard.tsx`, `src/components/kanban-board.tsx`, `src/components/application-sidebar.tsx`, `src/components/dashboard-stale-applications.tsx`.
- **Added (test):** `tests/e2e/dashboard-mutations.spec.ts`.
- **Report:** this file (gitignored).

## Problems encountered and incorrect assumptions

- **Plan test "one Archive → one stale request" covers only half of REACT-005.** The rollback of a failed move also refetched twice, which the audit did not list. It is now covered.
- **Audit evidence for REACT-004** described the undo drop through `moveApplication`. The `undo-status` branch, used for real status moves, never consulted the guard, so an undo racing its own application's move relied only on the server's revision check. It now shares the per-ID guard.
- **Per-ID tracking implies per-ID UI locking.** Under the old global lock, every card, row and Stale button was disabled during any move. Keeping that lock would have left the per-ID guard mostly unreachable from pointer input.
- **Test-side locator mistakes** in the first drafts (above). An invalid Overview case was replaced.
- **`test:smoke` is red from Session 7**, as described above. It was found here, not caused here.

## Behavior intentionally changed

- Other applications stay draggable and clickable while one application's move is in flight. Only the moving application's card, row or Archive button is disabled.
- A second action on an application that is still moving shows a toast instead of silently doing nothing.
- An Undo that cannot run now (the application is busy) or that conflicts (409) keeps its toast and Undo button, with an explanation. A conflicting archive/restore Undo no longer shows the page banner; the toast carries the message.
- Dashboard views refetch once per server-confirmed change, and not at all for a failed move.

## Deferred (not started)

- **Phase 6** and later.
- **Optional:** moving the dashboard's fetch calls into `src/lib/application-client.ts` (ARCH-004 slice).
- **`scripts/smoke-test.mjs:45-47`:** expects `/` to return 200, but it has redirected since Session 7. This needs a decision on whether the test should follow the redirect or assert 307 to the startup page (Phase 8 test cleanup or a dedicated fix).
- **Test harness timing:**
  - `shortcut-scope.spec.ts:5` has no hydration wait before pressing `/`;
  - `board-accessibility.spec.ts:113` still loses the cold-server first keyboard drag occasionally;
  - `sidebar-layout.spec.ts` has no hydration wait either (Session 9).
- The pre-existing lint warnings.

## Data safety and final repository state

- **`prisma/dev.db`** was never opened, queried or copied. After the session it is **53,248 bytes**, mtime epoch **1790487979**, SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`**, matching the baseline.
- **Temporary artifacts:**
  - No `.next-playwright*`, `tsconfig.playwright.json` or `/private/tmp/nook-*` remains, and no Next or Playwright process is running.
  - Logs and extracted traces are in the session scratchpad.
  - The gitignored `test-results/` holds Playwright's output from the last run.
- **Final `git status -sb`:**

  ```text
  ## main...origin/main [ahead 10]
   M src/components/application-dashboard.tsx
   M src/components/application-sidebar.tsx
   M src/components/dashboard-stale-applications.tsx
   M src/components/kanban-board.tsx
  ?? tests/e2e/dashboard-mutations.spec.ts
  ```

**Session 10 / Phase 5D is complete** for REACT-005 and REACT-004. Both were reproduced on unchanged code, then fixed. The new spec passed in all three post-fix runs. The remaining red items are pre-existing: the stale `test:smoke` root-route assertion and two known Playwright timing flakes, each of which passed on rerun.

## Session 10 addendum — deferred verification and test issues closed

Done before closing Session 10, at your request. Phase 6 was not started. The optional `src/lib/application-client.ts` refactor was deliberately **not** done. No application behavior changed; the only app edits are the two unused imports.

### Smoke test corrected

- **Cause:** `scripts/smoke-test.mjs` expected `GET /` to return 200. Session 7 (REACT-008, `11f1da0`) made `/` a server `redirect()` to the saved `startupPage`. Routing was not changed.
- **Fix:** the test reads `/api/settings` and maps `startupPage` to its path (`dashboard` → `/dashboard`, `job-board` → `/jobs`, `interviews` → `/interviews`). It then asserts:
  - `GET /` returns **307**, with `Location` set to that path;
  - the startup page returns 200 without sign-in text.

  This follows the existing `/login` redirect assertions.
- **Result:** `npm run test:smoke` passes, and the whole suite now runs: "Passed: no-login routing, CRUD, all status moves, SQLite persistence, event history, validation, and cascade deletion."

### Playwright flakes fixed

Neither of the previous readiness signals proved anything:

- `await expect(Settings).toBeEnabled()`, used by many specs: the Settings button is never disabled, so this already holds on the server HTML.
- No wait at all (`shortcut-scope`, `sidebar-layout`).

**New shared helper `gotoReady(page, path)` in `tests/e2e/api-helpers.ts` (test-only):**

- An init script wraps `EventTarget.prototype.addEventListener`. It records when `useDashboardShortcuts` attaches its document `keydown` listener `handleShortcut`, which happens in a passive effect.
- The helper navigates, then waits for that flag, so it proves the shell hydrated **and** ran its effects.
- The init script re-runs on every reload, so a reloaded page must attach the listener again.
- The probe matches a function name (preserved: `next dev`, no React Compiler). If the name changes, the wait times out loudly; it cannot pass silently.

| Flake | Root cause | Fix |
|---|---|---|
| `shortcut-scope.spec.ts:5` | Pressed `/` straight after `goto`, possibly before the shortcut listener existed. The `/dashboard` half ("`/` does nothing") could pass trivially before hydration. | `gotoReady(page, route)` before each `/` press. The negative assertion is now meaningful. |
| `sidebar-layout.spec.ts:3` and `:57` | Clicked Collapse straight after `goto` with no hydration wait. | `gotoReady` before the first interaction in both tests. |
| `board-accessibility.spec.ts:128` (was `:113`) | **Corrected diagnosis.** Session 9 blamed arrows arriving before dnd-kit was ready, and its `rAF×2 + setTimeout(0)` helper covered only that. A trace from this session's first attempt showed pre-arrow readiness met in about 30 ms, with the live region still reading "…was not moved". The real race is **ArrowRight → dropping Space**: the KeyboardSensor listens natively, so the move is a non-discrete React update that renders asynchronously. `handleEnd` then reads the last rendered `over`. Space was sent 3 ms after ArrowRight here (about 20 ms in the earlier failure), while `over` was still the origin. | `waitForKanbanKeyboardDrag(page, "APPLIED")` handles pre-arrow readiness: the origin column's `bg-forest-tint` (`isOver`) appears only once the rects and collision rect are measured. A `setTimeout(0)` then runs after the sensor's own listener-attach timer, because equal-delay timers run FIFO. **Before the drop**, the test now waits for the target column (`ONLINE_ASSESSMENT`) to have `bg-forest-tint`. That class and dnd-kit's context ref are updated in the same commit. `openJobBoard` in this spec (and in `dashboard-mutations.spec.ts`) now uses `gotoReady`. |

No sleeps were added, no timeouts were raised, and no assertion was weakened or removed. The Settings board-reorder drag (A11Y-007) keeps its existing `waitForKeyboardSensor` helper and was not touched.

### Lint warnings removed

The unused `useSyncExternalStore` imports were removed from `src/components/dashboard-overview.tsx:4` and `src/components/dashboard-stale-applications.tsx:3`. They were confirmed unused: each was the only occurrence in its file. `npm run lint`: **0 errors, 0 warnings**.

### Verification (addendum)

| Check | Result |
|---|---|
| `npm run typecheck` | pass (includes `tests/e2e`) |
| `npm run lint` | pass, no problems reported |
| `npm run test:unit` | pass: 31, plus 3 under New York and 3 under Dhaka |
| `npm run test:dashboard` (isolated DB) | pass |
| `npm run test:smoke` (isolated DB) | pass, full suite |
| `git diff --check` | pass. `git diff --exit-code tsconfig.json` is clean. |

**Playwright:** `shortcut-scope`, `board-accessibility`, `sidebar-layout` and `dashboard-mutations`, `--repeat-each=2`. Each run used its own fresh isolated DB and a cold dev server.

| Run | Result |
|---|---|
| A: first attempt, pre-arrow readiness only | 36 passed, **2 failed**: `board-accessibility` keyboard drag in both repeats, "…was not moved". This run produced the corrected diagnosis above. |
| B: after the pre-drop wait | **37 passed, 1 failed.** All three target flakes passed 2/2. The failure was `board-accessibility.spec.ts:164` (row pointer drag). Its body passed completely; the shared `cleanState` fixture's **teardown** `DELETE /api/applications/purge` got `read ECONNRESET` from the dev server. This is not a readiness problem (see below). |
| C: fresh verification rerun | **38/38 passed** |

Across B and C, each target test passed **4/4**: `shortcut-scope:5`, `sidebar-layout:3`, `sidebar-layout:57` and `board-accessibility:128`. The full E2E suite was not run: only test files and one shared test helper changed, and no app runtime code changed in this addendum.

### Cleanup-fixture `ECONNRESET` fixed

**Root cause and evidence:**

- **Observed once** (run B above): `board-accessibility.spec.ts:164` passed its whole body, then the auto `cleanState` fixture's **teardown** `DELETE /api/applications/purge` failed with `apiRequestContext.delete: read ECONNRESET`.
- **Mechanism:** the fixture reused the test's pooled `request` context. That test last used the context during setup, then spent about 6 s in the browser. Next's dev server sets `server.keepAliveTimeout` only when `--keepAliveTimeout` is passed (`next/dist/server/lib/start-server.js:248`), and the Playwright webServer command does not pass it. So Node's default of **5 s** applies. After more than 5 s idle, the client can reuse a keep-alive socket at the moment the server closes it, and the request gets a TCP reset.
- **Classification:** a transport failure in the test harness. The purge route itself was not involved.
- **Certainty:** the timing mechanism is inferred from these facts. It was not caught in a packet trace.

**Exact change (`tests/e2e/api-helpers.ts`):**

- `cleanState` no longer depends on the test's `request` fixture.
- Setup and teardown each call `resetState()`. That runs `purgeApplications` and `resetSettings` separately through a new `withFreshRequest(step)`:
  - It creates a fresh context: `request.newContext({ baseURL: PLAYWRIGHT_BASE_URL })`, imported as `playwrightRequest` from `@playwright/test`.
  - It runs the step, then always disposes the context in `finally`.
- `purgeApplications` and `resetSettings` are unchanged. They still send `sameOriginMutationHeaders` (the `Origin` header), and they still hit the runner's isolated server and database through `PLAYWRIGHT_BASE_URL`.
- No sleeps were added, and no timeouts were changed.

**Retry policy:**

- **What retries:** an error whose message contains `ECONNRESET` retries the step **once**, on another fresh context. A second reset is rethrown.
- **What does not retry:** any other error, including every HTTP status failure. The step's own `expect(response.status())…` assertions throw immediately.
- **Why this is safe:** both steps are idempotent. Purge is a delete-all. The settings reset reads the current revision, then writes the defaults.

**Proof that the policy does not mask failures** (a scratch Playwright run of the real fixture against a scratch `node:http` server; no app and no database):

| Server mode | Fixture result | Purge attempts |
|---|---|---|
| `ok` | pass | 2 (setup and teardown) |
| `reset-once` (`socket.resetAndDestroy()` on the first purge) | pass | 3 (reset, one retry, teardown) |
| `reset-always` | **fail**: `apiRequestContext.delete: read ECONNRESET` | 2 (exactly one retry) |
| `http-500` | **fail**: `Expected: 200 / Received: 500` | 1 (not retried) |

**Repeated Playwright results:** `board-accessibility`, `dashboard-mutations`, `shortcut-scope` and `sidebar-layout`, `--repeat-each=3`. Each run used a fresh isolated database and a cold dev server, for 57 tests and 57 fixture teardowns per run.

| Run | Result |
|---|---|
| Cleanup pass A | **57/57 passed**, 0 `ECONNRESET` in the log |
| Cleanup pass B (fresh DB) | **57/57 passed**, 0 `ECONNRESET` in the log |

The retry is silent by design. These runs therefore show only that no cleanup failed, not whether a reset occurred and was retried.

**Other verification after this change:**

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, with 0 warnings and 0 errors |
| `npm run test:unit` | 31, plus 3 under New York and 3 under Dhaka, all pass |
| `npm run test:dashboard` | pass |
| `npm run test:smoke` | pass, full suite |
| `git diff --check` | pass |
| `git diff --exit-code tsconfig.json` | clean |

### Files changed (Session 10 total)

- **App:** `src/components/application-dashboard.tsx`, `kanban-board.tsx`, `application-sidebar.tsx`, `dashboard-stale-applications.tsx` (Phase 5D and one unused import), and `dashboard-overview.tsx` (unused import only).
- **Tests:**
  - `scripts/smoke-test.mjs`;
  - `tests/e2e/api-helpers.ts` (readiness helper and cleanup contexts);
  - `tests/e2e/board-accessibility.spec.ts`, `shortcut-scope.spec.ts` and `sidebar-layout.spec.ts`;
  - `tests/e2e/dashboard-mutations.spec.ts` (new).

### Data safety and final state

- **`prisma/dev.db`** was never opened, queried or copied. It is **53,248 bytes**, mtime **1790487979**, SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`**, unchanged.
- **Temporary artifacts:** no `.next-playwright*`, `tsconfig.playwright.json` or `/private/tmp/nook-*` remains, and no Next, Playwright or probe-server process is running. Logs, traces and the retry-probe files are in the session scratchpad only.
- **Final `git status -sb`:**

  ```text
  ## main...origin/main [ahead 10]
   M scripts/smoke-test.mjs
   M src/components/application-dashboard.tsx
   M src/components/application-sidebar.tsx
   M src/components/dashboard-overview.tsx
   M src/components/dashboard-stale-applications.tsx
   M src/components/kanban-board.tsx
   M tests/e2e/api-helpers.ts
   M tests/e2e/board-accessibility.spec.ts
   M tests/e2e/shortcut-scope.spec.ts
   M tests/e2e/sidebar-layout.spec.ts
  ?? tests/e2e/dashboard-mutations.spec.ts
  ```

**Status:** Session 10 has **no known deferred verification or test issue**:

- The smoke test, the three named flakes, the lint warnings and the cleanup-fixture `ECONNRESET` are fixed and verified.
- The only open item is the intentionally skipped optional `src/lib/application-client.ts` refactor.

---

# Session 11 / Phase 6 — remaining Low correctness and product decisions

**Scope:** CALC-002, BIZ-001, BIZ-004, BAK-002 conflict messaging, TEST-006 decision, DATE-002 and BIZ-003. UI-003 was optional in the Phase 6 plan and remains deferred. No Phase 7 work, migration, optional `application-client.ts` refactor, manual UI test or commit was done.

## Findings, root causes and implementation

| Finding | Root cause and Phase 6 result |
|---|---|
| CALC-002 | Rates count each status independently, so a direct Applied → Offer skips the Interview numerator. Retained the calculation and added a native tooltip to every rate card explaining that it counts applications that reached that exact status. |
| BIZ-001 | Overview counts only active upcoming Interview applications; the sidebar and Interviews page count all dated applications. Renamed the Overview **card** “Active upcoming interviews”. The Interviews page's heading now counts the search-filtered upcoming rows while its unfiltered sidebar badge stays unchanged. |
| BIZ-004 | The dismissal flag stayed true across Interview → another status → Interview. The shared revision-checked PUT/PATCH update clears it when leaving Interview. Archive-only updates and edits that stay in Interview preserve it. |
| BAK-002 | A changed application ID made an atomic import fail with raw IDs. The 409 now names the existing record's company and role and states that no applications or settings were imported. The `conflicts` ID array, 409 status, identical-record skip, event-ID collision handling and all-or-nothing transaction remain. The 409 message documents the atomic behavior; user-facing backup documentation remains scheduled for Phase 9. |
| TEST-006 | Chose to retain plain permanent DELETE for API callers and tests; the UI still uses `?undoable=1`. Added a route comment and an API assertion that plain DELETE creates no undo snapshot. The separate Phase 8 smoke-comment cleanup was not started. |
| DATE-002 | `subscribeToLocalDate` installed one midnight timer. Moved it into `src/lib/local-date-subscription.ts`, re-arm it after every midnight, and notify and re-arm when the tab becomes visible. Unsubscription clears the timer and listener. |
| BIZ-003 | Sidebar and Interviews searched differently; client sorts ignored the server's `createdAt` tie-break. Both now use `matchesApplicationSearch`; every dashboard application re-sort uses `compareApplications`, matching the API's `appliedDate desc, createdAt desc`. Interview-date grouping and past-date sort remain specific to the Interviews page. |

## Reproduction and regression evidence

- The audit ledger's Session C/B evidence reproduced the independent milestone rates, count divergence, permanent dismissal, mismatched search, and one-shot timer on the original code; Session B also reproduced the raw backup conflict. Source inspection before this session's edits confirmed every corresponding path. The new helper tests were run before the helper files existed and failed to import; that was a test-setup failure, **not** a behavioral red test. The new API and UI tests were not run against an unchanged tree, so their first behavioral result is the post-fix pass.
- `scripts/dashboard-api-test.mjs` now verifies a direct Applied → Offer keeps Interview at zero and Offer at one, plus dismissal → leave Interview → return clears the dismissal. **Passed** on an isolated database.
- `scripts/backup-api-test.mjs` now verifies a named 409, unchanged application count and settings, and that plain DELETE creates no undo snapshot. **Passed** on isolated databases, including a rerun after changing the conflict name to the existing record.
- `scripts/application-list-test.mjs` verifies trimmed, cross-field search and the same-date createdAt tie-break. `scripts/local-date-subscription-test.mjs` uses fake timers for two midnights and visibility notification; it passed in the default zone, America/New_York and Asia/Dhaka.
- Targeted `tests/e2e/phase6-copy-search.spec.ts` verifies the Overview name and rate tooltip on Overview/Analytics, and the filtered Interviews heading after a cross-field search. **2/2 passed** with the isolated Playwright database. The full E2E suite was not run.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | pass, including after the final conflict-message edit |
| `npm run lint` | pass, including after the final edit |
| `npm run test:unit` | pass: 34 default-zone tests and 4 each under New York and Dhaka |
| `npm run test:dashboard` | pass, isolated SQLite/test server |
| `npm run test:backup` | pass twice, isolated SQLite/test server |
| `npm run test:smoke` | pass, isolated SQLite/test server |
| `bash scripts/run-playwright.sh tests/e2e/phase6-copy-search.spec.ts` | 2 passed, isolated SQLite/test server |
| `git diff --check` | pass |

## Files changed

- Application: `src/app/api/applications/[id]/route.ts`, `src/app/api/applications/import/route.ts`, `src/components/application-dashboard.tsx`, `src/components/dashboard-analytics.tsx`, `src/components/dashboard-metric-card.tsx`, `src/components/dashboard-overview.tsx`, `src/components/interviews-list.tsx`; new `src/lib/application-list.ts` and `src/lib/local-date-subscription.ts`.
- Regression coverage: `scripts/backup-api-test.mjs`, `scripts/dashboard-api-test.mjs`, `package.json`; new `scripts/application-list-test.mjs`, `scripts/local-date-subscription-test.mjs`, `tests/e2e/phase6-copy-search.spec.ts`.
- Record: this gitignored `audit/audit-20260928/audit-fix.md`.

## Problems, plan assumptions and deferred items

- The plan lists TEST-006 as a Phase 6 product decision but assigns its cleanup to Phase 8 in the finding map. This session made the decision and pinned the existing DELETE behavior; it did not take on the broader Phase 8 cleanup.
- The first fake-timer test specified `clearTimeout` in Node's `apis` list, which Node 26 does not accept. Removing that unsupported test option made the test run; no assertion was weakened.
- The first unit run failed because the two new helper modules did not exist yet. It did not prove a pre-fix behavioral failure. The original audit's reproduction and source inspection are the pre-fix evidence.
- UI-003 is optional in the remediation plan; no retry/layout work was added. Phase 7 and later cleanup/documentation, including the full backup semantics in Phase 9, remain deferred. The optional `application-client.ts` refactor remains deferred.

## Data safety and final repository state

- `prisma/dev.db` was not used by any test, opened in SQLite, queried, copied or modified. The final metadata/hash check is **53,248 bytes**, mtime epoch **1790487979**, SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`**, matching the required baseline.
- The isolated API and Playwright runners removed their temporary databases and server directories. No `.next-playwright` or `tsconfig.playwright.json` remains.
- Final `git status -sb`:

  ```text
  ## main...origin/main [ahead 11]
   M package.json
   M scripts/backup-api-test.mjs
   M scripts/dashboard-api-test.mjs
   M src/app/api/applications/[id]/route.ts
   M src/app/api/applications/import/route.ts
   M src/components/application-dashboard.tsx
   M src/components/dashboard-analytics.tsx
   M src/components/dashboard-metric-card.tsx
   M src/components/dashboard-overview.tsx
   M src/components/interviews-list.tsx
  ?? scripts/application-list-test.mjs
  ?? scripts/local-date-subscription-test.mjs
  ?? src/lib/application-list.ts
  ?? src/lib/local-date-subscription.ts
  ?? tests/e2e/phase6-copy-search.spec.ts
  ```

**Phase 6 is complete** for all required items. Optional UI-003 and later-phase documentation/cleanup remain deferred.

---

# Session 12 / Phase 7 — Performance

**Scope:** PERF-004 and PERF-002 only. PERF-001 and PERF-003 remain deferred. No Session 13 cleanup, migration, manual UI test, browser test, or commit was performed.

## Findings, root causes, and implementation

| Finding | Root cause | Change |
|---|---|---|
| PERF-004 | The root `ThemeProvider` imported `settings-store`, which imported `settings-defaults`; the defaults called `settingsSchema.parse` at module load. That value import brought Zod and the Prisma browser runtime through `backup-settings-schema` into every route. `MotionPreference` also reached a Prisma `Status` value import through `general-preferences`. | `settings-defaults.ts` is now a literal checked by the `ParsedBackupSettings` type. A small local `STATUS_VALUES` list supplies enum names to settings validation and preferences; the affected UI helpers use type-only `Status` imports. Validation remains in `backup-settings-schema.ts` for actual settings and backup inputs. |
| PERF-002 | Overview analyzed each history about 6 times, analytics about 6 times, and stale about 2 times per request. `rateFor` also recomputed identical history coverage. The stale response serialized the same items in `applicationsBySeverity`, `applications`, and `top`, although the client reads only the groups. | `loadApplications` now attaches one status-history analysis per loaded application; rates, coverage, and stale calculations reuse it. Each endpoint computes coverage once. The stale response retains grouped items, counts, and timing coverage, and omits `applications` and `top`. The dashboard API test now checks the retained response shape and derives ordered items from the groups. |

## Before and after evidence

- A fresh baseline build of the Session 11 tree, then the post-change build, were inspected using the `/page`, `/dashboard/page`, and `/jobs/page` client-reference manifests and their referenced `.next/static/chunks` files. The same manifest-only method was used for both, so these numbers are comparable to each other; they do not include Next's separate root main files.

  | Route | Before referenced chunks / raw / gzip -9 | After referenced chunks / raw / gzip -9 | Zod and Prisma marker chunk |
  |---|---:|---:|---|
  | `/` | 2 / 450,529 / 111,408 bytes | 1 / 17,453 / 4,838 bytes | Before: `20343g5dds4h1.js`, 433,043 raw / 106,554 gzip; after: absent from `/` |
  | `/dashboard` and `/jobs` | 4 / 641,686 / 165,892 bytes each | 4 / 640,667 / 165,425 bytes each | Still present for dashboard client features in `0u9jil42rft8g.js` |

- Source inspection before the change gave about **6N → N** status-history analyses for Overview, **6N → N** for Analytics, and **2N → N** for Stale, where N is the number of applications loaded by that request. This is an analysis-count comparison, not a measured latency claim.
- The isolated dashboard API fixture with six stale items produced **1,408 bytes** in the new JSON shape. Reconstructing the old shape from those same items by adding `applications` and `top` gives **3,181 bytes**. The audit's earlier 5,000-record stale response was 681 KB; that earlier measurement used a different fixture and is not a direct before/after timing comparison.

## Verification

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm run test:unit`: pass (34 default-zone tests, 4 New York tests, 4 Dhaka tests).
- `npm run test:dashboard`: pass on an isolated SQLite database. It pins rates, history coverage, stale ordering, thresholds, calendar and timezone boundaries, and the new response shape. The client reads `applicationsBySeverity` only.
- `npm run test:backup` and `npm run test:smoke`: pass on isolated SQLite databases, including settings validation, backup round trips, CRUD, and routing.
- `npm run build`: pass after the changes; baseline build also passed.
- `git diff --check`: pass.
- No Playwright run: these changes preserve UI behavior; the stale API contract was covered by the API test and source inspection of its client.

## Files changed

- Application: `src/lib/settings-defaults.ts`, `src/lib/status-values.ts` (new), `src/lib/general-preferences.ts`, `src/lib/backup-settings-schema.ts`, `src/lib/status-meta.ts`, `src/lib/board-preferences.ts`, `src/lib/dashboard-analytics.ts`.
- Regression coverage: `scripts/dashboard-api-test.mjs`.
- Record: this gitignored `audit/audit-20260928/audit-fix.md`.

## Problems, assumptions, and deferred work

- The pre-existing `.next` build was older than the Session 11 tree. A fresh pre-change build was required for a valid bundle comparison.
- Turbopack strips module paths from production chunks. Zod and Prisma marker presence/absence, manifest references, and the source import chain support the bundle conclusion; the chunk data do not attribute every byte to an individual module.
- The 3,181-byte stale baseline is a reconstruction of the former response shape using the post-change fixture, not a separately captured pre-change HTTP response. No production latency benchmark was run.
- PERF-001 remains deferred because its full-list page payload requires a larger shell/data-loading refactor. PERF-003 remains deferred pending profiling; neither finding was changed here. Session 13 cleanup was not started.

## Data safety and final repository state

- `prisma/dev.db` was not opened in SQLite, queried, copied, or modified. Final metadata/hash: **53,248 bytes**, mtime epoch **1790487979**, SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`**; all match the required baseline.
- Final `git status -sb`:

  ```text
  ## main...origin/main [ahead 12]
   M scripts/dashboard-api-test.mjs
   M src/lib/backup-settings-schema.ts
   M src/lib/board-preferences.ts
   M src/lib/dashboard-analytics.ts
   M src/lib/general-preferences.ts
   M src/lib/settings-defaults.ts
   M src/lib/status-meta.ts
  ?? src/lib/status-values.ts
  ```

**Phase 7 is complete** for PERF-004 and PERF-002. PERF-001 and PERF-003 remain explicitly deferred.

---

# Session 13 / Phase 8 — Cleanup, configuration, dependencies

**Scope:** ARCH-002, CLEAN-001, the rest of CLEAN-003, the rest of ARCH-003 (types), ARCH-005 (type move), DEP-001, DEP-002, DEP-003, the TEST-006 cleanup/documentation part, and DOC-003. This session did no Phase 9 documentation work (DOC-001, DOC-002), no PERF-001/PERF-003 work, no migrations, no manual UI testing and no commits.

## Findings, root causes and changes

| Finding | Root cause | Change |
|---|---|---|
| ARCH-002 | The startup-page, stale-threshold and board-color literals were declared in `backup-settings-schema.ts`, in `general-preferences.ts`/`board-preferences.ts`, and again as the `ApplicationPageName` union (and inline copies in `application-sidebar.tsx` and `keyboard-shortcuts.ts`). | New `src/lib/settings-values.ts` holds `STARTUP_PAGES`, `STALE_THRESHOLDS` and `BOARD_COLORS`. The settings schema, `board-preferences`, `board-settings` and `settings-modal` import from it. Board and default-board statuses use the existing `STATUS_VALUES`. `ApplicationPageName` is derived from `STARTUP_PAGES`, and the sidebar and shortcut modules use it instead of their own unions. The module is deliberately **zod-free**. Exporting the constants from `backup-settings-schema.ts`, as the ledger suggested, would have put zod back on every route through the root layout and undone Session 12's PERF-004 fix. |
| CLEAN-001 | Functions and types that nothing used were left behind by earlier refactors. | Removed `undoDeleteRecovery` (from `use-toast-undo`), `parseStatusTransitionDetail` with its regex (from `status-history`), `statusLabel` (from `status-meta`), and the types `StartupPage`, `StaleApplicationThreshold`, `DefaultBoardStatus` and `BackupSettings`. `parseStatusTransitionDetail` was used only by two assertions in `status-history-test.mjs`, added in Session 5. Those assertions tested dead code and were removed with it. The rest of that test is unchanged. Per the ledger's "can stay" option, the exports that are only used in their own file were left alone. |
| CLEAN-003 (remaining) | Magic values were duplicated or inline. | The sidebar receives `minWidth`/`maxWidth` from the dashboard's `MIN_/MAX_SIDEBAR_WIDTH` instead of hard-coding `aria-valuemin={304}`/`aria-valuemax={420}`. In CSS, a single `--sidebar-default-width: 320px` feeds `--sidebar-width` and both narrow-screen `min()` rules; a comment ties it to `DEFAULT_SIDEBAR_WIDTH`. `UNDO_SNAPSHOT_TTL_MS` lives in `undo-snapshots.ts` and is used by the DELETE route. The stale cutoffs are named `STALE_CRITICAL_DAYS`/`STALE_HIGH_DAYS`. The board and board-settings sensors share `TOUCH_ACTIVATION_CONSTRAINT`. Their pointer distances (8 vs 6) are intentionally different and stay as they are. Every value is unchanged. |
| ARCH-003 (types) | Domain types were declared in components, and hooks imported types from components. | `JobFormState` moved to `src/types/application.ts`. `ApplicationPageName` and `DashboardSection` moved to the new `src/types/navigation.ts`. No hook imports a type from a component any more. |
| ARCH-005 | Client components got their response types through `import type` of functions in the Prisma-backed `dashboard-analytics.ts`. | The new `src/types/dashboard.ts` defines the response types explicitly. `getDashboardOverview`, `getStaleApplications` and `getDashboardAnalytics` are annotated with them, so the compiler checks that the implementation matches. The three client components import only from `@/types/dashboard`, and no client file references `dashboard-analytics` any more. `server-only` was **not** added, because it is a new package that needs approval. |
| DEP-001 | Version pinning was mixed, and there was no `engines` field. | The four caret ranges are pinned to the versions already in the lockfile: `@dnd-kit/core` 6.3.1, `@dnd-kit/utilities` 3.2.2, `lucide-react` 1.48.0, `@playwright/test` 1.63.0. Added `"engines": { "node": "^22.18.0 \|\| >=23.6.0" }`, the floor set by the Phase 3 loader: `module.registerHooks` (22.15 / 23.5) and TypeScript stripping enabled by default (22.18 / 23.6). This is above Next 16.3.5's `>=20.9.0`. The lockfile root entry was updated to match. |
| DEP-002 | `db:migrate` (`prisma migrate dev`) could offer to reset a database created with `db push`. `.gitignore` both ignored and re-included `prisma/migrations/`. | Removed `db:migrate`; `npm run setup` already runs `db push`. Removed the `!prisma/migrations/` and `!prisma/migrations/**` negations, plus a redundant `.DS_Store` line (already ignored globally). The section comment now states the `db push` policy. `git check-ignore` shows that `prisma/migrations/x.sql` is ignored. |
| DEP-003 (AGENTS.md) | `AGENTS.md` (and its `CLAUDE.md` include) were gitignored, although they are the project's instruction files and Next's generated footer says to commit them. | Removed both ignore lines, so the files now appear as untracked (`??`) and are ready to commit. The ESLint part was already done in Session 6. |
| TEST-006 (cleanup) / DOC-003 | The smoke test's header said "Run against a running local app", which contradicts the isolated runner and AGENTS.md. The legacy `/login` and `/api/auth/session` assertions were framed as an auth guard. | The header now says to run it only through `npm run test:smoke`, on an isolated server and database. The catch-all assertion checks that unknown page and API paths (`/no-such-page`, `/api/no-such-route`) redirect to `/dashboard`, and the pass message now says "startup and unknown-route redirects". The plain-DELETE decision and its route comment were already made in Session 11. |

## Compatibility decisions

- **CLEAN-002 is not removed.** `emailSnippet` and `NOTE_ADDED` stay in the Prisma schema and in the v1 backup schema. The backup stays `"version": 1`, and no backup schema rules changed. `backup-settings-schema.ts` builds the same enums from the shared constants.
- The API contracts are unchanged. The explicit dashboard types describe exactly the fields the routes returned before, and `test:dashboard` pins the response shapes.
- The package name `application-tracker` is kept; the plan lists the rename as deliberately not done.
- No dependency was added, removed or upgraded. npm regenerates a byte-identical lockfile.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (0 warnings) |
| `npm run test:unit` | pass: 34 default-zone tests, 4 New York, 4 Dhaka |
| `npm run test:dashboard` | pass (isolated SQLite and test server) |
| `npm run test:backup` | pass (isolated) |
| `npm run test:smoke` | pass (isolated), including the renamed unknown-route assertion |
| `npm run build` | pass ("Compiled successfully in 6.8s", 9/9 static pages, Proxy present) |
| PERF-004 preserved | The `/page` client-reference manifest lists 1 chunk (17,453 bytes) with no zod or Prisma markers, the same as Session 12's post-fix figure |
| Lockfile | Scratch-copy `npm install --package-lock-only --offline` produced a lockfile identical to the edited one; `npm ls --depth=0` exits 0 |
| Targeted Playwright (the sidebar width props and CSS variable affect runtime layout): `bash scripts/run-playwright.sh tests/e2e/sidebar-resize.spec.ts tests/e2e/sidebar-layout.spec.ts tests/e2e/sidebar-navigation.spec.ts` | **6 passed** (1.1 min), isolated database; no `.next-playwright` or `tsconfig.playwright.json` left behind |
| `git diff --exit-code tsconfig.json` | unchanged |
| `git diff --check` | pass |
| Stale-reference grep (removed symbols, old type import paths, `db:migrate`) | none found |

The full E2E suite was not run, and no manual UI test was done.

## Files changed

- New: `src/lib/settings-values.ts`, `src/types/dashboard.ts`, `src/types/navigation.ts`.
- Application: `src/app/api/applications/[id]/route.ts`, `src/app/globals.css`, `src/components/application-dashboard.tsx`, `application-page.tsx`, `application-sidebar.tsx`, `board-settings.tsx`, `dashboard-analytics.tsx`, `dashboard-overview.tsx`, `dashboard-stale-applications.tsx`, `job-modal.tsx`, `settings-modal.tsx`; `src/hooks/use-application-backup.ts`, `use-board-drag.ts`, `use-dashboard-shortcuts.ts`, `use-toast-undo.ts`; `src/lib/backup-settings-schema.ts`, `board-preferences.ts`, `dashboard-analytics.ts`, `general-preferences.ts`, `keyboard-shortcuts.ts`, `status-history.ts`, `status-meta.ts`, `undo-snapshots.ts`; `src/types/application.ts`.
- Tests: `scripts/smoke-test.mjs`, `scripts/status-history-test.mjs`.
- Config: `package.json`, `package-lock.json`, `.gitignore`. `AGENTS.md` and `CLAUDE.md` themselves are unchanged and now untracked rather than ignored.
- Record: this gitignored `audit/audit-20260928/audit-fix.md`.

## Problems and incorrect assumptions

- The ledger's ARCH-002 advice (export the constants from `backup-settings-schema.ts`) had become unsafe after Phase 7, because that module imports zod. A zod-free shared module was used instead, and the build manifest confirmed PERF-004 still holds.
- CLEAN-001 listed `parseStatusTransitionDetail` as dead, but Session 5 had since added unit assertions for it. It is still unused in production, so the function and those two assertions were removed together.
- The DEP-001 `engines` floor comes from Node's documented version history for `registerHooks` and default type stripping. It was verified at runtime only on the installed Node **26.8.2**; no Node 22 or 24 binary is available here.
- DEP-003 was a choice between tracking the files and keeping them local. Tracking was chosen because the audit found the ignore contradicted the files' role and Next's generated footer, and because Phase 9 (DOC-002) edits AGENTS.md. Re-adding the two ignore lines reverts it.
- No test failed during the session.

## Deferred

- ARCH-005 `server-only` guard: needs approval for the new package.
- PERF-001 and PERF-003: explicitly out of scope.
- The file-local exports noted in CLEAN-001 were left in place.
- Optional package rename.
- Phase 9 / Session 14: DOC-001 (README: the Undo text, import semantics, the limits, the Node version from this session's `engines`, and the `db push` policy) and DOC-002, plus the final verification. Not started.

## Data safety and final repository state

- `prisma/dev.db` was not opened, queried, copied or modified. Final check: **53,248 bytes**, mtime epoch **1790487979**, SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`**, matching the baseline. All API and browser tests used isolated temporary databases, and no `/private/tmp/nook-*` directory remains.
- Final `git status -sb`:

  ```text
  ## main...origin/main [ahead 13]
   M .gitignore
   M package-lock.json
   M package.json
   M scripts/smoke-test.mjs
   M scripts/status-history-test.mjs
   M src/app/api/applications/[id]/route.ts
   M src/app/globals.css
   M src/components/application-dashboard.tsx
   M src/components/application-page.tsx
   M src/components/application-sidebar.tsx
   M src/components/board-settings.tsx
   M src/components/dashboard-analytics.tsx
   M src/components/dashboard-overview.tsx
   M src/components/dashboard-stale-applications.tsx
   M src/components/job-modal.tsx
   M src/components/settings-modal.tsx
   M src/hooks/use-application-backup.ts
   M src/hooks/use-board-drag.ts
   M src/hooks/use-dashboard-shortcuts.ts
   M src/hooks/use-toast-undo.ts
   M src/lib/backup-settings-schema.ts
   M src/lib/board-preferences.ts
   M src/lib/dashboard-analytics.ts
   M src/lib/general-preferences.ts
   M src/lib/keyboard-shortcuts.ts
   M src/lib/status-history.ts
   M src/lib/status-meta.ts
   M src/lib/undo-snapshots.ts
   M src/types/application.ts
  ?? AGENTS.md
  ?? CLAUDE.md
  ?? src/lib/settings-values.ts
  ?? src/types/dashboard.ts
  ?? src/types/navigation.ts
  ```

**Phase 8 is complete.** The only item not done is the optional `server-only` guard, which needs approval for a new package.

---

# Session 14 / Phase 9 — Final Verification

**Scope:** DOC-001, DOC-002, the BAK-002 documentation portion, and final verification of the whole remediation. No features, UI redesign, Gmail/AI work, migrations, refactors, new packages (`server-only` not added) or commits. PERF-001 and PERF-003 were not touched.

## DOC-001 / DOC-002 / BAK-002 completion

| Finding | Change |
|---|---|
| DOC-001 | `README.md` rewritten against the current code. **Undo** now states that only the latest status change, archive action or deletion can be undone, and that a deleted application can be restored for up to 10 minutes (`UNDO_SNAPSHOT_TTL_MS`). New **Requirements**: Node `^22.18.0 \|\| >=23.6.0` (the Session 13 `engines` field) and npm. **Local Data & Privacy** now covers the `prisma/dev.db` location, loopback-only Host acceptance (SEC-001), and the `prisma db push` policy with no migrations (DEP-002). **Running Nook** explains that closing the terminal stops Nook and gives `build`/`start` as the alternative. "Local-first" became "local-only", which matches AGENTS.md. The Customizable boards bullet now says custom names and colours appear everywhere (BIZ-002 is fixed). The Themes/motion bullet names the actual motion modes (on / off / system). The Overview bullet says "active upcoming interviews" (BIZ-001). |
| BAK-002 (docs) | The README's **Backup & Restore** section documents: what export contains (every application including archived ones, its status history, and settings); the limits (10 MB, 5,000 applications, from `backup-limits.ts`); that invalid files are rejected without changes; that new applications are added and identical ones skipped; that import never updates an existing record, and any changed record (including archive then unarchive) stops the whole import, names up to three changed applications and imports nothing; that a successful import replaces current settings even when every record is skipped; and the duplicate-match prompt (import anyway, or cancel the import). Each rule was checked against `import/route.ts`, `export/route.ts` and `use-application-backup.ts`. The Session 11 409 message and the all-or-nothing behaviour are unchanged. |
| DOC-002 | The `AGENTS.md` validation section now lists `npm test` and its seven suites, the unit-loader scripts and their Node requirement, all four scripts that use the isolated `run-backup-api-test.sh` runner (`test:smoke`, `test:backup`, `test:dashboard`, `test:contention`), and `test:e2e` (alias `test:keyboard`) with the Playwright runner's isolated DB and artifact cleanup. The "hooks in `src/hooks/`" rule is accurate again (Session 7 moved `useSettings`/`useBoards`), so it was kept. The file has been tracked since `bb90b6c`; `CLAUDE.md` stays gitignored as committed there. The Next-generated footer is untouched. |

The README also has **Keyboard & Accessibility** and **Tests** sections. Every item was checked against `keyboard-shortcuts.ts`, the dnd-kit screen-reader instructions in `application-dashboard.tsx` and `board-settings.tsx`, the Session 8 dialog focus behaviour, `package.json`, and `playwright.config.ts` (`channel: "chrome"`, so the README says Google Chrome must be installed). The README contains no audit or remediation history, roadmap, removed features or debugging notes.

## Test change made during verification

The first full E2E run failed one test, `interview-date.spec.ts:102` (assertion at line 113). After Skip, Interview → Online assessment → Interview, the test expected the date prompt to stay hidden. That pinned the pre-Session 11 behaviour. **BIZ-004** (approved default, Session 11) clears `interviewDatePromptDismissed` when an application leaves Interview (`[id]/route.ts:79`), so the prompt correctly asks again. Session 11 did not run the full E2E suite, so the stale assertion went unnoticed. The test now asserts that the prompt is **visible** on return, then skips it again and continues. This is a stricter assertion of the approved behaviour, not a weakened one. The spec passed 2/2 on its own before the two final full runs.

## Final verification

| Check | Result |
|---|---|
| `npm run typecheck` | pass (before and after the test edit) |
| `npm run lint` | pass, 0 warnings (before and after the test edit) |
| `npm test` | **pass** (exit 0). `test:unit` 34/34 default zone, 4/4 America/New_York, 4/4 Asia/Dhaka; `test:import-scale` 5,000 records in 6,873 ms (longest batch 37 ms); `test:setup` 4/4; `test:smoke`, `test:backup`, `test:dashboard` passed; `test:contention`: 2,000-record import 2,021 ms, list/page 200, PATCHes only 200/409, export and repair 200, expired restore 404, locked PATCH 503 |
| `npm run test:dashboard` / `test:backup` / `test:smoke` | pass (all run inside `npm test`, each on its own isolated SQLite database and server) |
| `npm run build` | pass: "Compiled successfully in 1834ms", TypeScript 3.3 s, 9/9 static pages, Proxy (Middleware) present |
| Host-security regression (below) | pass, 14/14 checks |
| Preliminary full E2E (`npm run test:e2e`) | 75 passed, **1 failed** (the stale BIZ-004 assertion above), 11.3 min |
| `bash scripts/run-playwright.sh tests/e2e/interview-date.spec.ts` | 2 passed after the fix |
| **Final full E2E run 1** (`npm run test:e2e`, fresh isolated DB) | **76 passed, 0 failed, 0 flaky**, 9.8 min |
| **Final full E2E run 2** (consecutive, fresh isolated DB) | **76 passed, 0 failed, 0 flaky**, 10.0 min |
| Expected-failure markers | none remain: no `test.fail`, `test.skip` or `test.fixme` in `tests/e2e` |
| `git diff --exit-code tsconfig.json` | unchanged |
| `git diff --check` | pass |

Observation (not a failure): each full run logged one React hydration warning on `/interviews`. The sidebar's "Interviews, N upcoming" count differed (server 4, client 3) inside a test that freezes only the browser clock with `page.clock`. The server and browser were computing "upcoming" from different dates. In normal use both share the machine's clock. Each run also logged React's development "script tag" notice for the inline theme script. Neither affects a test result, and no change was made.

## Host-security regression

- `npx next start -H 127.0.0.1` ran from the fresh production build against `DATABASE_URL=file:/private/tmp/nook-host-probe.XXXXXX/probe.db` (a random port, schema from `prisma db push`). The probe used `node:http` so it could set the Host header, and seeded one application through a valid Host and Origin (201).
- **Valid loopback Hosts:** `GET /api/applications` and `GET /dashboard` with `localhost:<port>`, `127.0.0.1:<port>` and `[::1]:<port>` → **200** (6/6).
- **Evil Host** `evil.test:<port>`: `GET /api/applications/export`, `GET /dashboard`, `GET /api/applications`, `PATCH /api/settings`, `DELETE /api/applications/purge` → **403** (5/5).
- The application list (1 → 1) and settings were byte-identical before and after the evil requests. The server was stopped and the temp directory removed by the probe's trap. The first probe attempt had an invalid seed payload (400 from the strict create schema) that I wrote myself; the Host checks passed then too. The payload was corrected and the whole probe re-run.

## Audit closure: final finding disposition

The audit has **59 root causes**; REACT-007 was merged into BAK-003 by the audit itself. The report, the ledger and the plan list the same IDs.

| Disposition | Findings |
|---|---|
| **Fixed** (51) | SEC-001, SEC-002, BAK-001, TEST-007 (S1/S6); ARCH-001, DATA-002 (S2); DATA-001, BAK-003 incl. merged REACT-007 (S3); CALC-001, DATE-001 (S4); TEST-003, TEST-004, TEST-005 (S1–S5); TEST-002, TEST-008, TEST-001 (S6); REACT-001, REACT-002, A11Y-004, UI-004, REACT-008 (S7); UI-001, REACT-003, A11Y-003, REACT-006 (S8); A11Y-001, A11Y-002, A11Y-006, A11Y-007, BIZ-002 (S9); REACT-005, REACT-004 (S10); DATE-002, BIZ-003, BIZ-004 (S11); PERF-004, PERF-002 (S12); ARCH-002, ARCH-003, CLEAN-001, CLEAN-003, DEP-001, DEP-002, DEP-003, TEST-006, DOC-003 (S5–S13); DOC-001, DOC-002 (S14); BAK-002 (409 names the conflicts in S11; documented in S14); BIZ-001 (renamed card, S11); CALC-002 (tooltip explains the rule; maths intentionally unchanged, per the approved default, S11) |
| **Fixed with an approved limit** (2) | CLEAN-002: bounds added (S2); removing `emailSnippet`/`NOTE_ADDED` was intentionally not done, because the strict v1 backup would reject existing backups. ARCH-005: types moved (S13); the optional `server-only` package was not added, since it needs approval for a new dependency. |
| **Accepted as planned, no dedicated refactor** (1) | ARCH-004: addressed incrementally (shared `Dialog` in S8, mutation flow in S10) as the plan specified. The optional `application-client.ts` slice was not done. |
| **Intentionally deferred** (5) | PERF-001: under 300 ms at realistic volumes; the real fix is an ARCH-004-sized refactor. PERF-003: Inferred; needs profiling, and was largely addressed by REACT-002/REACT-005. A11Y-005: Unverified; needs a screen reader. UI-002: Inferred; its SSR part was fixed by REACT-001, and the narrow-viewport part was not reproduced. UI-003: optional in Phase 6. |

Also deliberately not done, per the plan: the package rename. The Session 2 caveat still applies: records imported under the pre-Session 2 rules might not re-import from your own export. Validating such an export needs your approval, and it was not done.

## Files changed (Session 14)

- `README.md`: DOC-001 and the BAK-002 documentation.
- `AGENTS.md`: DOC-002 (validation commands only).
- `tests/e2e/interview-date.spec.ts`: aligned with approved BIZ-004 behaviour (+3 lines).
- Record: this gitignored `audit/audit-20260928/audit-fix.md`. The probe script lived in the session scratchpad, outside the repository.

## Data safety, artifacts and final repository state

- `prisma/dev.db` was never opened in SQLite, queried, copied or modified. Only its metadata and hash were read. Final: **53,248 bytes**, mtime epoch **1790487979**, SHA-256 **`416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`**, matching the baseline.
- Every API, Playwright and Host-probe run used its own temporary SQLite database.
- After all runs: no `.next-playwright*` directory, no `tsconfig.playwright.json`, no `/private/tmp/nook-*` directory, and no Next, Playwright or Chrome test process left running. `tsconfig.json` is unchanged. The gitignored `.next/` production build and `test-results/` remain, as they did before the session.
- Final `git status -sb`:

  ```text
  ## main...origin/main [ahead 14]
   M AGENTS.md
   M README.md
   M tests/e2e/interview-date.spec.ts
  ```

**Phase 9 is complete, and so is the audit remediation.** Every finding is fixed, fixed with an approved limit, accepted as planned, or deferred for the reason the plan approved. The only open work is the five deferred findings and the unapproved optional items (`server-only`, `application-client.ts`, the package rename). The Session 14 changes are uncommitted.
