I've read the full report and all 1,396 lines of the ledger. I changed no files. Two things about the current tree matter for the plan:
- The tree is clean at `5f74723`, and `tsconfig.json` is back to the 6 committed `.next-playwright.*` pairs, so the 8 pairs the audit added have been reverted.
- `scripts/run-playwright.sh` gives each run a random port. The SEC-001 Host check therefore has to check the hostname only, not a fixed port.

# Nook remediation plan (audit 2026-09-28)

## Changes to the order you asked for

- **The TEST-007 runner fix moves into Session 1.** It's one line in `run-backup-api-test.sh`. Every API test run copies your real `dev.db` into `/private/tmp`, and Phases 1–3 run those suites dozens of times.
- **TEST-003 and TEST-004 move into Phase 3**, not Phase 4. The new direct unit tests (TEST-005) need a working loader and an npm script. Writing them on the hand-mocked harness would add more brittle tests.
- **TEST-002 is the first step of Phase 4**, before any Playwright run.
- **Every server fix in Phases 1–2 gets its API test in the same session.** The existing isolated suites already work. Phase 3 is only for the unit-level gaps.

---

## Phase 1: High risk (Session 1)

### 1.0 Prelude: TEST-007 (runner part)
- **Goal:** `run-backup-api-test.sh:20` copies only `prisma/schema.prisma`, not all of `prisma/`.
- **Check first:** confirm nothing else under `prisma/` is needed.
- **Stop when:** `test:backup` and `test:smoke` pass, and no `dev.db` appears in `/private/tmp/nook-backup-api.*` during a run.

### 1A: SEC-001 + SEC-002
- **Root cause:** the CSRF check compares `Origin` with the request's own `Host`, and a rebinding attacker controls both. Nothing checks Host against an allowlist. The proxy matcher covers only `/api`, so pages and GET routes have no gate at all.
- **Goal:**
  - `src/proxy.ts` rejects (403 or 421) any request whose Host hostname is not `localhost`, `127.0.0.1` or `[::1]`. The port is not checked, because the runners use random ports.
  - The matcher covers pages and API routes. It may exclude static asset paths.
  - The Origin check stays as it is.
  - Decide the SEC-002 limiter. My recommendation: apply it only to mutations, or remove it, since the Host check does the real protection. Optionally set `middlewareClientMaxBodySize` just above 10 MB so the route's own 413 wins.
- **Files:** `src/proxy.ts`, a small hostname helper in `src/lib/` (`mutation-request.ts` or a new file), maybe `next.config.ts`, `scripts/smoke-test.mjs`.
- **Read first:** the proxy/middleware guide in `node_modules/next/dist/docs/`, as AGENTS.md requires.
- **Tests** (in `smoke-test.mjs`, using `node:http`, since `fetch` can't set Host):
  - With `Host: evil.test:<port>`: `GET /api/applications/export`, `GET /dashboard`, `PATCH /api/settings` and `DELETE /api/applications/purge` each return 4xx, and the application count and settings are unchanged.
  - `localhost`, `127.0.0.1` and `[::1]` Hosts still get 200.
- **Verify:** `typecheck`, `lint`, `test:smoke`, `test:backup`, `build`.
- **Behaviour risk:** low. Opening Nook through a LAN IP or a custom `/etc/hosts` name stops working, and neither is supported today.
- **Stop when:** the tests pass and the build succeeds.

### 1B: BAK-001
- **Root cause:** event timestamps come from the wall clock with no ordering guard. The history validator correctly requires chronological order. But restore validates the server's own snapshot with that same import validator.
- **Goal:**
  - **(a)** Restore validates the snapshot with a separate structural schema for stored rows (field types only, no history `superRefine`), then re-inserts it. This schema must not pick up the stricter rules ARCH-001 adds later. If it did, records imported under the old rules could never be undo-restored.
  - **(b)** One helper, `max(now, latestEvent.createdAt + 1 ms)`, used by both PATCH and PUT. CALC-001 builds on it later.
  - **(c)** Import rejects events whose `createdAt` is after the request time. This is a rejection, not a repair.
- **Files:** `backup-snapshot.ts`, `[id]/restore/route.ts`, `[id]/route.ts`, `import/route.ts`, possibly `status-history.ts`.
- **Tests** (`backup-api-test.mjs`). Once (c) is in place, the test can't create the bad state through import, so it seeds an out-of-order history directly through Prisma on the temp DB. Then:
  - PATCH appends an event that sorts last;
  - an undoable delete followed by restore returns 201, with the history intact;
  - export → purge → import round-trips;
  - importing a future-dated event returns 400.
- **Verify:** `typecheck`, `lint`, `test:backup`, `test:smoke`.
- **Behaviour risk:** low. A backup exported on a machine whose clock ran ahead is rejected until that time passes.
- **Stop when:** all four tests pass.

**Session 1 can hold 1.0 + 1A + 1B as three separate commits.** They don't touch the same code.

---

## Phase 2: Medium integrity (3 sessions)

### 2A: ARCH-001 + DATA-002 + CLEAN-002 bounds (Session 2)
- **Root cause:** `backup-snapshot.ts` declares its own field rules instead of reusing `application-schema.ts`, and the two have drifted apart.
- **Goal:**
  - **Shared validators** exported from `application-schema.ts`:
    - a calendar date written as UTC-midnight ISO, exactly the format export produces, checked with `calendar-date.ts`;
    - `jobUrl`: http(s) only, and it must already be trimmed;
    - optional text: `null` or trimmed non-empty text;
    - IDs: `^[A-Za-z0-9_-]{1,64}$`;
    - length bounds on `detail` and `emailSnippet`.
  - Import **rejects** values that break these rules and never transforms them. Keep the distinction between calendar dates and timestamps: `createdAt` and `lastUpdated` stay offset-tolerant timestamps.
  - **Client URLs:** one helper that applies `encodeURIComponent` to IDs, used at the 5 call sites in `application-dashboard.tsx`.
  - **DATA-002:** `.strict()` on `applicationInputSchema` and `applicationStatusSchema`. First check that the dashboard never sends extra keys.
- **Tests** (`backup-api-test.mjs` and `smoke-test.mjs`):
  - these are rejected: offset dates, non-midnight dates, `javascript:`, `data:` and padded URLs, `""` or whitespace-only text, unsafe IDs, oversized `detail`;
  - the round trip still passes;
  - an extra key on POST or on the status PATCH returns 400.
- **Verify:** `typecheck`, `lint`, `test:backup`, `test:smoke`, `test:duplicates`, dashboard API suite.
- **Data risk:** your real database may already hold records imported under the old rules. After this change, your own export would be rejected when you re-import it. Before merging, you could export once from the UI, and the session would validate that file against the new schema with a scratch script. It would read only that file, never `dev.db`, and only with your approval.

### 2B: DATA-001 + BAK-003 (Session 3)
- **Root cause:** GET routes and page renders perform writes. SQLite lock timeouts aren't recognised, so they become 500s. Import holds the write lock for its whole run. A bad settings row blocks everything, and server-side errors are reported as client 400s. The last two share `src/lib/api.ts`.
- **Goal:**
  - **Snapshot cleanup:** remove `cleanupExpiredUndoSnapshots` from the GET list route and from `application-page.tsx`, and make it best-effort. Restore must still refuse expired snapshots on its own.
  - **Error mapping:** `apiError` maps lock and socket timeouts to 503 with `Retry-After`. It returns 400 only for errors caused by the request, and 500 for server-side `ZodError` and `SyntaxError`.
  - **Import:** prepare rows first, then `createMany` inside the same transaction.
  - **Settings:** `readSettings` logs and falls back to defaults when the stored row is invalid. Export no longer depends on settings. PATCH can overwrite a corrupt row.
  - **Busy timeout:** evaluate only after checking Prisma 6.12 docs. Don't change `.env` without approval.
- **Tests:**
  - New `scripts/contention-api-test.mjs`: during a ~2,000-record import, `GET /api/applications` and a page GET return 200; N concurrent same-revision PATCHes return only 200 or 409.
  - Corrupt settings row: export returns 200, and a settings PATCH repairs the row.
  - The existing "expiry cleanup on load" assertion in `backup-api-test` must be rewritten to "expired snapshots are never restorable".
- **Verify:** `typecheck`, `lint`, `test:backup`, `test:smoke`, contention test, `node scripts/import-scale-test.mjs`.
- **Behaviour risk:** low to medium (lock and transaction changes).

### 2C: CALC-001 + DATE-001 (Session 4)
- **Depends on** 1B's event-timestamp helper.
- **Goal:**
  - **Undo operation:** a new revision-guarded server operation for undoing a status move. It sends `{revision, expected latest event id, previous archived/interviewDate/prompt flag}`. When the latest event is still the one being undone, it deletes that event, restores the previous status, and bumps the revision. Otherwise it returns 409 with the current record, the existing conflict pattern.
  - **Client:** `restoreLatestChange` calls the new operation for status moves. Archive-only undo keeps using PATCH.
  - **DATE-001:** compute the analytics upper bound with `Date.UTC` arithmetic instead of re-parsing an ISO slice.
- **Tests** (`dashboard-api-test.mjs`):
  - move to OFFER, then undo: the event list, `offerRate` and stale membership match the state before the move;
  - undo after an intervening change returns 409 and deletes nothing;
  - CUSTOM_YEAR 9999 and CUSTOM_MONTH 9999-12 return 200.
- **Behaviour risk:** medium, but intended. Reverse events already stored in your data are not repaired.

---

## Phase 3: Unit regression net (Session 5)

- **Findings:** TEST-004 (unit harness), TEST-003, the unit half of TEST-005, and the obsolete unit tests.
- **Goal:**
  1. **One shared loader:** Node 26 type stripping plus a small resolve hook for `@/` and extensionless imports. If lib code uses syntax that stripping can't handle, fall back to one shared `typescript` transpile loader. Unknown imports then fail loudly instead of getting a fake module.
  2. **Migrate** the existing unit tests to it.
  3. **Rewrite** `motion-preference-test.mjs:35` (it assumes localStorage) and `keyboard-shortcuts-test.mjs:20` (it asserts a shortcut count, not behaviour).
  4. **Add direct tests** for:
     - `backup-snapshot` (history-validator cases);
     - `status-history`;
     - `analytics-period`, including 9999;
     - `calendar-date` (leap years, boundaries, DST under `TZ=`).
  5. **Wire the scripts:** add `test:unit`, `test:dashboard` and `test:contention`, plus an aggregate `npm test` that excludes Playwright. Rename `test:keyboard` to `test:e2e` and keep the old name as an alias.
- **Verify:** `npm test` is green, and each new test fails on a deliberately broken local copy. That check is never committed.
- **Behaviour risk:** none to the app.

---

## Phase 4: Playwright infrastructure (Session 6, needs your explicit OK to run Playwright)

- **Findings:** TEST-002, TEST-008, TEST-001, TEST-007 (screenshots), the ESLint ignore from DEP-003, TEST-004's selectors where you touch them anyway.
- **Goal, in order:**
  1. **TEST-002 first:**
     - Use one fixed, gitignored `distDir` (`.next-playwright`).
     - When the Playwright env var is set, point `typescript.tsconfigPath` at a runner-generated, gitignored `tsconfig.playwright.json` that extends `tsconfig.json`. Check `writeConfigurationDefaults` in Next 16 to confirm it writes to that path.
     - Remove the 6 committed pairs from `tsconfig.json`.
     - Add `.next-playwright/` to `.gitignore` and ESLint `globalIgnores`.
  2. **Fixtures** in `api-helpers.ts`: `resetSettings(overrides)` (GET, then PATCH with an Origin header) and a per-test purge in `beforeEach`. This ends the settings leak and the cascade of leftover records.
  3. **Navigation:** open `/jobs` directly. Keep one test that checks `/` redirects to the startup page.
  4. **Settings:** replace localStorage seeds and asserts with API calls, except `sidebar-width`, which really is stored in localStorage.
  5. **Removed UI:** delete or rewrite the assertions for Recent applications, the partial-import message and the `light` class. Replace the `.nook-toast` count check with a check of its hidden state.
  6. **TEST-001:** freeze the clock with `page.clock.setFixedTime` on a known Monday, and use the Monday-start headings.
  7. **Screenshots:** write them to `testInfo.outputPath()`.
  8. **Known app defects:** mark `keyboard:122` (UI-001) and `keyboard:233` as `test.fail()` with the finding ID, so they flag when a fix makes them pass.
- **Verify:**
  - `npm run test:keyboard` runs in the background with the `queue-wait` skill (about 18 minutes). It must be green **twice in a row**.
  - `git diff --exit-code tsconfig.json` passes.
  - No `/private/tmp/nook-empty-*` files are left.
- **Behaviour risk:** none to the app.

---

## Phase 5: React, UI and accessibility (4 sessions; all depend on Phase 4)

### 5A: Settings state (Session 7)
- **Findings:** REACT-001, REACT-002, A11Y-004, UI-004, REACT-008, ARCH-003 (the hook and `alert` parts), CLEAN-003 (`setPreference`).
- **Goal:**
  - **Seeding:** pass `initialState` through context. It is the server snapshot, and it seeds the store on the client only.
    - Don't write to the module singleton during SSR, or settings could leak between requests.
    - Render `data-motion` on `<html>` in `layout.tsx`.
  - **Writes:**
    - board text edits become debounced drafts that commit on blur;
    - toggles become functional, optimistic updates;
    - drag auto-expand stays local state;
    - errors are returned to the caller and shown with the existing toast;
    - refreshes with an equal revision are ignored;
    - listen to only one of `focus` / `visibilitychange`.
  - **Structure:** move `useSettings` and `useBoards` to `src/hooks/`, and share one `applyTheme` between the inline script and the provider.
  - **REACT-008:** make `/` a server component that calls `redirect()`.
  - **A11Y-004:** when the sidebar collapses, move focus to the Expand button.
- **Tests:**
  - `settings-store-test`: a double toggle returns the original value; an equal-revision refresh doesn't notify; a failed write rolls back.
  - Playwright:
    - the first DOM is already collapsed, with custom labels (Session D probe D1);
    - typing sends at most 1 PATCH after the debounce (D4);
    - a double toggle returns to where it started (D5);
    - focus is kept after a shortcut collapse;
    - `/` redirects without calling `/api/settings`.
- **Behaviour risk:** medium, because every page reads settings.

### 5B: Shared dialog primitive (Session 8)
- **Findings:** UI-001, REACT-003, A11Y-003, `keyboard:233`, and REACT-006 (reproduce first with `page.route` returning 500 on DELETE).
- **Goal:**
  - One `Dialog` component plus a dialog-stack hook: only the topmost dialog handles Escape, the trap supports suspension, focus returns to the trigger, and a dialog **releases its trap as soon as it starts exiting**.
  - Move all dialogs onto it and remove the no-op overflow locks.
  - The shortcut hook leaves Escape to the stack and ignores it while a dnd-kit keyboard drag is active.
  - REACT-006: split page errors from form errors, and reopen the modal when a delete fails.
- **Tests:**
  - REACT-003: focus lands on the prompt's date input;
  - D3: Escape during a keyboard reorder keeps Settings open;
  - `keyboard:122` and `keyboard:233` flip from `test.fail()` to passing;
  - REACT-006: the modal reopens with the form intact.
- **Behaviour risk:** medium-high, since every dialog changes.

### 5C: Board semantics and accessibility (Session 9)
- **Findings:** A11Y-001, A11Y-007, A11Y-006, A11Y-002, BIZ-002.
- **Goal:**
  - **Cards:** each card is a container with one real button carrying the dnd attributes, the link sits outside that button, and dates are exposed through `aria-describedby`.
  - **Sidebar rows:** forward the key listener, or change the labels so they don't promise archive or move.
  - **Board settings:** reorder announcements use board labels, not internal IDs.
  - **Landmarks:** `<main>` wraps only the page content, `/jobs` gets a hidden `h1`, metric labels become `<p>`, and the Interviews link name includes the count.
  - **Tabs:** roving tabindex, with the arrow keys handled only on the tablist.
  - **BIZ-002:** use `boardLabel`/`boardDot` in Analytics and Stale, and order the modal's status options by board order.
- **Tests:** Playwright checks that no button contains a link, and covers the tabs keyboard pattern and a renamed board label showing in Analytics and Stale. `@axe-core/playwright` is a new dependency, so it needs your approval.
- **Behaviour risk:** medium (card markup; the `kanban-layout` spec will be affected).

### 5D: Dashboard mutation flow (Session 10)
- **Findings:** REACT-005, and REACT-004 (reproduce first with a delayed `page.route`).
- **Goal:**
  - Refetch dashboard data on one mutation counter bumped after reconciliation, not on array identity.
  - Track in-flight moves per ID. `moveApplication` returns a result, and undo re-offers the toast when the move didn't run.
  - Optionally move the 7 fetch calls into `src/lib/application-client.ts` (a first slice of ARCH-004).
- **Tests:** one Archive produces exactly one `/api/dashboard/stale` request (D6), plus the delayed-PATCH case.

---

## Phase 6: Remaining Low correctness (Session 11, product decisions first)

Here are my recommended defaults for the decisions:

| Finding  | Recommended default                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| CALC-002 | Explain the "reached this status" meaning in the tooltip; no change to the maths.                                      |
| BIZ-001  | Rename the Overview card to "Active upcoming interviews". The heading count follows the search.                        |
| BIZ-004  | Clear the dismissed flag when an application leaves INTERVIEW.                                                         |
| BAK-002  | Name the conflicting records (company and role) in the 409 message. Keep the all-or-nothing behaviour and document it. |
| TEST-006 | Keep the plain DELETE and document it, or switch the tests to the undoable path.                                       |

Also in this phase:
- **DATE-002:** extract the date subscription to `src/lib`, re-arm the timer after it fires, and notify on `visibilitychange`. Test with fake timers: two midnights give two notifications.
- **BIZ-003:** one shared `matchesApplicationSearch` and one `compareApplications` that matches the server's `orderBy`, with unit tests.
- **UI-003 (optional):** keep the last good data and add a Retry button.

---

## Phase 7: Justified performance work (Session 12, can merge with Phase 8)

- **PERF-004:** make `settings-defaults.ts` a typed literal instead of parsing at module load, and use a local constant for the status names. That keeps zod and the Prisma browser runtime out of the root layout's modules. Re-measure the chunk list for `/` from the build manifest with the audit's method.
- **PERF-002:** analyse each history once per request, and drop the duplicate stale fields only after checking the client and `dashboard-api-test`.
- **Defer:**
  - PERF-001: under 300 ms at realistic volumes; the real fix is an ARCH-004-sized refactor.
  - PERF-003: Inferred and needs profiling. It mostly goes away after REACT-002 and REACT-005.

---

## Phase 8: Cleanup, configuration, dependencies (Session 13)

- **Code cleanup:**
  - ARCH-002 + CLEAN-001 + the rest of CLEAN-003 (sidebar widths, undo TTL, stale cutoffs, touch sensor constants).
  - ARCH-003 type moves: `JobFormState`, `ApplicationPageName` and `DashboardSection` go to `src/types`.
  - ARCH-005: move the exported types out of `dashboard-analytics.ts`. Add `server-only` only if you approve the new package.
- **Dependencies and tooling:**
  - DEP-001: an `engines` field matching the Node version the Phase 3 loader needs; pin the four caret ranges. Renaming the package is optional.
  - DEP-002: remove `db:migrate` or make it a `db push` alias, and resolve the contradictory `.gitignore` rules for migrations.
  - DEP-003: decide whether AGENTS.md is tracked or local.
- **Tests:** TEST-006 and DOC-003 (the smoke-test comment, and renaming the catch-all assertion).
- **CLEAN-002: I recommend not removing** `emailSnippet` or `NOTE_ADDED`. The v1 schema is strict, so removing them would make every existing backup fail to import, and AGENTS.md rules out migrations. Keeping them bounded is enough.

## Phase 9: Documentation (Session 14, with final verification)

- **DOC-001:** fix the Undo bullet, add what import does, the limits (5,000 applications, 10 MB), Node ≥20.9 (or whatever Phase 8's `engines` field says), and the `db push` policy.
- **DOC-002:** list the test commands, now that the hooks rule is true again.

---

## 1. Ordered phases
1.0 → 1A → 1B → 2A → 2B → 2C → 3 → 4 → 5A → 5B → 5C → 5D → 6 → 7 → 8 → 9

## 2. Finding-to-phase mapping (59)

| Finding   | Sev / status | Phase                                       |
| --------- | ------------ | ------------------------------------------- |
| SEC-001   | H / C        | 1A                                          |
| SEC-002   | L / C        | 1A                                          |
| BAK-001   | H / C        | 1B                                          |
| ARCH-001  | M / C        | 2A                                          |
| DATA-002  | L / C        | 2A                                          |
| CLEAN-002 | L / C        | 2A (bounds); removal not recommended        |
| DATA-001  | M / C        | 2B                                          |
| BAK-003   | L / C        | 2B                                          |
| CALC-001  | M / C        | 2C                                          |
| DATE-001  | L / C        | 2C                                          |
| TEST-005  | M / C        | 1–2 (API tests) + 3 (unit tests)            |
| TEST-003  | L / C        | 3                                           |
| TEST-004  | L / C        | 3 (unit harness), 4 (selectors)             |
| TEST-007  | L / C        | 1.0 (runner), 4 (screenshots)               |
| TEST-002  | L / C        | 4 (first step)                              |
| TEST-008  | M / C        | 4                                           |
| TEST-001  | M / C        | 4                                           |
| DEP-003   | L / C        | 4 (ESLint ignore), 8 (AGENTS.md)            |
| REACT-001 | M / C        | 5A                                          |
| REACT-002 | M / C        | 5A                                          |
| A11Y-004  | L / C        | 5A                                          |
| UI-004    | L / C        | 5A                                          |
| REACT-008 | L / I        | 5A                                          |
| ARCH-003  | L / C        | 5A (hooks, alerts), 8 (types)               |
| CLEAN-003 | L / C        | 5A (`setPreference`), 8 (magic values)      |
| UI-001    | L / C        | 5B                                          |
| REACT-003 | M / C        | 5B                                          |
| A11Y-003  | L / C        | 5B                                          |
| REACT-006 | L / I        | 5B (reproduce first)                        |
| A11Y-001  | M / C        | 5C                                          |
| A11Y-002  | L / I        | 5C (the test confirms it)                   |
| A11Y-006  | L / C        | 5C                                          |
| A11Y-007  | L / C        | 5C                                          |
| BIZ-002   | L / C        | 5C                                          |
| REACT-005 | L / C        | 5D                                          |
| REACT-004 | L / I        | 5D (reproduce first)                        |
| ARCH-004  | L / C        | Incremental in 5B/5D; no dedicated refactor |
| DATE-002  | L / C        | 6                                           |
| BIZ-001   | L / C        | 6 (decision)                                |
| BIZ-003   | L / C+I      | 6                                           |
| BIZ-004   | L / C        | 6 (decision)                                |
| CALC-002  | L / C        | 6 (decision)                                |
| BAK-002   | L / C        | 6 (error message), 9 (docs)                 |
| UI-003    | L / I        | 6 (optional)                                |
| PERF-004  | L / C        | 7                                           |
| PERF-002  | L / C        | 7                                           |
| PERF-001  | L / C        | Deferred                                    |
| PERF-003  | L / I        | Deferred                                    |
| ARCH-002  | L / C        | 8                                           |
| ARCH-005  | L / I        | 8 (type move only)                          |
| CLEAN-001 | L / C        | 8                                           |
| DEP-001   | L / C        | 8                                           |
| DEP-002   | L / C        | 8                                           |
| TEST-006  | L / C        | 8                                           |
| DOC-003   | L / C        | 8 (with TEST-006)                           |
| DOC-001   | L / C        | 9                                           |
| DOC-002   | L / C        | 9                                           |
| A11Y-005  | L / U        | Deferred                                    |
| UI-002    | L / I        | Deferred                                    |

**Fix together:**
- SEC-001 + SEC-002
- ARCH-001 + DATA-002 + CLEAN-002 bounds
- DATA-001 + BAK-003 (shared `api.ts`)
- CALC-001 + DATE-001 (same test suite)
- TEST-008 + TEST-001 + TEST-002
- REACT-001 + REACT-002 + ARCH-003 + CLEAN-003
- UI-001 + REACT-003 + A11Y-003

**Keep separate:**
- BAK-001 from ARCH-001: restore must not inherit the stricter import rules.
- CALC-001 from CALC-002: a bug fix versus a product decision.
- PERF-001 from PERF-004.

**Probably need no direct work once their root cause is fixed:**
- REACT-003, A11Y-003 and `keyboard:233`: fixed by UI-001.
- The ARCH-003 alerts and CLEAN-003's `setPreference`: fixed by REACT-002.
- The SEC-002 limiter and TEST-006's DELETE surface: made moot by SEC-001.
- DOC-003: fixed by TEST-006.
- The UI-002 SSR part: fixed by REACT-001.
- Most of PERF-003: fixed by REACT-002 and REACT-005.

**Confirm before fixing (Inferred or Unverified):**
- REACT-004 and REACT-006: needs a `page.route` repro.
- UI-002: needs a narrow-viewport Playwright check.
- A11Y-005: needs a screen reader.
- PERF-003: needs profiling.
- The BIZ-003 sort tie-break.
- The DEP-002 behaviour. The configuration fix is safe to do regardless.

## 3. Session boundaries
Fourteen sessions:
- **S1:** 1.0 + 1A + 1B
- **S2:** 2A
- **S3:** 2B
- **S4:** 2C
- **S5:** 3
- **S6:** 4 (needs your Playwright authorization)
- **S7:** 5A
- **S8:** 5B
- **S9:** 5C
- **S10:** 5D
- **S11:** 6
- **S12:** 7
- **S13:** 8
- **S14:** 9 + final verification

S12 and S13 can merge, and so can S2 and S4 if context allows. S3, S6, S7 and S8 should each stay on their own.

## 4. Address first
SEC-001, then BAK-001 (with the TEST-007 runner fix just before them), then ARCH-001.

## 5. Low findings you can reasonably defer
- Pending your product decisions: CALC-002, BIZ-001, BIZ-004, BAK-002's semantics.
- Unverified or low value at Nook's scale: UI-002, UI-003, PERF-001, PERF-003, ARCH-004, ARCH-005, A11Y-005.
- Deliberately not doing: CLEAN-002 removal, the package rename.

## 6. Regression-test strategy
- **Server findings** get API tests in the existing isolated suites (`run-backup-api-test.sh`), in the same session as the fix. When a precondition can't be reached through the API, seed it on the temp DB with Prisma.
- **Pure logic** gets `node --test` unit tests through the shared loader.
- **UI findings** get Playwright tests, only after Phase 4 and only with your authorization. Every test resets settings and data. Known defects stay as `test.fail()` until fixed.
- **No finding is closed without the test named in the report's table.** Each new test should be shown to fail against the unfixed behaviour.
- **Always:** `"version": 1` stays, invalid backups are rejected, no test targets your running app, and `dev.db` is never opened.

## 7. Final verification sequence
1. `npm run typecheck`, then `npm run lint`.
2. `npm test`: unit, setup, duplicates, shortcuts, backup, smoke, dashboard and contention suites, and import-scale.
3. `npm run build`.
4. A `next start` probe on a temp DB, like Session F's: an evil Host is rejected, and the real Host works.
5. `npm run test:keyboard` twice in a row, in the background with `queue-wait`.
6. `git diff --exit-code tsconfig.json`, and `git status` shows only intended changes.
7. No leftover `/private/tmp/nook-*` directories, and the `dev.db` size, mtime and sha256 match the audit baseline.

## 8. Recommended first session (S1)
1. **Baseline:** run `typecheck`, `lint`, `test:backup` and `test:smoke`, and confirm they are green.
2. **TEST-007:** fix the runner copy.
3. **SEC-001 + SEC-002:** read the Next 16 proxy docs, add the Host allowlist, widen the matcher, decide the limiter, add the `node:http` smoke tests, run `build`.
4. **BAK-001:** structural restore schema, monotonic event timestamps, reject future-dated imported events, and the four backup-api tests.
5. **Stop** when all suites and the build are green. That's three commits if you ask me to commit, and no client or UI changes.

I can also put this plan on a private page if you want to share it or keep it next to the audit.
