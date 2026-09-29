# Nook Comprehensive Audit — 2026-09-28

Report-only audit of the local Nook job tracker at commit `5f747231979463828e79a84eacf7db2337f5903c` ("Bugs fixes and breakfast"). Six sessions (A–F) followed the plan in `~/.claude/plans/pasted-content-id-86e9-audit-the-shimmying-quokka.md`. **No application code, tests, scripts, configuration or documentation were changed, and no findings were fixed.** The authoritative, per-finding evidence (commands, outputs, file:line references) is in `audit/audit-20260928/ledger.md`; this report summarises it for fix planning.

---

## Executive Summary

**Scope.** The whole local app: Next 16.3.5 (App Router, `src/proxy.ts`), React 19.3, Prisma 6.12 + SQLite, Zod 4.6, Tailwind 4, dnd-kit. It covered architecture, persistence and mutation integrity, backup/restore, security under a local threat model, dates/analytics, business rules, React state, accessibility/keyboard, UI implementation, performance, tests, dependencies/config, dead code and documentation. It also re-checked the four fixes from the 2026-09-27 audit (R1–R4).

**What was tested.**
- Every API route was exercised on isolated temporary SQLite databases through `scripts/run-backup-api-test.sh`: 26+ backup/security probe scenarios, contention runs, 5,000-record imports, and timezone runs under Asia/Dhaka, UTC, New York and London.
- The build was run with `npm run build`, and `next start` was run against a temp DB.
- The full Playwright suite ran (`npm run test:keyboard`), plus targeted Playwright probes on isolated DBs.
- Endpoint performance was measured at 500 and 5,000 seeded records.
- All unit, script and API suites ran, including the five that are not wired into `package.json`.

**What was not tested.**
- Manual UI (the user handles this).
- Screen readers or axe (not installed).
- Browser profiling.
- Production-server timings at scale.
- `prisma migrate dev` and destructive `db push` (deliberately not run).
- The user's real `prisma/dev.db` was never opened or queried.

**Findings: 59 root causes** (one ledger entry each; REACT-007 was merged into BAK-003).

| Severity | Count | Confirmed | Inferred | Unverified |
|---|---|---|---|---|
| Critical | 0 | — | — | — |
| High | 2 | 2 | 0 | 0 |
| Medium | 10 | 10 | 0 | 0 |
| Low | 47 | 38 | 8 | 1 |
| **Total** | **59** | **50** | **8** | **1** |

By nature:
- **Application defects:** 34 (including Low UX and semantics issues).
- **Test and tooling defects:** 9 (TEST-001–008, and DEP-002's tooling hazard).
- **Architecture and maintainability:** 5.
- **Dead code and cleanup:** 3.
- **Configuration and dependencies:** 2.
- **Documentation drift:** 3.
- **Performance:** 4 (PERF-003 is source-supported only).

The previous audit's fixes **R1–R4 all hold** (strict boards, status vs history, atomic settings + import, smoke routing).

**Most consequential risks**
1. **SEC-001 (High):** there is no Host validation. A DNS-rebinding web page can read every application and wipe the database through `DELETE /api/applications/purge`. This is reproduced on both `next dev` and `next start`.
2. **BAK-001 (High):** a status history whose timestamps are out of order is rejected by the app's own snapshot validator. An **Undo of a delete then permanently loses the record**, and Nook's own export cannot be re-imported. The trigger is rare (clock skew or future-dated imported events), but the consequence is data loss.
3. **ARCH-001 (Medium):** import validates fields with different rules from the app. Offset dates shift by a day, and `javascript:` or other non-http URLs, untrimmed text, unbounded event text and unsafe IDs are all stored.
4. **DATA-001 (Medium):** SQLite lock waits surface as HTTP 500 after about 5 s. GET requests and every page render perform a write, so any page load during an import fails.
5. **CALC-001 (Medium):** undoing a status move is stored as a real reverse transition. It permanently inflates milestone rates and hides stale applications.
6. **The regression safety net is weak.**
   - TEST-005 (Medium): none of the High findings has a test.
   - TEST-008 and TEST-001 (Medium): the Playwright suite is red for test-side reasons (30 of its 32 failures), so it cannot currently detect UI regressions.

---

## Critical Findings

**None.** No finding meets Critical severity. Both data-loss paths are rated High because they need an uncommon precondition: attacker web traffic plus a known port for SEC-001, and out-of-order timestamps for BAK-001.

---

## High Findings

### SEC-001 — No Host validation: a DNS-rebinding page can read all data, change settings and purge everything
- **Status:** Confirmed on `next dev` (Session B) and on `next start` with the production build (Session F).
- **Subsystem:** Security / request pipeline (`src/proxy.ts`, `src/lib/mutation-request.ts`).
- **Problem:** `isMatchingOrigin` compares the `Origin` only with the request's own `Host` (`mutation-request.ts:70-80`). A rebinding attacker controls both, so the check always passes. Nothing anywhere checks Host against an allowlist. GET routes and server-rendered pages have no gate at all. The `proxy.ts` matcher covers only `/api/:path*`.
- **Evidence:** with `Host: evil.test:<port>` (and a matching `Origin` for mutations):

  | Request | `next dev` | `next start` |
  |---|---|---|
  | `GET /api/applications/export` | 200, all 224 records | 200, canary included |
  | `GET /dashboard` | 200 (page embeds every application) | 200, canary included |
  | `PATCH /api/settings` | 200 | 200 |
  | `DELETE /api/applications/purge` with body `{}` | 200, count 224 → 0 | 200, count 1 → 0 |

  A foreign Origin with the real Host still returns 403, so the CSRF check works for ordinary cross-site requests. All 8 mutation handlers call `checkMutationRequest`.
- **User impact:** any website visited while Nook runs can, after rebinding its hostname to 127.0.0.1, silently copy the whole job-search history and delete it irrecoverably. Purge also removes undo snapshots. The attacker needs the port, and the default is 3000.
- **Trigger:** start Nook, then send requests with a foreign `Host` header. This needs `node:http`; `fetch` cannot override Host. Binding to `127.0.0.1` does not prevent it.
- **Remediation direction:**
  - In `src/proxy.ts`, reject any request whose `Host` is not `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`.
  - Widen the matcher to all routes, including pages.
  - Keep the Origin check.
- **Regression coverage needed:** `smoke-test.mjs` via `node:http`. `GET /api/applications/export`, `GET /dashboard` and `DELETE /api/applications/purge` with `Host: evil.test:<port>` should each return 4xx, with the data unchanged. Also confirm that `localhost` and `127.0.0.1` still work.
- **Related:** SEC-002 (same proxy; the global rate limiter adds little once Host is enforced), TEST-006 (the extra plain DELETE surface), TEST-005.

### BAK-001 — States the app can produce fail its own snapshot validator: Undo-delete loses the record and the export cannot be re-imported
- **Status:** Confirmed (Session B, isolated API).
- **Subsystem:** Backup/restore integrity (`src/lib/backup-snapshot.ts:97-161`, `src/app/api/applications/[id]/restore/route.ts:32`, `src/app/api/applications/[id]/route.ts:85-95`).
- **Problem:** the history `superRefine` requires the initial `null→STATUS` event to sort first and the saved status to match the last event. PATCH and PUT create status events at `createdAt = new Date()` with no ordering guard. If an existing event is dated in the future relative to the server clock, the new event sorts before the initial one. Restore validates the server's own undo snapshot with the same schema.
- **Evidence:**
  1. Import a record whose only event is dated `2099-01-01` → 201.
  2. `PATCH status: INTERVIEW` → 200.
  3. Export, then re-import that record or the **whole export** → 400 (`An initial status event must be first`, `Saved status must match the final status in history`).
  4. `DELETE ?undoable=1` → 200, then restore → 400. The record is gone, and its snapshot expires after 10 minutes.
- **User impact:** Undo on a delete fails with a validation error and the application and its history are permanently lost. The user's own backup cannot be restored anywhere, because one bad record rejects the whole file.
- **Trigger:** event timestamps out of order relative to the server clock. This happens with an imported backup containing future-dated events (hand-edited, or exported on a machine whose clock ran ahead), or when the local clock moves backwards between two status changes. It is not reachable with normal clocks and app-only data.
- **Remediation direction:** none of these options needs a backup-version change.
  - **(a)** Restore must not reject what the server itself snapshotted. Validate the undo payload by field only, or re-insert the stored rows directly.
  - **(b)** Create status events at `max(now, latestEvent.createdAt + 1 ms)`.
  - **(c)** Reject imported events dated after the import time. This is a rejection, not a repair.
  - Do (a) plus (b) at minimum.
- **Regression coverage needed:** in `backup-api-test.mjs`, import a future-dated history and PATCH its status. Then check that (1) the export re-imports into a purged DB and (2) an undoable delete restores with 201.
- **Related:** R2 (same validator; it is correct for the cases it was written for), CALC-001 (same event-creation path), ARCH-001 (import accepts arbitrary timestamps).

---

## Medium Findings

### ARCH-001 — Backup snapshot schema re-declares application field rules, and they diverge from the app's
- **Status:** Confirmed. **Subsystem:** backup validation. **Files:** `src/lib/backup-snapshot.ts:49,51-53,91-96` vs `src/lib/application-schema.ts:4-49`.
- **Problem and evidence:** all of these were reproduced through `POST /api/applications/import`, and each returned 201.
  - **Dates:** `z.iso.datetime({ offset: true })` accepts any time and offset. `2026-10-01T00:00:00+06:00` is stored as `2026-09-30T18:00Z`, so it lands in September's analytics cohort and the interview shows a day early. An unchanged edit-and-save makes the shift permanent.
  - **URLs:** `jobUrl` values `javascript:…`, `data:…`, `ftp:` and "not a url" are stored verbatim. The record then cannot be saved from the edit form (400) until the field is cleared. It is not exploitable as XSS (see Verified Non-Issues).
  - **Text:** `source: ""` and whitespace-only `notes` are stored, where the app stores `null`.
  - **Event text:** event `detail` and `emailSnippet` are unbounded; 2 MB strings were accepted.
  - **IDs:** unconstrained. IDs such as `export`, `a/b`, `x?undoable=1` and a 5,000-character string are stored and then cannot be edited, moved or deleted from the UI, because IDs go into URLs unencoded.
- **Impact:** only hand-edited or third-party backups can trigger this, because app-produced exports always conform. When triggered, dates are wrong by a day in every view and some records cannot be edited.
- **Remediation:** build the snapshot's field validators from shared exports in `application-schema.ts`: a midnight-ISO calendar date, the http(s) URL rule, trimmed text and ID charset. Bound `detail` and `emailSnippet`. Keep `"version": 1` and reject non-conforming files rather than repairing them. Separately, `encodeURIComponent` IDs in client URLs.
- **Regression:** `backup-api-test.mjs` should reject offset and non-midnight dates, non-http(s) and padded URLs, empty or whitespace-only text, unsafe IDs and oversized `detail`. The round trip must still pass.
- **Related:** BAK-001, CLEAN-002, BAK-003 (fix in the same pass).

### DATA-001 — SQLite write contention surfaces as HTTP 500 after ~5 s; the P2034 retry never applies; GETs and page renders fail because they write
- **Status:** Confirmed. **Subsystem:** persistence and robustness. **Files:** `src/lib/undo-snapshots.ts:3-7`, called from `applications/route.ts:12`, `components/application-page.tsx:6` (every page), `[id]/route.ts:70-105,119`, `restore/route.ts:17`, `import/route.ts:26-45`, `src/lib/api.ts:28-29`.
- **Evidence:**
  - 20 concurrent same-revision PATCHes → 1×200, 3×409, 16×500, arriving in waves every 5 s. Prisma reports "Socket timeout", not P2034, so the retry loop never runs. Data stayed consistent.
  - During an 11.8–18.5 s import of 5,000 records, these all returned 500 after about 5.1 s:
    - `GET /api/applications`
    - `GET /dashboard` (because of `undoSnapshot.deleteMany()` during render)
    - `PATCH /api/settings`
    - `POST /api/applications`
- **Impact:** during any import (seconds at hundreds of records, 12–19 s at 5,000), reloading any page shows a server error, toggles show an alert, and a create returns "Something went wrong". A single UI action during an import is enough to hit it.
- **Remediation:**
  - Make undo-snapshot cleanup best-effort and move it out of GET handlers and page renders.
  - Map lock and socket timeouts to a retryable 503 or retry them.
  - Shorten the import's lock by preparing rows and then using `createMany` in the same transaction.
  - Consider a busy timeout, verified against Prisma 6.12.
- **Regression:** a new API test that runs an import of about 2,000 records while `GET /api/applications` and a page GET both return 200, and concurrent same-revision PATCHes that return only 200 or 409.
- **Related:** ARCH-004, PERF-001, REACT-002 (error surfaces).

### CALC-001 — Undo is recorded as a real status transition, permanently inflating milestone rates and resetting the stale clock
- **Status:** Confirmed. **Subsystem:** analytics and business logic. **Files:** `src/components/application-dashboard.tsx:456-512,565-575`, `src/app/api/applications/[id]/route.ts:85-96`, `src/lib/status-history.ts:51-83`, `src/lib/dashboard-analytics.ts:89-99,153-163`.
- **Evidence:** a record 119 days stale with an offer rate of 1/2 was moved to OFFER and then undone with the UI's exact payload. Afterwards its history was `null→APPLIED, APPLIED→OFFER, OFFER→APPLIED`, the offer rate was **2/2**, and the application was **no longer stale**. The "ever reached" milestone model itself is intentional (`dashboard-api-test.mjs:141-153`). The defect is that an undo cannot be told apart from a real move.
- **Impact:** a mis-drag followed by Undo, which is the main undo use case, permanently skews Interview, Offer and Rejection rates and hides genuinely stale applications.
- **Remediation:** add a distinct revision-guarded "undo status" server operation. When the latest event is the one being undone, it deletes that event and restores the previous status, instead of appending a reverse event.
- **Regression:** a dashboard API test that moves, undoes, and asserts the event list, rates and stale membership equal the state before the move.
- **Related:** BAK-001 (same event-creation path), CALC-002, DOC-001 (README undo claim).

### REACT-001 — Settings are server-rendered from defaults; stored settings reach the client only in a parent `useEffect`
- **Status:** Confirmed. **Files:** `src/lib/settings-store.ts:7,18`, `src/components/theme-provider.tsx:17-18`, `src/components/motion-preference.tsx:7-12`, `src/app/layout.tsx:35-44`.
- **Evidence:**
  - The SSR HTML always renders the sidebar expanded, "All applications" expanded, no `data-motion` attribute and default board labels.
  - In Chrome, `.app-workspace` goes `expanded → collapsed` after hydration on `/dashboard`, `/dashboard/stale` and `/jobs`.
  - With in-app Motion set to Off but OS motion allowed, the 240 ms flip still animates.
- **Impact:** a visible layout flip on every page load for users with non-default settings.
- **Remediation:** seed the store synchronously from `initialState` before children render, have server snapshots read that state, and render `data-motion` on `<html>` in `layout.tsx`.
- **Regression:** a Playwright case with stored collapsed settings and custom boards, where the first DOM snapshot is already correct.

### REACT-002 — Settings writes: one PATCH per keystroke, non-optimistic toggles computed from stale renders, transient drag state persisted, three error surfaces
- **Status:** Confirmed. **Files:** `src/components/board-settings.tsx:120,132`, `src/lib/board-preferences.ts:23-26`, `src/lib/general-preferences.ts:22-25`, `src/components/theme-provider.tsx:8-21`, `src/lib/settings-store.ts:13-43`, `src/components/application-dashboard.tsx:167-173,260-266`, `src/hooks/use-board-drag.ts:206-228`.
- **Evidence:**
  - Typing 9 characters sent 9 `PATCH /api/settings` requests in 645 ms.
  - Two quick `Cmd+Shift+S` presses sent 2 PATCHes carrying the same value, so the sidebar ended collapsed instead of back where it started.
  - Errors surface as `window.alert` in lib modules, or as a toast.
  - A 409 caused by a same-tab import reports "Settings changed in another tab".
  - Two GETs are sent per tab switch, and each re-renders the dashboard.
- **Impact:** write amplification, revision churn, alert storms on failure, and wrong toggle results.
- **Remediation:**
  - Keep board-name edits as local drafts and commit on blur or after a debounce.
  - Apply toggles as functional, optimistic store updates.
  - Keep drag auto-expand as local state.
  - Report errors through the existing toast.
  - Ignore refreshes whose revision is not newer.
  - Listen to only one of focus or `visibilitychange`.
- **Regression:** `settings-store-test.mjs` (functional toggle ×2 returns the original value; an equal-revision refresh does not notify), plus a Playwright PATCH count.

### REACT-003 — The interview-date prompt opened from the Edit modal gets no focus
- **Status:** Confirmed symptom; mechanism Inferred. **Files:** `src/components/application-dashboard.tsx:372-375,852-864`, `src/components/job-modal.tsx:74-84`, `src/hooks/use-dialog-focus-trap.ts:40-43`, `src/components/motion-presence.tsx`.
- **Evidence:** after saving an Applied card as Interview with no date from the Edit modal, the prompt is visible but `document.activeElement` is `<body>` at both 0 and 800 ms, with either motion setting. The cause is that two focus traps are mounted at once while the Edit modal is still exiting.
- **Impact:** keyboard and screen-reader users are not moved into a modal dialog.
- **Remediation:** close the Edit modal immediately (`immediateExit`) when the prompt opens. Longer term, use one shared dialog primitive (UI-001).
- **Regression:** a Playwright case asserting that focus is on the prompt's date input after the save.
- **Related:** UI-001. `keyboard.spec.ts:233` is likely the same "trap still active during exit" class, but that is not proven.

### A11Y-001 — The Kanban card is a `role=button` containing a link and a heading; sidebar and archived rows lose keyboard drag
- **Status:** Confirmed from source and dnd-kit internals; no assistive technology was run. **Files:** `src/components/kanban-board.tsx:105-176`, `src/components/application-sidebar.tsx:387-405,496-518`.
- **Evidence:**
  - dnd-kit `attributes` (`role="button"`) are spread onto an `<article>` that contains an `<h4>` and an `<a>`, which is nested interactive content.
  - `aria-label` replaces the card content, so dates are not announced.
  - Sidebar and archived rows override `listeners.onKeyDown` and omit `attributes`, so they have no keyboard drag, even though their labels promise "Edit or archive".
- **Impact:** screen-reader users meet a button that contains a link (axe `nested-interactive`, rated serious), and the sidebar labels promise actions that keyboard users cannot perform.
- **Remediation:** put one real button (edit or drag handle) inside the card and keep the link outside it; add `aria-describedby` for the dates. Either forward the key listener on sidebar rows or change their labels.
- **Regression:** assert that no `button` role contains a link. Adopt `@axe-core/playwright` (a recommendation only; it is not installed).

### TEST-005 — Important production behaviour has no regression coverage, including both High findings
- **Status:** Confirmed by the coverage matrix (every suite grepped).
- **Evidence:** no test covers:
  - the Host allowlist (SEC-001);
  - an out-of-order history restore (BAK-001);
  - import field rules (ARCH-001);
  - undo semantics against analytics (CALC-001);
  - contention (DATA-001);
  - the corrupt-settings path (BAK-003);
  - schema strictness (DATA-002);
  - year 9999 (DATE-001);
  - the midnight rollover (DATE-002);
  - direct unit tests for `backup-snapshot`, `status-history`, `analytics-period` and `calendar-date`.
- **Impact:** the highest-risk fixes can regress silently.
- **Remediation:** see "Regression Tests Required Before Closing Findings" below.

### TEST-008 — The Playwright suite is broadly obsolete after the settings→SQLite move and later UI changes; 30 of its 32 failures are test-side, so it cannot detect regressions
- **Status:** Confirmed by the Session F full run, a classification rerun and three probes.
- **Evidence:** `npm run test:keyboard` gave 17 passed and 32 failed. There were four causes:
  1. **Specs expect `/` to open the Job Board.** In fact `/` redirects to the stored startup page, which defaults to `"dashboard"`, and `Add job` and board cards exist only on `/jobs`. With `startupPage: job-board` stored, 8 of those tests pass unchanged.
  2. **Specs seed settings through localStorage.** Keys such as `nook-sidebar-collapsed` and `nook-archived-expanded` stopped having any effect when `5f74723` moved settings into SQLite.
  3. **Settings leak between tests through the shared test DB.** One spec collapses the sidebar and fails before restoring it, and every later sidebar test starts collapsed.
  4. **Specs assert removed UI or behaviour:**
     - "Recent applications" (removed in `f65917d`);
     - the partial-import "settings could not be restored" message (made impossible by the atomic import, R3);
     - a `light` class on `<html>`;
     - `.nook-toast` count 0, although the node is intentionally retained. A probe showed the toast does hide correctly.
- **Impact:** the only coverage for the REACT, A11Y and UI paths is red on a tree with no confirmed app regression, so it masks real regressions.
- **Remediation:**
  - Navigate to `/jobs` directly.
  - Seed and read settings through the API in fixtures.
  - Reset settings in `beforeEach`.
  - Delete or rewrite the removed-UI assertions.
  - Assert the toast's hidden state rather than its node count.
  - Fix TEST-001.
- **Regression:** `npm run test:keyboard` is green, and stays green when run twice in a row.
- **Related:** TEST-001, TEST-004.

### TEST-001 — `interviews.spec.ts` expects Sunday-start weeks and old headings; the app uses Monday-start weeks
- **Status:** Confirmed. In the Session F run it failed at `interviews.spec.ts:210` because the "This Week" heading was not found, on Monday 2026-09-28.
- **Evidence:** the spec computes weeks with `getDay()`, which treats Sunday as 0, and asserts the headings "This Week" (exact) and "Later". The app, pinned by `scripts/interviews-grouping-test.mjs`, uses Monday–Sunday weeks with "Later This Week", "Next Week" and "Later". The spec is derived to fail on **every** day of the week.
- **Classification:** the test is wrong; the app behaviour is intended.
- **Remediation:** derive the expected groups from the Monday-start rule, or freeze the clock with `page.clock.setFixedTime`.

---

## Low Findings

Each ID's full evidence is in the ledger.

**Architecture and layering**
- **ARCH-002:** settings enum constants are defined twice, in `backup-settings-schema.ts` and in `general-preferences.ts`/`board-preferences.ts`. Confirmed.
- **ARCH-003:** React hooks and `window.alert` live in `src/lib`; hooks import types from components; domain types live in components. Confirmed.
- **ARCH-004:** `ApplicationDashboard` is a 950-line component that owns every page's state and all 7 mutations. Confirmed.
- **ARCH-005:** there is no `server-only` guard on Prisma modules. Inferred and theoretical; no leak exists today.

**Data and API**
- **DATA-002:** POST create and the PATCH status branch silently strip unknown keys, while PUT, archive, settings and import return 400. Confirmed.
- **BAK-002:** import always replaces settings; any later change to a record, even archive then unarchive, rejects the whole file with a raw "Conflicting IDs: <cuid>" message. Confirmed.
- **BAK-003:** an invalid stored Settings row blocks export and settings changes and makes every page return 500; server-side ZodError and SyntaxError are reported as a client 400. Import is the only recovery. Confirmed; kept Low because the trigger needs a manual DB edit or a future schema change.
- **SEC-002:** one process-global 2,000 requests/min limiter for all of `/api`; chunked bodies over 10 MB get 400 instead of 413; under `next start`, a small chunked DELETE body returns 400. Confirmed.

**Dates and business logic**
- **DATE-001:** analytics returns 500 for any period ending 9999-12-31. Confirmed.
- **DATE-002:** the client "today" rolls over only at the first local midnight (a one-shot timer). Confirmed mechanism.
- **CALC-002:** milestone rates are independent, so skipping a stage excludes the application from the earlier rate. Confirmed; the intended behaviour is a product decision.
- **BIZ-001:** "Upcoming interviews" shows 1 on the Overview and 4 in the sidebar/Interviews page under the same name. Confirmed.
- **BIZ-002:** Analytics and Stale ignore custom board labels and colours. Confirmed.
- **BIZ-003:** search and sort are implemented separately per view and disagree. Search is Confirmed; the sort tie-break is Inferred.
- **BIZ-004:** skipping the interview-date prompt suppresses it forever for that application. Confirmed.

**React / Next.js**
- **REACT-004:** a single `movingId` guard silently drops concurrent moves and undos. Inferred.
- **REACT-005:** dashboard views refetch twice per mutation. Confirmed.
- **REACT-006:** one shared `error` state; a failed delete from the Edit modal hides unsaved edits. Inferred.
- **REACT-008:** `/` is a client-only redirect that renders nothing and refetches settings. Inferred.

**Accessibility / keyboard**
- **A11Y-002:** Interviews "tabs" have no roving tabindex, and the arrow keys are a page-global shortcut. Inferred.
- **A11Y-003:** Escape during a keyboard board reorder closes Settings. Confirmed.
- **A11Y-004:** collapsing the sidebar via the shortcut drops focus to `<body>`. Confirmed for the shortcut path.
- **A11Y-005:** the toast live region is hidden until content arrives, and the Undo button is mouse-reachable above modal dialogs. **Unverified**; needs a screen reader.
- **A11Y-006:** landmark and heading structure issues: everything is inside one `<main>`, there is no `h1` on `/jobs`, and the metric cards use `h2`. Confirmed.
- **A11Y-007:** the board-settings reorder announces internal IDs. Confirmed.

**UI implementation**
- **UI-001:** there is no shared dialog primitive, and `JobModal` duplicates the focus trap. Confirmed. Session F added a symptom: after an Add-dialog focus redirect, the next Edit dialog opens with focus on Close.
- **UI-002:** below 768 px the expanded sidebar overlays the board. Inferred.
- **UI-003:** loading and error states have no retry and handle data retention inconsistently. Inferred.
- **UI-004:** the dark-class logic is duplicated and a `:root.light` rule is dead. Confirmed.

**Performance**
- **PERF-001:** every page ships the full application list. Confirmed.
- **PERF-002:** each dashboard endpoint analyses histories about 6N times, and the stale response repeats every item twice. Confirmed.
- **PERF-003:** client render cost. Inferred.
- **PERF-004:** zod and the Prisma browser runtime (105 KB gzip) load on every route via the root layout. Confirmed; new in Session F.

**Tests and tooling**
- **TEST-002:** each Playwright run adds a `.next-playwright.*` pair to the tracked `tsconfig.json`. Confirmed.
- **TEST-003:** five test files are not wired into `package.json`; there is no `npm test`. Confirmed.
- **TEST-004:** the brittle transpile-and-mock unit harness; implementation-coupled assertions. Confirmed.
- **TEST-006:** a stale smoke-test comment; a legacy auth-redirect assertion; a production DELETE branch used only by tests. Confirmed.
- **TEST-007:** the API runner copies the real `dev.db` into `/private/tmp`; the e2e spec writes screenshots to fixed `/private/tmp` paths. Confirmed.

**Dead code, dependencies and configuration**
- **CLEAN-001:** dead exports and functions. Confirmed.
- **CLEAN-002:** unused `NOTE_ADDED`, `emailSnippet` and the redundant `detail` field. Confirmed.
- **CLEAN-003:** localStorage-era `*_KEY`/`setPreference` indirection and magic numbers. Confirmed.
- **DEP-001:** mixed version pinning, no `engines` field, and the package name `application-tracker`. Confirmed.
- **DEP-002:** a `db:migrate: prisma migrate dev` script on a `db push` database, which could prompt a reset; contradictory `.gitignore` migration rules. Confirmed configuration; behaviour Inferred.
- **DEP-003:** `AGENTS.md` is gitignored despite being the instruction file; ESLint does not ignore `.next-playwright*`. Confirmed.

**Documentation**
- **DOC-001:** the README undo claim is inaccurate, and import semantics, limits and the Node version are missing. Confirmed.
- **DOC-002:** AGENTS.md omits the dashboard suite and the unit tests, and its hooks rule contradicts the code. Confirmed.
- **DOC-003:** a code comment contradicts behaviour (`smoke-test.mjs:4`). Confirmed.

---

## Findings by Area

| Area | Findings | Summary |
|---|---|---|
| Architecture | ARCH-001 (M), ARCH-002–005 (L) | Validation rules are duplicated between the app schema and the backup schema (the root of H1/H2); one 950-line client shell; layering drift. |
| Data / SQLite / Prisma | DATA-001 (M), DATA-002 (L), DEP-002 (L) | Lock waits become 500s; GETs and page renders write; inconsistent schema strictness; `db push` vs `migrate dev` hazard. |
| Backup & Restore | BAK-001 (H), ARCH-001 (M), BAK-002 (L), BAK-003 (L), CLEAN-002 (L) | The validator rejects states the app itself produces (data loss on undo); import accepts fields the app would reject; all-or-nothing semantics are undocumented. R1–R4 hold. |
| Security | SEC-001 (H), SEC-002 (L) | DNS rebinding is the one realistic remote attack. CSRF, XSS and prototype pollution are clean; `npm audit` shows 0 advisories. |
| Business logic / analytics | CALC-001 (M), CALC-002, BIZ-001–004 (L) | Undo inflates analytics; counts and labels are inconsistent across views; prompt-skip persistence. |
| Dates / timezones | DATE-001, DATE-002 (L); the date part of ARCH-001 | The pure date libraries are correct under Dhaka, UTC, New York and London. Only imported offset dates, year 9999 and the one-shot midnight timer misbehave. |
| React / Next.js | REACT-001–003 (M), REACT-004–006, 008 (L) | Settings hydration flip; write storm; focus loss when dialogs stack. |
| Accessibility / keyboard | A11Y-001 (M), A11Y-002–007 (L) | Nested interactive card; Escape routing; focus loss on collapse; live region. |
| UI implementation | UI-001–004 (L) | No shared dialog primitive; narrow-screen overlay; no retry control; theme duplication. |
| Performance | PERF-001–004 (L) | Linear full-list reship; repeated history analysis; bundle. Fine at realistic volumes. |
| Tests | TEST-001, TEST-005, TEST-008 (M), TEST-002–004, 006, 007 (L) | The e2e suite is red for test reasons; the High findings have no tests; tsconfig drift; unwired suites. |
| Dependencies / configuration | DEP-001–003 (L), TEST-002 | All dependencies used, 0 advisories; config drift. |
| Dead code | CLEAN-001–003 (L) | Unused exports and schema surface; localStorage-era indirection. |
| Documentation | DOC-001–003 (L) | README undo claim; missing import and limit docs; AGENTS.md drift. |

---

## Verified Non-Issues

These hypotheses were explicitly checked and disproved. Do not re-investigate them.

- **No runtime Prisma path from client code.** Client imports of `dashboard-analytics` are `import type`. `@prisma/client` in client files resolves to the browser enum entry, and the Session F build succeeds. PERF-004 is a bundle-size concern only.
- **No `jobUrl` XSS.** The only `href` sink (`kanban-board.tsx:110-116,141`) trims the value and allows only `http:`/`https:` via `new URL`. The modal renders the URL in `<input value>`.
- **No prototype pollution.** `__proto__`/`constructor` keys at every import level and in the settings PATCH return 400 (strict Zod). POST strips them.
- **No theme-script injection.** `theme` is enum-validated before `JSON.stringify` into the inline script.
- **CSRF coverage is complete.** 8 of 8 mutation handlers are checked. A missing, `null` or foreign Origin, `X-Forwarded-Host`, or a localhost vs 127.0.0.1 mismatch all return 403. Form content types return 415. Only Host spoofing (SEC-001) bypasses the check.
- **No error leakage.** 500 responses are always `{"error":"Something went wrong"}`, and the logs contain only `error.message`.
- **No Dhaka 00:00–06:00 bug for dates entered through the app.** All pure date and analytics libraries give identical results under Dhaka, UTC, New York and London. Stale age uses the user's timezone correctly (Dhaka 15 days vs UTC 16 days for the same event).
- **Monday–Sunday week grouping and weekly buckets clamped to the month are intentional**, and pinned by `interviews-grouping-test.mjs` and `dashboard-api-test.mjs`.
- **Leap years, month and year boundaries, DST handling in `calendarDateInTimeZone`, and the stale severity cutoffs are correct.** Stale threshold 30 never yields MEDIUM by design.
- **H4 import timeout disproved.** 5,000 records took 13.1–18.5 s against the 60 s transaction timeout. The real cost is the lock hold (DATA-001).
- **Overview "Total" includes archived applications and analytics include archived by design** (H9, pinned by tests).
- **Lifecycle invariants hold:**
  - exactly one initial event;
  - a same-status PATCH writes no event;
  - archiving never changes status or events;
  - the revision increments on every mutation;
  - delete → restore preserves status, revision and history;
  - purge keeps settings.
- **The rest of H10 is not a defect.** The undo snapshot has no foreign key, but a cross-application token returns 404. `JSON.parse` only ever sees server-written JSON. `revision` is carried in the payload.
- **Concurrent imports of the same records:** exactly one creates them and the others skip (no P2002 500).
- **Round trip:** export → purge → import → export is byte-identical.
- **Duplicate detection parity:** the form and import paths agree on 812 of 812 single-candidate pairs.
- **The default board honours `settings.defaultBoard`.**
- **No extra overview/stale fetch with threshold 15 on hydration**, because the `today` gate prevents it. No hydration-mismatch warnings. No cross-request leak through the server-side settings singleton.
- **Stacked-dialog body-overflow restore order has no visible effect**, because `body { overflow: hidden }` is global.
- **The Escape order for the dashboard's own dialogs works.** The Delete/Backspace shortcut requires a focused card, is blocked while any dialog is open, and only opens a confirmation. `isMac` and `today` cause no SSR mismatch.
- **The stale-row Archive button being hover-revealed is intentional**; it is also revealed on `:focus-within` and on touch.
- **The Undo toast dismisses correctly after 5 s, and pauses while hovered** (Session F probe, in both real time and fake-clock time). The `.nook-toast` node staying in the DOM is intentional.
- **The Settings shortcut is correctly suppressed while typing in the search field** (Session F probe).
- **Performance:** `trend.buckets.find` (at most 6 buckets), the import loop's `setState` cadence (longest batch 25–28 ms) and `MotionPresence`'s extra render are negligible.
- **Not issues found in Session E:**
  - `tsconfig` target ES2017 with `noEmit` is fine.
  - `next-env.d.ts`, `tsconfig.tsbuildinfo`, `.DS_Store` and `test-results/` are correctly ignored.
  - `.env` has the same keys as `.env.example` and contains no secrets.
  - The comment at `application-dashboard.tsx:47` is accurate.
- **The stale reference to `src/lib/backup-settings.ts` in the previous audit report** refers to a file that no longer exists. No action needed.

---

## Test State

| Suite | Command | Result (Session F) |
|---|---|---|
| Typecheck | `npm run typecheck` | Pass |
| Lint | `npm run lint` | Pass (0 warnings) |
| Shortcuts unit | `npm run test:shortcuts` | Pass 4/4 |
| Duplicate matcher | `npm run test:duplicates` | Pass |
| Unwired unit tests | `node --test scripts/interviews-grouping-test.mjs scripts/motion-preference-test.mjs scripts/settings-store-test.mjs` | Pass 8/8 |
| Setup | `npm run test:setup` | Pass 4/4 |
| Import scale (unwired) | `node scripts/import-scale-test.mjs` | Pass (5,000 records, 6.1 s) |
| Backup API | `npm run test:backup` | Pass |
| Smoke API | `npm run test:smoke` | Pass |
| Dashboard API (unwired) | `bash scripts/run-backup-api-test.sh scripts/dashboard-api-test.mjs` | Pass |
| Build | `npm run build` | Pass |
| E2E | `npm run test:keyboard` | **Fail: 17 passed, 32 failed** (18.1 min) |

- **Playwright failure classification (32):**
  - 30 are test-side: obsolete tests, or test-infrastructure state leakage and cascades (TEST-001, TEST-008).
  - 1 is an application defect, Low: `keyboard:122`, the Edit dialog's initial focus (UI-001).
  - 1 is unresolved: `keyboard:233`, where Settings re-opens when the search field is used during the Settings exit animation. The shortcut-scope rule itself was verified correct.
  - None were environment or resource failures, and none is a confirmed application regression.
  - Session D's earlier 21 unexplained failures come from the same specs and causes.
- **Known obsolete tests:**
  - TEST-001 (interviews grouping).
  - TEST-008: 30 test-side failures across 16 spec files, including TEST-001. The per-test table is in the ledger's Session F section.
  - `motion-preference-test.mjs:35`: a localStorage premise; it passes but is obsolete.
  - `keyboard-shortcuts-test.mjs:20`: a count-coupled assertion.
  - `smoke-test.mjs:29-34`: a legacy auth-redirect assertion.
- **Unwired tests:** `interviews-grouping`, `motion-preference`, `settings-store`, `import-scale`, `dashboard-api` (TEST-003). All pass.
- **Critical missing regression coverage:** see the next-but-one section (TEST-005).
- **H18 tsconfig mutation (TEST-002):**
  - HEAD has 6 committed pairs. Sessions D and E left 9.
  - The Session F full run added exactly **one** pair (`m6MkwS`).
  - The Session F classification rerun and three probes added four more (`uEvjeZ`, `2mwc0T`, `LMcDll`, `dqi57B`).
  - Final state: 14 pairs, `tsconfig.json | 18 +++++++++++++++++-`.
  - Not reverted (plan §9 step 8). No `.next-playwright.*` directory remains.

---

## Performance

**Measured** (Session E, `next dev --webpack`, seeded temp DB; p50 of 9 requests after a warm-up).

| Endpoint | n = 500: p50 / size | n = 5,000: p50 (max) / size |
|---|---|---|
| `GET /api/applications` | 40 ms / 333 KB | 170 ms (188) / 3.34 MB |
| `GET /api/dashboard/overview` | 61 ms / 1.2 KB | 513 ms (531) / 1.5 KB |
| `GET /api/dashboard/stale` | 44 ms / 70 KB | 366 ms (436) / 681 KB |
| `GET /api/dashboard/analytics` CURRENT_MONTH / CURRENT_YEAR / CUSTOM_YEAR 2025 | 10 / 12 / 28 ms | 17 / 99 / 140 ms |
| `GET /api/applications/export` | 47 ms / 492 KB | 390 ms / 4.93 MB |
| `GET /jobs` (SSR) | 267 ms / 1.33 MB | **3,070 ms (4,100) / 13.1 MB** |
| `GET /dashboard` (SSR) | 58 ms / 382 KB | 303 ms (464) / 3.61 MB |
| `GET /interviews` (SSR) | 58 ms / 378 KB | 362 ms (462) / 3.62 MB |

Other measurements:
- **Import of 5,000 records** (Session B, dev server): 11.8 s with 1 event each, 13.1 s with 3 events each, and 18.5 s with 7 events each (9.6 MB). The write lock is held throughout (DATA-001).
- **Build (Session F).** Next/Turbopack reports no sizes, so these come from the files on disk (raw / gzip -9):
  - Each app route loads 1,163 KB / 326 KB.
  - `/`, `/[...slug]` and `/_not-found` load about 980 KB / 274 KB.
  - The chunks are shared: React DOM is 229 / 71 KB; the zod + Prisma browser runtime chunk is 433 / 105 KB and is loaded on every route (PERF-004); `ApplicationDashboard` + dnd-kit + lucide is 188 / 53 KB.
- **`next start` (Session F),** at about 1 record: pages load in 17–185 ms. There are no production measurements at scale.
- **Double fetch (REACT-005):** 2 non-aborted `GET /api/dashboard/stale` requests per mutation. That is about 0.7–1 s of extra server work per mutation at 5,000 records (dev server).
- **Settings writes (REACT-002):** 9 PATCHes for 9 keystrokes.

**Source-supported likely inefficiencies**
- PERF-002: history is analysed about 6N times per overview request, and stale items are serialised twice.
- PERF-001: full-row selection, including `notes`, on every page; every route re-renders the same shell.
- PERF-003: the Kanban FLIP effect calls `getBoundingClientRect` on every card per change, and the dashboard derivations have 0 `useMemo`.

**Theoretical**
- 5,000 × 5,000-character notes would add about 25 MB per page.
- `trend.buckets.find` is negligible.
- `MotionPresence`'s extra render is negligible.
- The re-registered shortcut listener costs little; its real consequence is the ordering bug in A11Y-003.

At realistic personal volumes (tens to a few hundred applications), no performance issue is user-visible. The 5,000-record import limit is where `/jobs` becomes slow.

---

## Remaining Unverified Items

| Item | Why it remains unresolved |
|---|---|
| `keyboard.spec.ts:233` exact mechanism | The probe shows correct behaviour once the Settings exit animation has finished. Proving the "focus reclaimed by the exiting trap" sequence needs step-by-step focus tracing. Low value until UI-001/REACT-003 are fixed. |
| A11Y-005 announcement behaviour | Needs a real screen reader; axe is not installed. |
| Production (`next start`) performance at 500 and 5,000 records | Only n≈1 was measured under `next start`. The scale numbers are from the dev server. |
| PERF-003 client render cost | Needs browser profiling, which was not requested. |
| Module-level bundle attribution | Turbopack strips module paths from production chunks. Attribution relies on marker strings. |
| REACT-004 and REACT-006 races, UI-002 narrow viewport, UI-003 layout shift, A11Y-004 separator and drag paths, DOC-003 pixel arithmetic, DATE-002 sleep/wake | Each needs a dedicated browser reproduction. The existing specs that would touch some of them are currently obsolete (TEST-008). |
| DEP-002 `prisma migrate dev` / destructive `db push` behaviour | Deliberately not run, because it could reset a database. |
| Client import "Cancel import" and closing Settings mid-import | `duplicate-import-focus.spec.ts` failed for the landing-page cause (TEST-008) and was not rerun. `backup-import-limits` (duplicate review) and `import-overlap` passed. |
| `backup-recovery:6` and `duplicate-import-focus:6` classification | Classified as landing-page obsolescence by their identical failure signature, not by a rerun (their imports overwrite the startup-page setting). |

---

## Recommended Fix Order

Nothing below has been implemented. Follow AGENTS.md throughout: `"version": 1` stays; no migrations; reject invalid backups rather than repairing them.

1. **Data-loss and security**
   - **SEC-001:** Host allowlist in `proxy.ts`, with the matcher covering pages too. Reconsider the SEC-002 limiter in the same change.
   - **BAK-001:** field-only validation for restoring the server's own snapshots, plus monotonic event timestamps on PATCH and PUT.
2. **Correctness and integrity** (one validation pass)
   - **ARCH-001 + CLEAN-002 bounds + BAK-003:** shared field validators for import (dates, URL, text, ID charset, event text bounds); encode IDs in client URLs; make settings reads and export resilient to a bad row; fix the ZodError mapping (500 vs 400).
   - **CALC-001:** a dedicated undo-status operation. It shares the event-creation path with BAK-001, so do it right after.
   - **DATA-002:** make POST and the status PATCH `.strict()` (cheap, same pass).
3. **Regression coverage for the above.** Write these tests alongside each fix (see the next section). Before relying on e2e for later steps, repair the e2e suite: **TEST-008 + TEST-001** (navigate to `/jobs`, seed settings through the API, reset settings per test, remove removed-UI assertions). Wire the unwired suites and add `npm test` (TEST-003).
4. **Concurrency and robustness**
   - **DATA-001:** cleanup out of GET and render paths; map lock timeouts to 503 or retry; shorten the import lock with `createMany`.
   - **DATE-001**, **DATE-002**.
5. **React and accessibility correctness**
   - **REACT-001 + REACT-002:** synchronous settings seeding; debounced, functional, optimistic writes; errors via the toast. This also resolves the ARCH-003 alerts.
   - **UI-001:** a shared dialog primitive with a dialog stack. This fixes REACT-003, A11Y-003, the UI-001 Edit-focus symptom, and probably `keyboard:233`.
   - **A11Y-001, A11Y-004, A11Y-006, A11Y-007, A11Y-002, A11Y-005.**
   - **REACT-004, REACT-005, REACT-006, REACT-008.**
   - **BIZ-001 to BIZ-004, CALC-002:** product decisions first, then the shared predicate and sort helpers (BIZ-003).
6. **Test infrastructure**
   - **TEST-002:** a fixed ignored `distDir`, removing the stale tsconfig pairs once with approval, and the ESLint ignore.
   - **TEST-004:** a throwing mock `require` or native TS type stripping.
   - **TEST-006.**
   - **TEST-007:** copy only `schema.prisma`; use `testInfo.outputPath()` for screenshots.
7. **Performance, where justified.** PERF-001 (column selection, one shared shell), then PERF-002, PERF-004, and PERF-003 last.
8. **Cleanup and docs.** ARCH-002 + CLEAN-001 + CLEAN-003 together; ARCH-003, ARCH-004 and ARCH-005 when touching those files; DEP-001–003; DOC-001–003. Update the README after steps 1–2 so the undo and import text describes the fixed behaviour.

---

## Regression Tests Required Before Closing Findings

These findings should **not** be marked fixed without the listed test.

| Finding | Required test (suite) |
|---|---|
| SEC-001 | `smoke-test.mjs` via `node:http`: `GET /api/applications/export`, `GET /dashboard` and `DELETE /api/applications/purge` with `Host: evil.test:<port>` → 4xx and data unchanged; `localhost` and `127.0.0.1` still 200 |
| BAK-001 | `backup-api-test.mjs`: import a future-dated history, PATCH its status, then (1) export → purge → import gives 201, and (2) an undoable delete → restore gives 201 with history intact |
| ARCH-001 | `backup-api-test.mjs`: reject offset and non-midnight dates, `javascript:`/`data:`/non-URL/padded `jobUrl`, empty or whitespace-only text, unsafe IDs and oversized `detail`/`emailSnippet`; the valid round trip still passes |
| DATA-001 | New API case: during an import of about 2,000 records, `GET /api/applications` and a page GET return 200; N concurrent same-revision PATCHes return only 200/409 |
| CALC-001 | `dashboard-api-test.mjs`: move to OFFER, undo → the event list, `offerRate` and stale membership equal the state before the move |
| BAK-003 | `backup-api-test.mjs`: corrupt the Settings row → export returns 200 with the applications; the settings PATCH repairs the row |
| DATA-002 | `smoke-test.mjs`: an extra key on POST and on the status PATCH → 400 |
| DATE-001 | `dashboard-api-test.mjs`: CUSTOM_YEAR 9999 and CUSTOM_MONTH 9999-12 → 200 (or 400 if the year range is capped) |
| DATE-002 | Unit test with fake timers: two consecutive midnights → two notifications |
| REACT-001/002, REACT-003, A11Y-003, A11Y-004, UI-001 | Permanent Playwright cases from Session D's probes D1–D5 and Session F's Edit-focus probe; requires TEST-008 fixed first |
| TEST-008 / TEST-001 | `npm run test:keyboard` green on an unchanged tree, and green again on an immediate second run (no order dependence) |
| TEST-002 | `git diff --exit-code tsconfig.json` after `npm run test:keyboard` |

---

## Final Verification Results

All commands ran from the project root with nothing else running. The Session F logs were kept in the Session F scratchpad and deleted after this report.

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | No diagnostics (3 s) |
| `npm run lint` | 0 | No warnings or errors (9 s) |
| `npm run test:shortcuts` | 0 | 4/4 pass |
| `npm run test:duplicates` | 0 | "Passed: exact, normalized, close, unrelated, and self-exclusion duplicate matching." |
| `node --test scripts/interviews-grouping-test.mjs scripts/motion-preference-test.mjs scripts/settings-store-test.mjs` | 0 | 8/8 pass |
| `npm run test:setup` | 0 | 4/4 pass |
| `node scripts/import-scale-test.mjs` | 0 | `{"records":5000,"batchSize":10,"elapsedMs":6130,"longestBatchMs":25}` |
| `npm run test:backup` | 0 | "Passed: version 1 backup round trip, outdated backup rejection, identical merge, conflicts, malformed atomicity, settings-only import, one-time restore, expiry cleanup on load/delete/restore, collision, invalid status." |
| `npm run test:smoke` | 0 | "Passed: no-login routing, CRUD, all status moves, SQLite persistence, event history, validation, and cascade deletion." |
| `bash scripts/run-backup-api-test.sh scripts/dashboard-api-test.mjs` | 0 | "Passed: Dashboard API states, history, rates, stale boundaries and timezone conversion, Overview consistency, calendar dates, and analytics cohorts." |
| `npm run build` | 0 | "✓ Compiled successfully in 10.8s"; TypeScript 6.0 s; 9/9 static pages generated; 18 routes all `ƒ (Dynamic)`; `ƒ Proxy (Middleware)`; no warnings |
| `npm run test:keyboard` | 1 | 17 passed, 32 failed (18.1 min); classified above |
| Classification rerun: `bash scripts/run-playwright.sh --config <scratch>` with `startupPage: job-board`, 13 spec files unchanged | 1 | 11 passed, 19 failed (6.3 min) |
| Three observation probes (scratch specs via `run-playwright.sh --config`) | 0 | 3/3, 5/5 and 2/2 observations recorded |
| `next start` on the build with a temp DB (guarded by a marker settings row with revision 4242) | 0 | All pages 200 and `/nope` 307; SEC-001 reproduced (read, settings write, purge 1 → 0) |

---

## Repository State After Audit

- **HEAD:** `5f747231979463828e79a84eacf7db2337f5903c` on `main`.
- **`git status --porcelain`:** ` M tsconfig.json`. That is the only tracked change, and it is Playwright-generated (TEST-002). It is not reverted; ask the user before restoring it.
- **Tracked diff against HEAD:** `tsconfig.json | 18 +++++++++++++++++-` (17 insertions, 1 deletion). This adds 8 `.next-playwright.*` include pairs on top of HEAD's 6, for 14 in total:
  - `fHT22d`, `0cmjv2` and `uE5OAm`, from Session D;
  - `m6MkwS`, from the Session F full run;
  - `uEvjeZ`, `2mwc0T`, `LMcDll` and `dqi57B`, from the Session F rerun and probes.
- **Project code, tests, scripts, configuration and docs:** untouched by every session, apart from the tool-generated `tsconfig.json` entries above.
- **Audit files:** `audit/audit-20260928/ledger.md` (updated with the Session F section) and `audit/audit-20260928/nook-audit-report.md` (this file). The whole directory is gitignored.
- **Ignored build and test outputs left in place:**
  - `.next/` now holds the Session F production build; it previously held dev output, and `next dev` uses `.next/dev`.
  - `test-results/` holds the full run's 32 failure folders with traces. It is overwritten by the next Playwright run.
- **`prisma/dev.db`:** 53248 B, mtime 2026-09-27T11:46:19, sha256 `416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`. **Unchanged from baseline**; never opened or queried.
- **Temporary directories:**
  - No `.next-playwright.*` directory.
  - No `/private/tmp/nook-backup-api.*`, `nook-playwright.*`, `nook-f-start.*` or `nook-e-build.*` directory.
  - The three `/private/tmp/nook-empty-*.png` screenshots written by `empty-state-copy.spec.ts` during the Session F rerun were deleted.
- **Processes:** no Playwright, `next dev`, `next start` or `next build` process remains.
- **Scratch outside the repo:**
  - Session F's scratch scripts and logs were deleted.
  - Session E's scratch was deleted at the start of Session F.
  - Scratch files from Sessions B and C (`probe.mjs`, `probe2.mjs`, `p4-*.mjs`, `p5-*`) remain in their own session scratchpads under `/private/tmp/claude-501/…`. They are outside the project, were not on Session F's cleanup list, and can be removed at any time.
