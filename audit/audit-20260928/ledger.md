# Nook audit ledger — 2026-09-28

Plan: `~/.claude/plans/pasted-content-id-86e9-audit-the-shimmying-quokka.md`
Report-only audit. No application code changed. One entry per root cause; later sessions append symptoms to an existing entry instead of opening a duplicate.

Status labels: **Confirmed** (reproduced or directly verified), **Inferred** (source reading only), **Unverified** (not yet examined).

---

## Baseline (Session A, Phase 0)

| Item | Value |
|---|---|
| HEAD | `5f747231979463828e79a84eacf7db2337f5903c` ("Bugs fixes and breakfast", 2026-09-27 11:43 +0600) |
| Branch | `main` |
| `git status --porcelain` | clean (no tracked or untracked changes) |
| Ignored local files | `.DS_Store`, `.env`, `.next/`, `AGENTS.md`, `audit/` (incl. `audit/.DS_Store`), `next-env.d.ts`, `node_modules/`, `prisma/dev.db`, `tsconfig.tsbuildinfo` |
| `prisma/dev.db` fingerprint | size 53248 B, mtime 2026-09-27T11:46:19, sha256 `416ef643f19b632e1dbfe3b632c5512a3cef3c198055a7733e35049ddd8c944c`. Session F must confirm it is unchanged. Not opened or queried. |
| `.env` vs `.env.example` | Same key set (`DATABASE_URL` only). Value is `file:./dev.db`. No secrets. |
| Toolchain | Node v26.8.2, npm 11.19.1, package `application-tracker@0.1.0` |
| Pinned stack | next 16.3.5, react/react-dom 19.3.0, zod 4.6.5, prisma/@prisma/client 6.12.0, typescript 5.9.3, eslint 9.39.5, tailwindcss 4.3.3, @dnd-kit/core ^6.3.1, @dnd-kit/utilities ^3.2.2, lucide-react ^1.48.0, @playwright/test ^1.63.0 |
| Tracked `tsconfig.json` | contains 6 `.next-playwright.*` include pairs (12 entries: `0tzClf`, `GfHVd7`, `vw7hav`, `HsWEek`, `70jFid`, `6livTq`). Recorded as the drift baseline for H18; evaluation belongs to P11/P12 (Session E). |
| Test inventory | 13 files in `scripts/` (unit, API, runners, setup), 23 specs + `api-helpers.ts` in `tests/e2e/` |

### Baseline checks

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **Pass** — exit 0, no diagnostics |
| Lint | `npm run lint` (`eslint .`) | **Pass** — exit 0, no warnings or errors |

After the checks: `git status --porcelain` still clean; `prisma/dev.db` size and mtime unchanged.

Not run in Session A (by plan scope): unit/API suites, build, Playwright.

### Previous audit (2026-09-27) — regression list for Phase 3 (Session B)

Read: `audit/audit-20260927/{nook-audit,nook-audit-report,nook-fix-plan,nook-fix-result,nook-audit-final}.md`. That audit ran at `96e5102`; its fixes landed in `5f74723` (HEAD).

| # | Previous fix | Where it should hold now | Re-verify in |
|---|---|---|---|
| R1 | Strict v1 board validation: `boards` is `[]` or all five statuses exactly once, strict fields | `src/lib/backup-settings-schema.ts:12-24` (present at HEAD, source-checked only) | P3 — malformed/duplicate/partial boards rejected; custom boards round-trip |
| R2 | Saved status must match final status of a complete typed history; incomplete legacy history still accepted | `src/lib/backup-snapshot.ts` `applicationSnapshotSchema` superRefine (message "Saved status must match the final status in history" present at HEAD) | P3 — mismatch rejected, incomplete legacy history accepted |
| R3 | Settings stored in SQLite; import writes applications + settings in one transaction (rollback on failure) | `prisma/schema.prisma` `Settings`, `src/lib/database-settings.ts`, `src/app/api/applications/import/route.ts` | P3 — forced mid-transaction failure rolls back both |
| R4 | Smoke suite routing: `/login` and `/api/auth/session` redirect to `/dashboard`; CRUD assertions reached | `scripts/smoke-test.mjs` | P3/P14 — `npm run test:smoke` passes end to end |

Also carried over from the final check (lower priority): queued board edits computed from latest committed settings (`settings-store.ts`, `board-preferences.ts:23-26`, `scripts/settings-store-test.mjs`); `startup-redirect.tsx` handles refresh rejection; `next-themes` removed.

Stale reference in the previous report: `nook-audit-report.md` cites `src/lib/backup-settings.ts`, which no longer exists (confirmed absent). No action; noted so later sessions don't chase it.

### P0 checklist
- [x] Commit and status recorded
- [x] Ignored and untracked files listed
- [x] `.env` has no secrets
- [x] Typecheck and lint baseline (both green)
- [x] Previous-audit regression list

---

## Module map (Session A, Phase 1)

Method: `grep -rnE 'from "(@/|\.)' src` → 181 internal edges; `"use client"` inventory; `wc -l`. Only one relative import exists (`src/app/layout.tsx:8` → `./nook-icon.png`); everything else uses `@/`.

**Layers and direction**
- `src/app/**` (server pages, API routes) → `src/components/application-page` (pages) or `src/lib/*` (routes). No route imports a component or hook.
- `src/components/*` → `components`, `hooks`, `lib`, `types`.
- `src/hooks/*` → `lib`, `types`, and **two type-only imports from components** (see ARCH-003).
- `src/lib/*` → `lib` only. No lib→component or lib→hook import. `lib` does contain React hooks and `window` calls (ARCH-003).
- `src/workers/backup-import.worker.ts` → `lib/backup-limits`, `lib/backup-snapshot`.

**Server-only modules**: `lib/prisma.ts`, `lib/database-settings.ts`, `lib/undo-snapshots.ts`, `lib/dashboard-analytics.ts` (imports prisma), `components/application-page.tsx` (server component, imports prisma), `app/layout.tsx`.
- Reachability from client code: the three client components that reference `lib/dashboard-analytics` (`dashboard-analytics.tsx:7`, `dashboard-overview.tsx:7`, `dashboard-stale-applications.tsx:5`) use `import type` only, so it is erased. **No runtime path from a `"use client"` file to Prisma was found.** No module uses `import "server-only"` (ARCH-005).
- `@prisma/client` is imported **as a value** (`Status`, `EventType`) by client files (`application-dashboard.tsx:8`, `application-sidebar.tsx:5`, `job-modal.tsx:5`, `kanban-board.tsx:7`, `use-board-drag.ts:18`, `use-toast-undo.ts:3`, and lib modules they load). Prisma resolves this to its browser enum entry; the previous audit's build passed with it. Not a finding; P14's build re-confirms.

**`"use client"` inventory (23)**: components `application-dashboard`, `application-sidebar`, `board-settings`, `dashboard-analytics`, `dashboard-overview`, `dashboard-stale-applications`, `delete-all-data-dialog`, `delete-dialog`, `duplicate-warning-dialog`, `interview-date-dialog`, `interviews-list`, `job-modal`, `kanban-board`, `motion-preference`, `motion-presence`, `settings-modal`, `shortcut-overlay`, `startup-redirect`, `theme-provider`; hooks `use-board-drag`, `use-dashboard-shortcuts`, `use-dialog-focus-trap`, `use-toast-undo`. Files without the directive that are only imported by client files (e.g. `settings-store.ts`, `board-preferences.ts`, `use-application-backup.ts`, `use-scrollbar-activity.ts`, `settings-modal-shell`, `shortcut-list`, `stable-button-label`, `dashboard-metric-card`) are client modules by inclusion. Whether any client component is unnecessary is P6 (Session D).

**Settings store**: `lib/settings-store.ts` is a module-level singleton (`let state`, line 7). It is only imported from client modules, but those are also server-rendered, so the module exists on the server with default state. Behavioral consequences (H6) are for P6 (Session D).

**Oversized modules** (lines): `application-dashboard.tsx` 950, `application-sidebar.tsx` 612, `dashboard-analytics.ts` 302, `job-modal.tsx` 253, `use-board-drag.ts` 248, `settings-modal.tsx` 239, `use-toast-undo.ts` 227, `dashboard-analytics.tsx` 210. Total `src/` TS/TSX: 6,631 lines. See ARCH-004.

**Domain type inventory** — the application record shape is declared independently in these places:

| Shape | Location | Dates | Notes |
|---|---|---|---|
| Prisma `Application` | `prisma/schema.prisma` | `DateTime` | source of truth for storage |
| `ApplicationRecord` | `src/types/application.ts:3-7` | ISO strings | hand-written; serialized by hand in `components/application-page.tsx:14-19`, by `NextResponse.json` in routes |
| `JobFormState` | `src/components/job-modal.tsx:10-19` | `YYYY-MM-DD` strings, `""` for empty | lives in a component; imported by a hook |
| `applicationInputSchema` / edit / status / archive | `src/lib/application-schema.ts:62-94` | strict `YYYY-MM-DD` → UTC midnight | trims text, `""`→`null`, http(s) URL check |
| `applicationSnapshotSchema` | `src/lib/backup-snapshot.ts:91-96` | `z.iso.datetime({ offset: true })` (`:49`) | different rules (ARCH-001) |
| `DashboardApplication` | `src/lib/dashboard-analytics.ts:15-24` | `Date` | local, subset |
| `StaleApplication` | `src/lib/dashboard-analytics.ts:41-49` | ISO string | exported |
| `RecordSnapshot` | `src/hooks/use-application-backup.ts:10` | derived from `BackupSnapshot` | fine (derived) |

Settings shape: single source (`settingsSchema` → `ParsedBackupSettings`), but its enum constants are duplicated (ARCH-002).

### P1 checklist
- [x] Import graph
- [x] `"use client"` inventory
- [x] Server-only modules not reachable from client code (verified: type-only imports)
- [x] Hook→component and lib→component imports
- [x] Domain type inventory
- [x] Oversized-module list

---

## Findings

### ARCH-001 — Backup snapshot schema re-declares application field rules instead of reusing `application-schema.ts`, and the rules diverge
Severity: Medium (Session B kept it at Medium: realistic only for non-app-produced backups)   Category: architecture/validation   Status: **Confirmed** (dates by Session C, and URL/text/event/ID symptoms by Session B; see the updates below)
Hypothesis ref: H1, H2 (this is their shared root cause)   Phase: P1   Session: A
Files: `src/lib/backup-snapshot.ts:49`, `src/lib/backup-snapshot.ts:91-96`, `src/lib/application-schema.ts:4-31`, `src/lib/application-schema.ts:33-49`, `src/lib/application-schema.ts:62-71`
Evidence:
- App write paths: `appliedDateSchema`/`interviewDateSchema` accept only `^\d{4}-\d{2}-\d{2}$` and store `T00:00:00.000Z` (`application-schema.ts:33-49`). Backup: `const date = z.iso.datetime({ offset: true })` (`backup-snapshot.ts:49`) is used for `appliedDate` and `interviewDate` (`:93-94`), so any time and offset passes.
- App: `jobUrl` must be `""` or an http(s) URL ≤ 2000 (`application-schema.ts:12-31`). Backup: `jobUrl: z.string().max(2000).nullable()` (`:96`).
- App: `source`/`notes` are trimmed and `""`→`null` (`optionalText`, `:4-10`). Backup: `source: z.string().max(120).nullable()`, `notes: z.string().max(5000).nullable()` — no trim, `""` kept.
- Backup event `detail` and `emailSnippet` are `z.string().nullable()` with no length bound (`backup-snapshot.ts:51-53`).
Impact: A v1 backup can insert records that the app's own forms and PATCH could never produce. Candidate symptoms (all **Unverified**, owned by Session B/C): off-by-one calendar dates for non-midnight or offset values (H1); a stored `javascript:` or non-URL `jobUrl` (H2; renderer guards still to be checked in P10); `""` vs `null` inconsistencies in duplicate matching and display.
Realistic at Nook's scale: yes for hand-edited or third-party backups. Exports produced by the app itself always use UTC midnight and validated URLs.
Trigger/Repro: Session B P3 scenarios "Date offsets" and "URL protocol" through `scripts/run-backup-api-test.sh`.
Recommended fix: Build the snapshot's field validators from shared exports in `application-schema.ts`, for example a calendar-date-as-ISO-midnight validator and the http(s) URL rule. Keep `version: 1` and reject non-conforming files; do not repair them.
Regression test: `scripts/backup-api-test.mjs` — reject offset/non-midnight dates, `javascript:` URLs, and untrimmed text; the valid round trip still passes.
Related: symptoms to be appended by BAK-*/DATE-*/SEC-* entries rather than opened separately.
**Session C (P4) symptom — date offsets: Confirmed.** Status for the date part is now Confirmed (reproduced through the real import route on an isolated DB); the URL/text parts remain owned by Session B.
- Repro: `scratchpad/p5-api.mjs` via `bash scripts/run-backup-api-test.sh <script>` imported one record with `appliedDate: "2026-10-01T00:00:00+06:00"`, `interviewDate: "2026-10-05T00:00:00+06:00"` → `POST /api/applications/import` **201**.
- Stored: `appliedDate 2026-09-30T18:00:00.000Z`, `interviewDate 2026-10-04T18:00:00.000Z`. Re-export returns the same non-midnight instants, so a round trip does not repair them.
- Analytics: `CUSTOM_MONTH=2026-10` → `applications: 0`; `CUSTOM_MONTH=2026-09` counts it (cohort moved to the previous month by `dateKey` = `toISOString().slice(0,10)`, `dashboard-analytics.ts:285`).
- Overview (`today=2026-10-05`, `Asia/Dhaka`): the interview is **not** upcoming; with `today=2026-10-04` it shows `interviewDate "2026-10-04", daysUntilInterview 0` (`dashboard-analytics.ts:221,237`).
- Client paths use the same UTC slice: `interviewDateKey` (`interviews.ts:18-19`) → `"2026-09-27"` for a `2026-09-28T00:00:00+06:00` value (pure repro, identical under TZ=Asia/Dhaka/UTC/America/New_York/Europe/London); `formatAppliedDate("2026-01-01T00:00:00+06:00")` → `12/31/2025`; import candidate uses `record.appliedDate.slice(0,10)` (`use-application-backup.ts:78`), which shows the *un-shifted* day in the duplicate dialog, so the dialog and the stored record disagree.
- Every app write path other than import enforces the invariant: `appliedDateSchema`/`interviewDateSchema` reject `2026-09-28T00:00:00Z` and store `T00:00:00.000Z` (POST, PUT, PATCH); restore re-inserts the DB's own snapshot (already midnight unless it came from an import).
Impact (confirmed): for a hand-edited or third-party backup with a positive offset, every calendar date is one day early in Kanban, sidebar, Interviews, Overview and Analytics. Severity stays Medium (realistic only for non-app-produced backups).

**Session B (P3/P10) symptoms — URL, text, event bounds, IDs: Confirmed. The whole entry is now Confirmed; severity stays Medium.** Reproduced through `POST /api/applications/import` on an isolated DB (a temporary probe run by `bash scripts/run-backup-api-test.sh <scratchpad probe>`). Every import below returned **201**.
- **Dates, new detail:** an unchanged save **makes the shift permanent.** `appliedDate "2026-01-01T02:00:00+06:00"` was stored as `2025-12-31T20:00:00.000Z`, and the edit form is filled with `2025-12-31`. PUT with the unchanged form returned 200 and stored `2025-12-31T00:00:00.000Z`. A non-midnight UTC value (`2026-01-01T15:45:00.000Z`) is also accepted and stored unchanged.
- **H2 jobUrl: Confirmed at storage; the script-execution part is not exploitable.** `javascript:alert(document.domain)`, `data:text/html,<script>…`, `ftp://…`, `not a url` and `"  https://example.test/p  "` were all stored verbatim. Saving the unchanged edit form then fails with **400** `jobUrl: Job URL must use HTTP or HTTPS` (and `Enter a valid URL`), so the record cannot be edited until the user clears the field. The only `href` sink is `kanban-board.tsx:110-116,141`, which trims and allows only `http:`/`https:`. `job-modal.tsx:197` renders the value in an `<input>`. See "Not issues (Session B)".
- **Text:** `source: ""` and `notes: "   "` are stored as-is, while the app stores `null`. `company`/`role` are trimmed.
- **Unbounded event text:** a `NOTE_ADDED` event with a 2,000,000-character `detail` and `emailSnippet` was accepted and stored. The app never produces `NOTE_ADDED` (H19). The only bound is the 10 MB body.
- **Unconstrained IDs** (`backup-snapshot.ts:92` `id: z.string().min(1)`; the app always generates cuids): the IDs `export`, `purge`, `a/b`, `x?undoable=1`, `has space` and a 5,000-character string were all imported. The dashboard puts IDs into URLs without `encodeURIComponent` (`application-dashboard.tsx:352,429,471,532,578`). PATCH/PUT `/api/applications/export` returned **405** because the static route wins. `…/a/b` returned 307. `…/x?undoable=1` returned 404 because the query is split off. Those records cannot be moved, edited or deleted from the UI. **Safety check:** DELETE `/api/applications/purge?undoable=1` with no body (the shape the UI sends) returns **400** and deletes nothing (application count 28 → 28). This holds only because purge insists on a `{}` body.
Regression tests to add (`backup-api-test.mjs`): reject non-http(s), non-URL and padded `jobUrl`; reject `""`/whitespace-only text; bound `detail`/`emailSnippet`; restrict IDs to a safe charset (e.g. `^[A-Za-z0-9_-]{1,64}$`). Separately, encode IDs in client URLs.

### ARCH-002 — Settings enum constants are defined twice (schema vs preference modules) with no shared source
Severity: Low   Category: duplication   Status: Confirmed (textual duplication verified)
Hypothesis ref: H19 (constants part)   Phase: P1   Session: A
Files: `src/lib/backup-settings-schema.ts:6-10`, `src/lib/general-preferences.ts:10-14`, `src/lib/board-preferences.ts:8-10`, `src/components/application-dashboard.tsx:52`
Evidence:
- `backup-settings-schema.ts:6-10` declares module-private `DEFAULT_BOARD_STATUSES`, `STARTUP_PAGES = ["dashboard","job-board","interviews"]`, `STALE_THRESHOLDS = [7,15,30]`, `BOARD_STATUSES`, `BOARD_COLORS = ["gold","sage","forest","clay","rose","neutral-dim"]`.
- `general-preferences.ts:10-14` redeclares `STARTUP_PAGES`, `STALE_THRESHOLDS`, `DEFAULT_BOARD_STATUSES` with identical literals.
- `board-preferences.ts:10` redeclares `BOARD_COLORS`.
- `application-dashboard.tsx:52` `ApplicationPageName = "job-board" | "dashboard" | "interviews"` is a third copy of the startup-page union.
Impact: None today (values match). A future edit to one copy (e.g. a new board color added to `BOARD_COLORS` in `board-preferences.ts`) would type-check but be rejected by `PATCH /api/settings` and by import.
Realistic: maintenance risk only.
Trigger/Repro: n/a (static).
Recommended fix: Export the constants from `backup-settings-schema.ts` and import them in `general-preferences.ts`, `board-preferences.ts`, and for `ApplicationPageName`.
Regression test: typecheck is sufficient once there is a single source.
Related: P12 (Session E) owns the rest of H19 (dead code, `*_KEY` indirection); append there rather than duplicating.
Session E: the rest of H19 is recorded as CLEAN-001 (dead exports), CLEAN-002 (unused schema surface) and CLEAN-003 (the `*_KEY`/`setPreference` indirection and other duplicated magic values). This entry keeps the settings-enum duplication only.

### ARCH-003 — Layering drift: React hooks and browser UI calls in `src/lib`, hooks importing types from components, domain types living in components
Severity: Low   Category: architecture/layering   Status: Confirmed (structural)
Hypothesis ref: H7 (the `window.alert` part, behavior owned by Session D)   Phase: P1   Session: A
Files: `src/lib/settings-store.ts:1,18`, `src/lib/board-preferences.ts:2,28`, `src/lib/general-preferences.ts:21,24`, `src/lib/board-preferences.ts:25`, `src/hooks/use-application-backup.ts:2`, `src/hooks/use-dashboard-shortcuts.ts:6`, `src/components/job-modal.tsx:10`, `src/components/application-dashboard.tsx:52-53`
Evidence:
- `useSettings` (`settings-store.ts:18`) and `useBoards` (`board-preferences.ts:28`) are React hooks in `src/lib`; AGENTS.md puts hooks in `src/hooks/`.
- `window.alert(error.message)` in `general-preferences.ts:24` and `board-preferences.ts:25`; `window.matchMedia` in `general-preferences.ts:21`. These are lib modules performing UI side effects.
- `use-application-backup.ts:2` `import type { JobFormState } from "@/components/job-modal"`; `use-dashboard-shortcuts.ts:6` `import type { ApplicationPageName } from "@/components/application-dashboard"`, while `application-dashboard.tsx` imports `use-dashboard-shortcuts` (a type-level cycle).
- `JobFormState`, `ApplicationPageName`, `DashboardSection` are domain types declared in components rather than `src/types/`.
Impact: No runtime defect (type imports are erased). It makes lib modules untestable without a DOM, which is one reason the unit harness hand-mocks imports (H21), and it hides error UX (alert) inside data modules.
Realistic: maintainability.
Recommended fix: Move `useSettings`/`useBoards` into `src/hooks/`; return errors from `setPreference`/`saveBoards` and let the calling component surface them; move `JobFormState`, `ApplicationPageName`, `DashboardSection` into `src/types/`.
Regression test: typecheck and lint; existing `scripts/settings-store-test.mjs`.
Related: H7 behavior (write storm, alert on 409) → Session D REACT-*; H21 → Session E.

### ARCH-004 — `ApplicationDashboard` is a 950-line god component owning every page's state and all mutations
Severity: Low (maintainability; runtime and perf consequences are assessed in P6/P9)   Category: architecture/size   Status: Confirmed (structural)
Hypothesis ref: H22 (architecture part), H12 context   Phase: P1   Session: A
Files: `src/components/application-dashboard.tsx:103-950`, `src/components/application-page.tsx:5-23`, `src/components/application-sidebar.tsx` (612 lines)
Evidence:
- 21 `useState` (`:107-127`, covering applications, form, editing id and revision, modal, pending delete, interview-date prompt and draft and error and saving flag, a shared `error`, `saving`, `deleting`, `movingId`, pending duplicate, shortcuts, settings, settings confirmation, search, filter), 14 `useRef`, 0 `useMemo`.
- All 7 mutation requests are inline in this file (`:269` import, `:284` purge, `:352` create/edit, `:429` delete, `:471` status, `:532` interview date, `:578` restore), each repeating `response.json()` + `body.error ?? "…"` handling. There is no shared client API helper.
- Every route (`/dashboard*`, `/jobs`, `/interviews`) renders this one client shell through `ApplicationPage`, which loads all applications (`application-page.tsx:7-9`).
Impact: Concentrates the race, optimistic-rollback, dialog-stacking and a11y risk into one file. Page-specific behavior is switched by props, not composed.
Realistic: yes; it grows with every feature.
Recommended fix: Out of scope for an audit. Candidate direction: extract a mutation/API module (`src/lib/application-client.ts`) and per-concern hooks (form/modal, delete/undo, interview prompt) before any further feature work.
Regression test: existing e2e suite once it is split.
Related: P6 REACT-* (races, shared `error`), P9 PERF-* (full-list reship, double fetches) should reference this entry for the structural cause.
Session E: the performance consequence of the full-list reship is measured in **PERF-001**, and the render-cost side is covered in PERF-003.

### ARCH-005 — Server-only modules have no `server-only` guard
Severity: Low   Category: architecture/boundary   Status: Inferred (theoretical; no current leak)
Hypothesis ref: —   Phase: P1   Session: A
Files: `src/lib/prisma.ts`, `src/lib/database-settings.ts`, `src/lib/undo-snapshots.ts`, `src/lib/dashboard-analytics.ts:3`
Evidence: `grep -rn 'server-only' src` returns nothing. Client components already import `@/lib/dashboard-analytics` (type-only) at `dashboard-analytics.tsx:7`, `dashboard-overview.tsx:7`, `dashboard-stale-applications.tsx:5`; changing one of these to a value import would pull Prisma toward the client bundle with no compile-time error.
Impact: None today (verified type-only).
Realistic: theoretical.
Recommended fix: Add `import "server-only";` to those four modules (this adds the `server-only` package, so confirm with the user first), or move the exported types out of `dashboard-analytics.ts` into `src/types/`.
Regression test: `npm run build` fails if a client module imports them.
Related: ARCH-003 (type placement).

---

## Preliminary hypotheses — status after Session A

Session A re-checked only what P0/P1 cover. None of H1–H22 is treated as confirmed by the planning session.

| H | Session A result | Owner |
|---|---|---|
| H1, H2 | Root cause confirmed at source level as ARCH-001 (schema divergence). Behavioral impact **Unverified**. → **Session B: Confirmed** (see ARCH-001 update and the Session B table below). | B (P3, P10), C (P4) |
| H19 | Duplicated constants **Confirmed** (ARCH-002). Dead code, unused exports, package name and `AGENTS.md` ignore **Unverified** — `AGENTS.md` is ignored per `git status --ignored`; package name `application-tracker` confirmed. | E (P12) |
| H22 | Structural part **Confirmed** (ARCH-004). Performance part **Unverified**. | E (P9) |
| H18 | Baseline recorded (6 stale pairs in tracked `tsconfig.json`). Cause not yet evaluated. | E (P11/P12) |
| H7 | `window.alert` in lib confirmed (ARCH-003). Write-storm/409 behavior **Unverified**. | D (P6) |
| H17 | Observed only: no `prisma/migrations/`, yet `package.json` has `db:migrate: prisma migrate dev`. Not evaluated. | E (P12/P13) |
| H3–H6, H8–H16, H20, H21 | **Unverified** — outside P0/P1. | B, C, D, E per plan §7 |

No preliminary hypothesis was disproved in Session A.

---

## Session C — Phases 4 and 5 (dates, analytics, derived data, business logic)

Scope: P4 and P5 only. No application code changed. Reproductions live in the session scratchpad (deleted at Session F per plan §9): `p4-dates.mjs` (transpiles `calendar-date`, `analytics-period`, `application-date`, `application-schema`, `status-history`, `interviews`, `duplicate-match`, `import-duplicate-index`, and `dashboard-analytics` with a mocked Prisma `findMany`), `p4-midnight.mjs` (extracts `subscribeToLocalDate` verbatim from `application-dashboard.tsx` and drives it with fake timers), `p5-api.mjs` (real routes on an isolated DB through `scripts/run-backup-api-test.sh`).

### Checks run (Session C)

| Check | Command | Result |
|---|---|---|
| Pure date/analytics/business repro | `TZ=Asia/Dhaka node p4-dates.mjs`, then `TZ=UTC`, `TZ=America/New_York`, `TZ=Europe/London` | Ran. Output identical across all four zones except `currentLocalDate()` (expected: New York was still 2026-09-27). Findings below. |
| Midnight timer | `TZ=Asia/Dhaka` and `TZ=America/New_York node p4-midnight.mjs` | 1 timer on subscribe; after it fires, still 1 timer total (no reschedule) → DATE-002 |
| Scratch API repro | `bash scripts/run-backup-api-test.sh <scratchpad>/p5-api.mjs` | exit 0 (first run's import step returned 400 because my fixture had an extra `revision` field — correct rejection; re-run with a valid fixture, exit 0) |
| Dashboard API suite | `bash scripts/run-backup-api-test.sh scripts/dashboard-api-test.mjs` | **Pass** — "Passed: Dashboard API states, history, rates, stale boundaries and timezone conversion, Overview consistency, calendar dates, and analytics cohorts." |

Not run (per instructions): Playwright, `next build`, manual UI. `prisma/dev.db` was not touched (all API work used `/private/tmp/nook-backup-api.*`).

### Date/time edge cases tested (all Confirmed by the pure repro unless noted)

| Case | Result |
|---|---|
| `parseCalendarDateKey`: 2028-02-29 ✓, 2000-02-29 ✓, 2027-02-29 / 2026-02-29 / 2100-02-29 / 2026-04-31 / 2026-13-01 → null | correct |
| `addCalendarDays`: 2028-02-28+1 → 02-29; 2027-02-28+1 → 03-01; 2026-12-31+1 → 2027-01-01 | correct |
| `startOfCalendarWeek` (Monday start): Sun 2026-09-27 → 09-21; Mon 09-28 → 09-28; 2027-01-01 → 2026-12-28; 2028-02-29 → 02-28 | correct |
| `interviewDateSchema`/`appliedDateSchema`: 2028-02-29 accepted, 2027-02-29 rejected, `…T00:00:00Z` rejected, 0000-01-01 and 9999-12-31 accepted | correct; future applied dates (2099) are accepted — no rule exists, not recorded as a defect |
| `calendarDateInTimeZone(2026-09-27T19:30Z)`: Dhaka 09-28, UTC/NY/London 09-27; NY DST-end day 2026-11-01T04:30Z → 11-01; London BST start 2026-03-29T00:30Z → 03-29 | correct |
| Stale age across Dhaka 00:00–06:00: event 2026-09-12T19:30Z, today 2026-09-28 → Dhaka 15 days, UTC 16 days | correct (uses the user's zone) |
| Stale severity, thresholds 7/15/30, ages 6,7,14,15,29,30,59,60,61 | t=7 → 7..29 MEDIUM, 30..59 HIGH, ≥60 CRITICAL, 6 excluded; t=15 → 14 excluded; t=30 → only HIGH/CRITICAL (MEDIUM can never appear at threshold 30 — absolute cutoffs, noted, not a defect) |
| Periods: CURRENT_MONTH on 2028-02-29 → 02-01..02-29; LAST_3_MONTHS on 2026-01-01 → 2025-11-01..2026-01-01; on 2026-02-28 → 2025-12-01..; CURRENT_YEAR on 12-31; CUSTOM_MONTH 2028-02 → ends 02-29, 2027-02 → 02-28 | correct |
| Week buckets: Aug 2026 (starts Saturday) → 6 buckets, first 08-01..08-02, last 08-31..08-31; Feb 2026 (starts Sunday) → first bucket is the single day 02-01; Feb 2028 last bucket 02-28..02-29 | correct by design (Mon–Sun, clamped to month) |
| CUSTOM_YEAR 0000 / CUSTOM_MONTH 0000-01 | 200 via real route |
| CUSTOM_YEAR 9999 / CUSTOM_MONTH 9999-12 | **500** via real route → DATE-001 |
| Interview grouping: Monday 2026-09-28 (+1,+2,+8) → Tomorrow / Later This Week / Next Week; Sunday 2026-10-04 (+1,+7,+8) → Tomorrow / Next Week / Later; Thu 2026-12-31 across year (+1,+3,+4) → Tomorrow / Later This Week / Next Week | correct for Monday-start weeks; contradicts `tests/e2e/interviews.spec.ts` → TEST-001 |
| Upcoming/past split on `today`: today's interview is upcoming (`>= today`) in overview, sidebar count and Interviews page; yesterday's is past | consistent |
| Offset/non-midnight imported dates | shift one day → appended to **ARCH-001** |
| Midnight rollover | one-shot timer → DATE-002 |
| Export filename date | `currentLocalDate()` (browser-local), `use-application-backup.ts:34` — correct |

### P4 checklist
- [x] UTC-midnight invariant on every write path (form/POST/PUT/PATCH enforce it; import does not → ARCH-001; restore re-inserts DB data)
- [x] Dhaka 00:00–06:00 (no UTC-slice bug in the pure libs for midnight-stored data; stale uses the user zone)
- [x] DST zones (NY, London) for `calendarDateInTimeZone`; midnight timer uses local `Date` constructor (fine across NY/London DST, which switch at 01:00/02:00)
- [x] Leap year
- [x] Month and year boundaries
- [x] Week buckets
- [x] Custom period extremes (DATE-001)
- [x] Stale severity cutoffs
- [x] Upcoming/past boundary
- [x] Count consistency across views (BIZ-001, BIZ-002)
- [x] Midnight rollover timer (DATE-002)

### Lifecycle invariants (P5) — reproduced on the real API (`p5-api.mjs`)

| Invariant | Evidence | Holds? |
|---|---|---|
| Exactly one initial event on create | POST → 201, `rev=0`, events `null→APPLIED` | yes |
| Same-status PATCH writes no event | `rev 0→1`, events unchanged | yes (revision still bumps — every accepted mutation increments) |
| Archive never changes status or events | archive `rev 1→2`, unarchive `3→4`: status and events unchanged | yes |
| Status change while archived writes one event | `APPLIED→INTERVIEW` added, still archived | yes |
| PUT editing only notes writes no event | `rev 4→5`, events unchanged | yes |
| Restore-from-archive shape `{status: same, archived:false}` | no event | yes |
| Status + archive together | one `INTERVIEW→OFFER` event, `archived=true` | yes |
| `status` equals last event's `toStatus` | true after every step above | yes |
| Revision increments on every mutation | 0→10 across 10 accepted mutations | yes |
| Delete → restore preserves status, revision and full history | `201`, rev 1→1, `null→APPLIED, APPLIED→INTERVIEW` | yes |
| Purge keeps settings; removes apps, events and undo snapshots | `200`, settings JSON identical, counts `0+0+0` | yes |

### P5 checklist
- [x] Lifecycle transitions (table above)
- [x] Archive never alters status or events
- [x] Duplicate matching parity (form vs import) — 812 single-candidate pairs, 0 verdict mismatches; tie-break differs (see "Not issues")
- [x] Interview prompt rules (BIZ-004)
- [x] Default board — `openAddModal` uses `settings.defaultBoard` (`application-dashboard.tsx:318`); `blankForm` hard-codes APPLIED only as the reset value. No defect.
- [x] Board reorder/labels propagated everywhere (BIZ-002: not in Analytics/Stale; modal status `<select>` uses enum order `job-modal.tsx:21`, not board order)
- [x] Undo semantics and expiry (CALC-001; navigation loss handed to Session D)
- [x] Sort and filter consistency (BIZ-003)

### Findings (Session C)

### DATE-001 — Analytics returns 500 for any period ending 9999-12-31
Severity: Low   Category: dates/validation   Status: Confirmed
Hypothesis ref: — (plan P4 "CUSTOM_YEAR values 0000 and 9999")   Phase: P4   Session: C
Files: `src/lib/dashboard-analytics.ts:106-110,267-271`, `src/lib/analytics-period.ts:16-18`, `src/app/api/dashboard/analytics/route.ts:10-11`, `src/components/dashboard-analytics.tsx:68`
Evidence: `getDashboardAnalytics` queries `lt: dateFromKey(addDays(range.endDate, 1))`. For `9999-12-31`, `addDays` → `dateKey` → `toISOString().slice(0,10)` = `"+010000-01"`; `dateFromKey` splits that into `NaN` parts → `Invalid Date`. Pure repro: `lt=Invalid Date` for CUSTOM_YEAR 9999 and CUSTOM_MONTH 9999-12, but CUSTOM_MONTH 9999-11 is fine. Real route: `GET /api/dashboard/analytics?period=CUSTOM_YEAR&year=9999` → **500 `{"error":"Something went wrong"}`**; `period=CUSTOM_MONTH&month=9999-12` → **500**; `year=0000` → 200, `month=0000-01` → 200. The route regex `^[0-9]{4}$` accepts 9999, and the UI's free-text Year input (`maxLength=4`, digits only) lets a user type it.
Impact: typing year 9999 shows the analytics error state. No data risk.
Realistic: unlikely (typo-level), but reachable from the UI.
Trigger/Repro: above URLs through `run-backup-api-test.sh`.
Recommended fix: compute the exclusive upper bound without re-parsing the ISO slice (e.g. use `lte` on the end date's UTC-midnight, or reuse `calendar-date.addCalendarDays` + `parseCalendarDateKey`), or cap the accepted year range in the route schema. Note `addCalendarDays("9999-12-31", 1)` returns `"10000-01-01"`, which `parseCalendarDateKey` would then reject — pick one bound rule.
Regression test: `scripts/dashboard-api-test.mjs` — CUSTOM_YEAR 9999 and CUSTOM_MONTH 9999-12 return 200 (or a 400 if the range is capped).
Related: none.

### DATE-002 — The client "today" rolls over only at the first local midnight
Severity: Low   Category: dates/react   Status: Confirmed (timer mechanism); Inferred (UI impact)
Hypothesis ref: H20   Phase: P4   Session: C
Files: `src/components/application-dashboard.tsx:92-97,132`
Evidence: `subscribeToLocalDate` schedules a single `window.setTimeout` to the next local midnight and never re-arms it. It is a stable module-level function, so `useSyncExternalStore` subscribes once per mount. `p4-midnight.mjs` (verbatim function, fake timers): after subscribe → 1 timer; after it fires → 1 notification, still 1 timer total, under both Asia/Dhaka and America/New_York. After that, `today` changes only when some other state change re-renders the component (the snapshot `currentLocalDate()` is re-read on every render).
Impact (Inferred): a tab left open and idle past a second midnight keeps the previous `today` for the Overview/Stale/Analytics fetches, the Interviews Today/Tomorrow split, and the sidebar upcoming badge, until the user interacts. Sleep/wake can also delay the first timer (browser timers do not advance during sleep) — Inferred, not reproduced.
Realistic: yes for a pinned tab left open for days; low harm (corrects on any interaction).
Trigger/Repro: `p4-midnight.mjs`.
Recommended fix: re-arm the timeout after it fires inside the subscription, and also notify on `visibilitychange`/`focus` so wake-from-sleep refreshes the date.
Regression test: unit test with fake timers asserting two consecutive midnights notify twice.
Related: H20.

### CALC-001 — Undo is recorded as a real status transition, so an undone move permanently counts toward milestone rates and resets the stale clock
Severity: Medium   Category: analytics/business-logic   Status: Confirmed
Hypothesis ref: H10 (history-growth and stale-reset parts)   Phase: P4/P5   Session: C
Files: `src/components/application-dashboard.tsx:456-512,565-575` (status undo calls `moveApplication` with the previous status), `src/app/api/applications/[id]/route.ts:85-96` (writes an event for any status change), `src/lib/status-history.ts:51-63,79-83` (`knownStatuses` = every status ever seen; latest event drives stale timing), `src/lib/dashboard-analytics.ts:89-99,153-163`
Evidence (real API, isolated DB): application applied 2026-06-01 with its only event back-dated to 2026-06-01; before: `offerRate 1/2`, in stale list at **119 days**. PATCH `status: OFFER`, then the undo's exact payload (`status: APPLIED, archived:false, interviewDate:null, interviewDatePromptDismissed:false`). After: events `null→APPLIED, APPLIED→OFFER, OFFER→APPLIED`; `offerRate` **2/2**; application **no longer stale**. Pure repro gives the same (offerRate 1/1 vs 0/1 without the accidental move; stale 119d → absent).
Intent check: `scripts/dashboard-api-test.mjs:141-153` deliberately asserts "ever reached" milestone semantics for *real* moves (INTERVIEW→OFFER→APPLIED keeps the history), so the milestone model is intended. The defect is narrower: undo is indistinguishable from a real move, and README says undo "reverse[s] recent status changes".
Impact: one mis-drag onto Offer/Interview/Rejected followed by Undo inflates Interview/Offer/Rejection rates for that cohort forever, and hides a genuinely stale application from the Stale view (clock reset to the undo time).
Realistic: yes — drag mistakes plus the `u` shortcut are the main undo use case.
Trigger/Repro: `p5-api.mjs` section 2.
Recommended fix: make status undo a distinct server operation that, when the application's latest event is the one being undone (same revision, no later event), deletes that event and restores the previous status/revision-guarded, instead of appending a reverse event. Keep the existing PATCH for real moves.
Regression test: API test — move to OFFER, undo, assert event list and `offerRate`/stale membership equal the pre-move state.
Related: H10 remainder (unguarded `JSON.parse`, no FK, Zod defaults on restore) stays with Session B (P2).

### CALC-002 — Milestone rates are computed independently, so an application that skips a stage is excluded from the earlier rate
Severity: Low   Category: analytics/semantics   Status: Confirmed (behavior); intent unclear
Hypothesis ref: —   Phase: P4   Session: C
Files: `src/lib/dashboard-analytics.ts:89-99`, `src/lib/status-history.ts:51-63`
Evidence: history `null→APPLIED, APPLIED→OFFER` (status OFFER) in a one-application cohort → `interviewRate 0%`, `offerRate 100%`. Rates use "status ever seen", with no stage ordering. Existing tests do not cover the skip case.
Impact: Offer rate can exceed Interview rate, which reads as inconsistent to a user who never logged the interview stage. Also, an application created directly in OFFER/REJECTED counts only for that milestone.
Realistic: yes (users often skip the assessment/interview columns).
Recommended fix: product decision — either document "reached this exact status" in the metric tooltip, or treat later funnel stages as implying earlier ones (OFFER ⇒ INTERVIEW). Do not change silently.
Regression test: dashboard API case for a skipped stage, asserting whichever rule is chosen.
Related: CALC-001 (same `knownStatuses` model).

### BIZ-001 — "Upcoming interviews" means different things in the Overview and in the sidebar/Interviews page, with no labelling
Severity: Low   Category: business-logic/consistency   Status: Confirmed (divergence); both behaviors are intentional per tests
Hypothesis ref: H8   Phase: P4/P5   Session: C
Files: `src/lib/dashboard-analytics.ts:217-226` vs `src/lib/interviews.ts:54-71`, `src/components/application-dashboard.tsx:620-622`, `src/components/interviews-list.tsx:55-60,124`
Evidence: same six records (active INTERVIEW today, archived INTERVIEW, OFFER, REJECTED in the future, one past, one offset-imported) with today 2026-09-28: overview `upcomingInterviews.count` **1**; `getUpcomingInterviewCount` (sidebar badge and Interviews heading) **4**; Interviews page lists the archived, OFFER and REJECTED rows under "Later This Week". Intent: `tests/e2e/interviews.spec.ts:185` ("includes dated applications from every stage and archive") pins the sidebar/Interviews rule; `scripts/dashboard-api-test.mjs:501-505` pins the overview rule (all archived → count 0).
Second symptom: the Interviews "Upcoming Interviews (N)" heading uses the unfiltered `upcomingCount` while the list below is filtered by the search box (`interviews-list.tsx:55-56` vs `:124`), so "(4)" can sit above "No interviews match your search."
Impact: the Overview card and the sidebar badge show different numbers under the same name on the same screen.
Realistic: yes whenever an archived, offered or rejected application keeps its interview date (moving out of INTERVIEW never clears it).
Recommended fix: keep both rules if wanted, but label them (e.g. Overview "Active upcoming interviews"), or share one predicate from `src/lib/interviews.ts`. Decide whether the heading count should follow the search.
Regression test: unit test on a shared predicate; e2e already pins the Interviews page.
Related: BIZ-002 (view-to-view consistency).

### BIZ-002 — Analytics and Stale views ignore custom board labels and colors
Severity: Low   Category: business-logic/consistency   Status: Confirmed (static; every call site read)
Hypothesis ref: H9 (labels part)   Phase: P5   Session: C
Files: `src/components/dashboard-analytics.tsx:122,126`, `src/components/dashboard-stale-applications.tsx:38`; compare `src/lib/board-preferences.ts:30-34` used by kanban, sidebar and `job-modal.tsx:141,150`
Evidence: Analytics' status breakdown and the Stale list render `STATUS_META[status].label` (with a hard-coded "Online Assessment" override) and `STATUS_META[status].dot`, while every other view uses `boardLabel(boards, status)`/`boardDot`. Also, the job modal's status `<select>` iterates `Object.values(Status)` (`job-modal.tsx:21`), not the user's board order.
Impact: a user who renames "Online assessment" to "Screening" or recolors a board sees the old names/colors in Analytics and Stale. README advertises customizable board names/colors.
Realistic: yes for anyone who customizes boards.
Recommended fix: use `useBoards()` + `boardLabel`/`boardDot` in both dashboard components; order modal options by board order.
Regression test: e2e or component test renaming a board and asserting the Analytics/Stale label.
Related: BIZ-001.

### BIZ-003 — Search and sort rules are re-implemented per view and disagree
Severity: Low   Category: business-logic/consistency   Status: Confirmed (search, pure repro); Inferred (sort tie-break)
Hypothesis ref: —   Phase: P5   Session: C
Files: `src/components/application-dashboard.tsx:278,369,586,613-619`, `src/components/interviews-list.tsx:51-54`, `src/app/api/applications/route.ts:14`, `src/components/application-page.tsx`
Evidence:
- Search (item "Acme Corp"/"Engineer"): query `" acme"` → sidebar **false**, Interviews **true** (sidebar does not trim); `"Corp Engineer"` → sidebar **true**, Interviews **false** (sidebar matches the joined `company role`, Interviews matches each field separately). Sidebar uses `toLowerCase`, Interviews `toLocaleLowerCase`.
- Sort: server orders `appliedDate desc, createdAt desc`; client re-sorts by `appliedDate` only, after prepending new/restored records (`:369,586`) or *appending* imported records (`:278`). Imported records keep their backup `createdAt`, so same-date ordering after an import can differ from the order after reload (Inferred from code; not reproduced in a browser).
Impact: minor surprise — a pasted search with a leading space finds nothing in the sidebar; list order can shuffle on refresh.
Realistic: yes, low harm.
Recommended fix: one `matchesApplicationSearch` and one `compareApplications` in `src/lib/`, used by the sidebar, Interviews and every client re-sort, matching the server `orderBy`.
Regression test: unit tests for the shared helpers.
Related: ARCH-004 (logic inline in the dashboard shell).

### BIZ-004 — Skipping the interview-date prompt suppresses it permanently for that application
Severity: Low   Category: business-logic/ux   Status: Confirmed (behavior); intent unclear
Hypothesis ref: —   Phase: P5   Session: C
Files: `src/components/application-dashboard.tsx:373,504,524-538`, `prisma/schema.prisma` (`interviewDatePromptDismissed`)
Evidence (real API): PATCH to INTERVIEW with `interviewDatePromptDismissed: true`, then INTERVIEW→APPLIED→INTERVIEW: flag still `true`, so both prompt conditions (`!interviewDatePromptDismissed`) stay false for every later entry into INTERVIEW. The prompt also never fires when an application is *created* in INTERVIEW (`previous` is undefined at `:373`) — the form has an interview-date field, so that part looks intentional.
Impact: a user who skipped the prompt for a first-round screen is not asked again when the application returns to Interview for a later round.
Realistic: plausible.
Recommended fix: product decision — clear the flag when the status leaves INTERVIEW, or document "skip = never ask for this application".
Regression test: API or e2e case for leave-and-return.
Related: none.

### TEST-001 — `tests/e2e/interviews.spec.ts` expects Sunday-start weeks and old group headings; the app uses Monday-start weeks and "Later This Week"/"Next Week"
Severity: Medium (test reliability: makes `npm run test:keyboard` fail on most weekdays)   Category: tests/drift   Status: **Confirmed** (Session F: `npm run test:keyboard` failed at `interviews.spec.ts:210`, "This Week" heading not found, on Monday 2026-09-28); grouping output Confirmed
Hypothesis ref: H21 (area)   Phase: P4 (found), owner P11 Session E   Session: C
Files: `tests/e2e/interviews.spec.ts:188-212`, `src/lib/interviews.ts:22-44`, `src/lib/calendar-date.ts:20-24`
Evidence: the spec computes the week end with `date.getDay()` (Sunday = 0, so the week ends Saturday), creates `thisWeek = today+2` when that is before Saturday, and `later = today+8`, then asserts headings `"This Week"` (exact) and `"Later"`. `groupUpcomingInterviews` emits the label `"Later This Week"`, and on Monday 2026-09-28 it groups +2 → "Later This Week" and +8 → **"Next Week"** (pure repro). Both assertions fail on such a day; the unit test `scripts/interviews-grouping-test.mjs` matches the implementation.
Impact: the e2e suite fails for reasons unrelated to regressions, masking real failures in Session F.
Recommended fix: update the spec to the Monday-start rule and current labels (or derive expectations from `groupUpcomingInterviews`).
Regression test: n/a (this is the test).
Related: Session F should expect this failure when running `npm run test:keyboard`.
**Session E (P11) re-check: it fails on every day of the week, not just most weekdays.** Status stays Inferred for the run (spec not executed; Playwright is Session F's), but the expectation logic now has a day-by-day derivation, with Monday = 0 … Sunday = 6 against `groupUpcomingInterviews` (`interviews.ts:22-44`, Monday-start weeks):
- `thisWeek` (+2) exists when the Sunday-start Saturday `weekEnd` is after tomorrow, i.e. Sunday through Thursday. On Mon–Thu the app labels +2 "Later This Week"; `getByRole("heading", { name: "This Week", exact: true })` (`:207`) needs an exact match, so it fails. On Sunday +2 falls in the app's next week ("Next Week"), so it fails too.
- `later` (+8) is only in the app's "Later" group when +8 lies beyond next week's Sunday (today + 13 − d), which is true only for d = 6 (Sunday). So the `"Later"` assertion (`:208`) fails Monday through Saturday.
- Result: Mon–Thu fail on both assertions, Fri–Sat on "Later", and Sunday on "This Week". **Classification: bad test, not bad app behaviour.** `scripts/interviews-grouping-test.mjs` pins the Monday-start rule and passes.
Recommended fix (unchanged): derive expected headings from the Monday-start rule and assert "Later This Week"/"Next Week"/"Later" for fixed offsets relative to a known weekday, or freeze the browser clock (`page.clock.setFixedTime`).

### Preliminary hypotheses — status after Session C

| H | Session C result |
|---|---|
| H1 | **Confirmed** end to end (import 201 → one-day shift in analytics cohort, overview upcoming, Interviews keys, formatting). Recorded under ARCH-001, not a new entry. |
| H8 | **Confirmed** divergence (1 vs 4), but each rule is pinned by an existing test → recorded as a labelling/consistency issue (BIZ-001), not a calculation bug. |
| H9 | Split. **Not a defect:** overview "Total Applications" is labelled "All time" and includes archived by design (`dashboard-api-test.mjs:501-503`); analytics include archived by design (`:516` "Analytics cohort metrics include archived applications"); sidebar shows active count (`application-sidebar.tsx:95`) under a different heading. **Confirmed:** Analytics/Stale ignore custom board labels/colors (BIZ-002). |
| H10 | Partly **Confirmed**: reverse events grow history and reset the stale clock, and also inflate milestone rates (CALC-001). Remaining parts (unguarded `JSON.parse` in restore, no FK, Zod defaults for `revision`) stay with Session B/P2. Delete→restore round trip itself preserves status, revision and history (confirmed). |
| H20 | Split. **Confirmed:** midnight timer is one-shot (DATE-002). **Disproved as defects:** stale age uses the client timezone correctly (Dhaka 15 vs UTC 16 days for the same event); weekly buckets Monday–Sunday clamped to the month are consistent and intentional; Asia/Dhaka 00:00–06:00 exposes no UTC-slice bug for data written through the app (all pure libs give identical results under Dhaka/UTC/NY/London). Analytics trusting the client `today` is by design for a local app. Sleep-delayed timers: Inferred only. |
| H12 (`refreshKey` double fetch), H6 | Not in P4/P5 scope; Session D. |

### Not issues (so the next audit does not repeat them)
- Duplicate detection parity: `findPossibleDuplicate` and `ImportDuplicateIndex` agree on all 812 single-candidate role pairs tried (levels I–V/digits, punctuation, typos, full-width Unicode, plurals). The only difference is which of two *equally* close matches is shown (form: first in the appliedDate-sorted list; import: earliest indexed) — cosmetic.
- Archived applications count as duplicate candidates in the form and import paths — reasonable (you did apply before); not recorded.
- Default board for new applications honours `settings.defaultBoard`.
- Analytics heading on the 1st of a month reads "Analytics - January 1-1" (`analytics-period.ts:88`) — consistent with the pinned "September 1-26" format; cosmetic only.
- Stale threshold 30 never yields MEDIUM severity — follows from absolute cutoffs (30 = HIGH).

### Unverified / handed off (Session C)
- UI impact of DATE-002 after sleep/wake (needs a real browser over midnight).
- Undo state and the 10-minute delete recovery are held in `ApplicationDashboard`, which each route renders separately (`application-page.tsx`), so navigating between `/jobs`, `/dashboard` and `/interviews` likely drops the pending undo/delete-recovery toast while the server snapshot lives on until expiry. **Inferred** from code; owner Session D (P6).
- TEST-001 actual failure (Playwright not run).

---

## Session D — Phases 6, 7, 8 (React/Next.js state, accessibility/keyboard, UI implementation)

Method: full read of every `"use client"` component and hook, `layout.tsx`, `page.tsx`, `application-page.tsx`, the settings store and preference modules, `globals.css` (theme, layout, motion), the relevant `@dnd-kit/core` internals (`KeyboardSensor` listener target, default announcements). Reproductions run only in isolation: `scripts/run-backup-api-test.sh <scratch>/d-probe.mjs` (temp DB and server) and `scripts/run-playwright.sh --config <scratch>/pw/pw.config.ts` (temp DB; runs the targeted existing specs plus a scratch spec `audit-d.spec.ts`; no files added to `tests/`). Scratch files live in the session scratchpad and are deleted at the end. No application code changed.

Entry statuses below are updated in place once the reproductions finish; see "Session D reproduction results".

### REACT-001 — Settings are server-rendered from defaults; stored settings reach the client store only in a parent `useEffect`
Severity: Medium   Category: react/hydration   Status: **Confirmed** (d-probe H6 + Playwright D1)
Hypothesis ref: H6   Phase: P6   Session: D
Files: `src/lib/settings-store.ts:7,18`, `src/components/theme-provider.tsx:17-18`, `src/components/application-dashboard.tsx:128-131`, `src/lib/board-preferences.ts:28`, `src/components/motion-preference.tsx:7-12`, `src/app/layout.tsx:35-44`
Evidence:
- The store starts as `{ settings: defaultSettings, revision: 0 }` (`settings-store.ts:7`). The server never calls `setSettingsState` (only effects and client fetches do), so on the server the module singleton is always the defaults. `useSettings` uses `getSettingsState` as its server snapshot (`:18`); the dashboard's `useSyncExternalStore` calls use literal defaults (`() => false`, `() => false`, `() => true`), `useBoards` uses `() => DEFAULT_BOARDS`.
- `ThemeProvider` pushes the server-read `initialState` into the store in `useEffect` (`theme-provider.tsx:17-18`). Passive effects run child-first, so the first client commit and all child effects see defaults; the real values arrive in a second render.
- `data-motion` is set on `<html>` only in `MotionPreference`'s effect (`motion-preference.tsx:9-11`); before that the CSS falls back to the OS `prefers-reduced-motion` query (`globals.css:655-673`).
Impact (realistic, every full page load/reload): a user who collapsed the sidebar, collapsed "All applications", expanded Archived, or customised board names/colours/empty text first sees the default layout and labels in the SSR HTML, then a flip after hydration. At ≥768px the flip animates (`.app-workspace` has a 240 ms `grid-template-columns` transition, `globals.css:424-427`). With in-app Motion "Off" but OS motion allowed, that animation still plays because `data-motion` is not set yet.
Reproduced: after storing `sidebarCollapsed:true`, `allApplicationsExpanded:false`, `motion:"off"` and custom boards, the SSR HTML of `/jobs` and `/dashboard` contains `sidebar-expanded` (never `sidebar-collapsed`), `aria-expanded="true"` for "All applications" on `/jobs`, and no `data-motion` attribute (d-probe). In Chrome, the `.app-workspace` class sequence on first load was `expanded → collapsed` on `/dashboard`, `/dashboard/stale` and `/jobs` (D1). The rendered `/jobs` markup contains the default column label `>Applied<`. The custom strings (`ZZ Custom Applied`, `ZZ empty APPLIED`) are also present in the HTML, but only as data: `initialState` is serialized into the RSC flight payload as the `ThemeProvider` prop (Inferred from where the prop flows; the probe used plain substring matching and did not separate markup from payload).
Not an issue: **the predicted extra overview/stale fetch with threshold 15 does not happen.** D1 recorded exactly one `GET /api/dashboard/overview threshold=30` and one `GET /api/dashboard/stale threshold=30`, because `today` is `""` during hydration (`getServerLocalDate`), so the first fetch waits until the same post-hydration render that applies the stored threshold. No cross-request leak (the server never writes the singleton); no hydration-mismatch warning (server and client both render defaults).
Trigger/Repro: store non-default settings, then load `/jobs` or `/dashboard` (d-probe H6; D1).
Recommended fix: seed the store synchronously from `initialState` before children render (an idempotent `initializeSettings(initialState)` called during `ThemeProvider` render when the store is still at revision 0), and have server snapshots read that initial state instead of hard-coded defaults. Render `data-motion` on `<html>` from `initialState` in `layout.tsx`, as the theme script already does for `dark`.
Regression test: Playwright — with `sidebarCollapsed: true` and custom boards stored, the first DOM snapshot (init-script `MutationObserver`) is already collapsed with custom labels.
Related: REACT-002 (same store), A11Y-004.

### REACT-002 — Settings writes: one revisioned PATCH per keystroke, non-optimistic toggles computed from render-time values, transient drag state persisted, three different error surfaces
Severity: Medium   Category: react/state-sync   Status: **Confirmed** (Playwright D4, D5; the error-surface and refresh parts are source-verified)
Hypothesis ref: H7   Phase: P6   Session: D
Files: `src/components/board-settings.tsx:34-36,120,132`, `src/lib/board-preferences.ts:23-26`, `src/lib/general-preferences.ts:22-25`, `src/components/theme-provider.tsx:8-11`, `src/lib/settings-store.ts:13-17,26-43`, `src/components/application-dashboard.tsx:167-173,260-266,639-640,805-808`, `src/hooks/use-board-drag.ts:206-210,225-228`
Evidence:
- Board name and empty-text inputs call `onUpdate` on every `onChange` (`board-settings.tsx:120,132`) → `saveBoards` → `updateSettings` → one serialized `PATCH /api/settings` per keystroke; each bumps `revision`.
- Toggles are not optimistic and derive the next value from the render: `toggleSidebar()` sends `!sidebarCollapsed` (`:171-173`), `toggleArchived`/`toggleAllApplications` likewise (`:260-266`). Until the PATCH round-trip re-renders, a second toggle sends the same value, so two quick toggles do not cancel out.
- A drag that auto-expands the collapsed sidebar persists `sidebarCollapsed:false` and then `true` again (`use-board-drag.ts:209,227`): two DB writes for transient UI state.
- Error surfaces differ: `window.alert` in `setPreference`, `saveBoards` and `useTheme().setTheme` (`general-preferences.ts:24`, `board-preferences.ts:25`, `theme-provider.tsx:10`), a toast for sidebar/archive toggles (`application-dashboard.tsx:168,261,265`). A failing PATCH during typing raises one alert per keystroke.
- On 409 the store adopts the server state and rejects with "Settings changed in another tab" (`settings-store.ts:34-36`). A same-tab import also bumps the settings revision (`import/route.ts:39-44`), so a queued settings write during an import gets the same misleading message.
- `ThemeProvider` refreshes on both `focus` and `visibilitychange` (`theme-provider.tsx:19-21`): two `GET /api/settings` per tab switch. `setSettingsState` accepts an equal revision (`<` guard, `:14`) and always notifies, and `getBoards` returns the new `settings.boards` array, so with custom boards every refresh re-renders the whole dashboard and re-runs the Kanban FLIP measurement (`kanban-board.tsx:27-57`, deps `[applications, boards]`).
Impact: write amplification (N PATCHes for an N-character edit), revision churn that makes cross-tab 409s more likely, alert storms on failure, and a double-toggle that leaves the sidebar in the wrong state. All local, so latency is small; realistic at any scale.
Trigger/Repro (results):
- D4: typing 9 characters into the Applied board name sent **9** `PATCH /api/settings` requests within 645 ms (no alerts, since all succeeded).
- D5: after hydration, two quick `Cmd+Shift+S` presses sent **2** PATCHes, and the stored `sidebarCollapsed` ended as **`true`** (expected `false` after two toggles). Both PATCHes carried the same value computed from the stale render.
Recommended fix: keep drafts local and commit on blur or after a short debounce; send functional updates (`updateSettings((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))`) and apply them optimistically in the store; keep drag auto-expand as local state; return errors from the lib functions and show them with the existing toast; ignore refreshes whose revision is not newer; listen to one of focus/visibilitychange.
Regression test: extend `scripts/settings-store-test.mjs` (functional toggle twice → original value; equal-revision refresh does not notify); Playwright PATCH count while typing ≤ 1 after debounce.
Related: ARCH-003 (alert inside lib), REACT-001.

### REACT-003 — The interview-date prompt opened from the Edit modal gets no focus (focus ends on `<body>`), because it mounts while the Edit modal's trap is still active
Severity: Medium   Category: react/focus   Status: **Confirmed** (symptom, Playwright D2); mechanism Inferred
Hypothesis ref: H13 (dialog stacking)   Phase: P6/P7   Session: D
Files: `src/components/application-dashboard.tsx:372-375,852-864`, `src/components/motion-presence.tsx:17-28`, `src/components/job-modal.tsx:74-77,84`, `src/hooks/use-dialog-focus-trap.ts:40-43`, `src/components/interview-date-dialog.tsx:21-23`
Evidence: `saveApplication` calls `closeModal()` and then `openInterviewDatePrompt()` in the same handler when an edit changes the status to Interview without a date (`:372-375`). `MotionPresence` keeps `JobModal` mounted through its exit (`immediateExit` covers only the duplicate and delete cases, `:852`), so `JobModal`'s `focusin` handler (moves focus to its first control whenever focus leaves it, `job-modal.tsx:74-77`) and the prompt's `useDialogFocusTrap` `focusin` handler (moves focus back to the date input, `use-dialog-focus-trap.ts:40-43`) are both registered. When the prompt focuses its date input, each handler moves focus into its own dialog. With reduced motion the exit timeout is 0 but still asynchronous, so both are mounted in the same commit. When `JobModal` finally unmounts it also calls `trigger.focus()` on the card (`:84`).
Reproduced (D2, both `reducedMotion: no-preference` and `reduce`): after saving an Applied card as Interview from the Edit modal, the "Add interview date" dialog is visible, `document.activeElement` is **`<body>`** both immediately and 800 ms later, the Edit dialog is already gone, 5 `focusin` events fired in total, and there were no page or console errors. **Disproved:** an unbounded focus ping-pong or stack overflow. The exact sequence that leaves focus on `<body>` (the trap's `focus()`, the Edit trap's `focusin` redirect, then the Edit modal's cleanup `trigger.focus()` on a card that is re-rendered or removed while the board updates) was not traced step by step.
Impact: a modal dialog opens without focus. Keyboard and screen-reader users are not moved into it or told about it; the first Tab recovers because the trap's keydown handler moves focus to its first control. The existing `interview-date.spec.ts` does not cover this path; it edits a record that is already in Interview, and its drag path passed in the earlier `shortcut-scope` run.
Trigger/Repro: D2 — edit an Applied card, set Status to Interview, leave the date empty, save.
Recommended fix: close the Edit modal immediately when the prompt opens (`immediateExit` also when `pendingInterviewDate !== null`), or open the prompt after the modal's exit completes. Longer term, one shared trap with a dialog stack (UI-001).
Regression test: Playwright — after saving, focus is on the prompt's date input, no page errors, and a `focusin` count below a small bound.
Related: UI-001 (duplicated trap code), A11Y-003.

### REACT-004 — Status moves use one render-scoped `movingId` guard that silently drops concurrent actions, including undo
Severity: Low   Category: react/race   Status: Inferred (source-only; the window is one local PATCH round trip)
Hypothesis ref: H12 (part 1)   Phase: P6   Session: D
Files: `src/components/application-dashboard.tsx:455-514,565-576,591-610`, `src/hooks/use-toast-undo.ts:169-198`
Evidence:
- `moveApplication` returns early without feedback when `movingId !== null` (`:462`). A second drop or `Alt+A` during an in-flight PATCH snaps back silently.
- The guard reads the render closure, so two actions in the same render both pass. There is one `movingId`, so the first `finally` clears it while the second PATCH is still in flight.
- Undo during an in-flight move: `performUndo` dismisses the toast before calling `onUndo` (`use-toast-undo.ts:179-181`); `restoreLatestChange` → `moveApplication` returns early (`:570`) and resolves normally, so the undo is consumed and nothing is restored, with no message. A 409 inside the undo path also resolves normally (`:487-492`), so the undo toast is not re-offered.
Impact: rare lost actions or undos with no feedback; realistic only with fast repeated input.
Recommended fix: track in-flight ids in a ref/set (per application), return a result from `moveApplication`, and have undo re-offer the toast when the move did not run.
Regression test: unit-level extraction of the move reducer, or Playwright with a delayed route (`page.route`) to hold the first PATCH.
Related: ARCH-004.

### REACT-005 — Dashboard views refetch on every `applications` identity change (two requests per mutation)
Severity: Low   Category: react/effects   Status: **Confirmed** (Playwright D6)
Hypothesis ref: H12 (part 2)   Phase: P6   Session: D
Files: `src/components/application-dashboard.tsx:824-834`, `src/components/dashboard-overview.tsx:106-126`, `src/components/dashboard-analytics.tsx:153-174`, `src/components/dashboard-stale-applications.tsx:93-112`
Evidence: `refreshKey={applications}` is an effect dependency in all three views. Each mutation replaces the array twice (the optimistic `setApplications` at `:469`, then the reconciled one at `:494`), so the effect runs twice. D6: one Archive on `/dashboard/stale` produced **2** `GET /api/dashboard/stale` requests, and **neither was aborted**; both completed, because the PATCH round trip is longer than the first GET.
Impact: double server work per dashboard mutation, and a flash of stale-vs-fresh data is avoided only because the previous result is kept. Cheap locally; it compounds with PERF (Session E) at 5,000 records.
Recommended fix: refetch on a mutation counter or server revision that is bumped once after reconciliation, not on array identity.
Regression test: Playwright — one Archive on `/dashboard/stale` → exactly one non-aborted `/api/dashboard/stale` request.
Related: PERF (Session E) should reference this entry for the double-fetch symptom.
**Session E (P9) cost:** the per-request cost at 5,000 records was measured in PERF-002 (dev server): overview p50 513 ms, stale 366 ms / 681 KB. The double fetch therefore costs about 0.7–1 s of extra server work per mutation on a dashboard view at the 5,000 limit, and about 50–120 ms at 500. It stays Low; the fix is unchanged.

### REACT-006 — One shared `error` state for page and modal; a failed delete from the Edit modal closes the modal and leaves `reopenModalAfterDelete` set
Severity: Low   Category: react/state-ownership   Status: Inferred
Hypothesis ref: H12 (part 3)   Phase: P6   Session: D
Files: `src/components/application-dashboard.tsx:117,410-421,423-453,739-743,856`
Evidence: `error` is rendered as the page banner when the modal is closed and inside `JobModal` when it is open (`:739`, `:856`). `requestDeleteCurrent` closes the modal (`:413`). On a delete failure `confirmDelete` calls `setPendingDelete(null)` but does not reopen the modal or clear `reopenModalAfterDelete` (`:447-449`). The form, with any unsaved edits, is still in state but hidden, and the error shows as a page banner. The page banner has no dismiss control and persists until the next action clears `error`.
Impact: after a rare delete failure, unsaved edits disappear from view. Realistic only on server errors.
Recommended fix: split page and form errors; on failure reopen the modal when `reopenModalAfterDelete.current` is set, then reset it.
Regression test: Playwright with `page.route` returning 500 for DELETE from the Edit modal → modal reopens with the form intact.
Related: ARCH-004.

### REACT-007 — merged into BAK-003 (Session B), same root cause (H5)
Status: see BAK-003. Session D's independent probe reproduced it and added symptoms there. No separate entry.

### REACT-008 — `/` is a client-only redirect that renders nothing and refetches settings the layout already read
Severity: Low   Category: react/unnecessary-client   Status: Inferred
Hypothesis ref: —   Phase: P6   Session: D
Files: `src/app/page.tsx:1-5`, `src/components/startup-redirect.tsx:9-17`, `src/app/layout.tsx:35`
Evidence: the layout already awaited `readSettings()`, but `StartupRedirect` returns `null`, calls `GET /api/settings`, then `router.replace`. If that GET fails, `.catch(() => {})` falls through to `getStartupPage()`, which may still be the default because `ThemeProvider`'s effect order is not guaranteed relative to this child's effect (child effects run first), so the stored startup page can be ignored.
Impact: a blank frame plus an extra request on every visit to `/`; the startup page is ignored if the request fails.
Recommended fix: make `src/app/page.tsx` a server component that reads settings and calls `redirect()`.
Regression test: `navigation.spec.ts` — `/` lands on the stored startup page with no `/api/settings` request.

### A11Y-001 — Draggable application items: the Kanban card is a `role=button` containing a link and a heading; sidebar and archived rows lose keyboard drag
Severity: Medium   Category: a11y/semantics   Status: Confirmed (source and dnd-kit internals verified; no AT run)
Hypothesis ref: H14   Phase: P7   Session: D
Files: `src/components/kanban-board.tsx:105-176`, `src/components/application-sidebar.tsx:387-405,496-518`, `node_modules/@dnd-kit/core/dist/core.esm.js:3406-3439`
Evidence:
- `KanbanCard` spreads dnd-kit `attributes` (`role="button"`, `aria-roledescription="draggable"`, `tabIndex=0`, `aria-describedby`) onto an `<article>` that contains an `<h4>` and, when a URL exists, a focusable `<a>` (`:119-153`). That is a nested interactive control inside a `role=button`, and the heading loses its semantics (button children are presentational). `aria-label="Edit or move {role} at {company}"` (`:128`) replaces the content, so applied and interview dates are not announced.
- `SidebarApplicationRow` and `ArchivedRow` spread `listeners` and then pass their own `onKeyDown` after it (`application-sidebar.tsx:401-405`, `513-517`), which overrides dnd-kit's keyboard activator, and they omit `attributes`. They cannot be dragged by keyboard, and the DnD instructions are not attached. Their labels promise "Edit or archive …" and "Edit or move archived …". Archived rows have a Restore button, but a sidebar row has no keyboard archive path; `Alt+A` works only on a focused board card.
Impact: screen-reader users hear a button with a nested link (axe `nested-interactive`, serious); the label promises actions a keyboard user cannot perform from the sidebar.
Recommended fix: keep the card a plain container with one real `<button>` (Edit / drag handle) carrying the dnd `attributes`, and put the link outside it; include dates in `aria-describedby`. For sidebar rows either forward `listeners.onKeyDown` as the card does, or drop "or archive/move" from the labels and add an explicit Archive action.
Regression test: add `@axe-core/playwright` (recommendation only; not installed) or assert `getByRole("button")` has no descendant link in `keyboard.spec.ts`.
Related: A11Y-006.

### A11Y-002 — Interviews "tabs" are not a tabs widget; arrow keys are a page-global shortcut
Severity: Low   Category: a11y/keyboard   Status: Inferred
Hypothesis ref: H14   Phase: P7   Session: D
Files: `src/components/interviews-list.tsx:85-102`, `src/lib/keyboard-shortcuts.ts:49`, `src/hooks/use-dashboard-shortcuts.ts:100-103`
Evidence: both tabs stay in the Tab order (no roving `tabIndex`); `onKeyDown` handles only Home/End. ArrowLeft/ArrowRight are the global `switch-interview-tabs` shortcut, active whenever focus is not in an editable field, so they also fire from the Sort button, a link, or `body`, and `preventDefault` blocks arrow-key scrolling of the page's scroll container.
Recommended fix: implement the ARIA tabs pattern locally (roving `tabIndex`, arrows on the tablist only) and drop the global arrow binding.
Regression test: `interviews.spec.ts` — Tab from Upcoming skips Past; ArrowRight on the Sort button does not switch tabs.

### A11Y-003 — Escape is routed by a document listener that is re-registered on every render and handles "close Settings" before any nested interaction
Severity: Low   Category: a11y/keyboard   Status: **Confirmed** (Playwright D3)
Hypothesis ref: H13   Phase: P7   Session: D
Files: `src/hooks/use-dashboard-shortcuts.ts:65-83,160-162`, `node_modules/@dnd-kit/core/dist/core.esm.js:1147-1158`, `src/components/board-settings.tsx:28-32,70`
Evidence: the effect has no dependency array, so the `keydown` listener is removed and re-appended after every dashboard render. The `"close"` branch runs before the `anotherDialogIsOpen`/`dragActive` checks and closes Settings unless an earlier listener already called `preventDefault`. The dashboard's own dialogs register their Escape listeners at mount (JobModal in capture phase), so they win today. dnd-kit's `KeyboardSensor` adds its document `keydown` listener in a `setTimeout` after drag start, so it runs **after** the shortcut listener. D3: Settings → Board, focus "Reorder Applied board", Space (pick up), ArrowDown, Escape → **the Settings dialog closed** (not visible 600 ms later); the stored board order was unchanged (`[]`), so the reorder itself was cancelled.
Not an issue (disproved part of H13): body-overflow save/restore order across stacked dialogs has no visible effect because `body { overflow: hidden }` is global (`globals.css` `body` rule) and `main` is `h-screen overflow-hidden`.
Recommended fix: route Escape through a dialog stack (topmost dialog closes), and skip `close` when a DnD keyboard drag is active in any `DndContext` (e.g. check `document.body` state or `[aria-pressed=true]` drag handle).
Regression test: Playwright D3 as a permanent case in `keyboard.spec.ts`.
Related: REACT-003, UI-001.

### A11Y-004 — Collapsing the sidebar while focus is inside its content drops focus to `<body>`
Severity: Low   Category: a11y/focus   Status: **Confirmed** for the shortcut path (Playwright D5); separator and drag paths Inferred
Hypothesis ref: —   Phase: P7   Session: D
Files: `src/components/application-sidebar.tsx:99-123,127-141,228`, `src/components/application-dashboard.tsx:171-173,233-234`
Evidence: D5 focused a sidebar application row, pressed `Cmd+Shift+S`, and after the PATCH `document.activeElement` was `<body>`. `.sidebar-content` becomes `inert` when collapsed (`:228`), and the resize separator unmounts (`:127`). Focus restoration (`pendingToggleFocusRef`) runs only when the header toggle buttons are used (`:120-123`). Collapsing via the shortcut, by dragging the separator below 180 px, or via drag auto-collapse leaves the focused element inert or removed.
Recommended fix: before collapsing, if `document.activeElement` is inside `.sidebar-content` or is the separator, move focus to the Expand button.
Regression test: D5 as a permanent case in `sidebar-interactions.spec.ts`.

### A11Y-005 — Toast region: live region hidden until content arrives, and the Undo button stays mouse-reachable above modal dialogs
Severity: Low   Category: a11y/live-region   Status: Unverified (announcement behaviour needs a screen reader; the layering is source-verified)
Hypothesis ref: H14   Phase: P7   Session: D
Files: `src/components/application-dashboard.tsx:928-947`, `src/app/globals.css` `.nook-toast-wrap` (z-index 100, `pointer-events: auto` when shown)
Evidence: `role="status" aria-live="polite"` sits on a wrapper that flips `aria-hidden`/`inert` in the same commit that inserts the message; some screen readers skip announcements from a region that was just unhidden. The wrapper sits at z-index 100, above every dialog (50–70), so a mouse user can press Undo while a modal is open (keyboard is trapped).
Recommended fix: keep an always-present, never-`aria-hidden` live region holding only the message text; render the visual toast separately; hide or disable the toast while a modal is open.

### A11Y-006 — Landmarks and headings
Severity: Low   Category: a11y/semantics   Status: Confirmed (source)
Phase: P7   Session: D
Files: `src/components/application-dashboard.tsx:728`, `src/components/application-sidebar.tsx:126,206-213,234`, `src/components/kanban-board.tsx:81,134`, `src/components/dashboard-metric-card.tsx:19`
Evidence: the whole app, including the sidebar `<aside>` and `<nav>`, is inside one `<main>`. `/jobs` has no `<h1>`: headings are sidebar `h2` → column `h3` → card `h4`. The `h2 aria-label="All applications"` overrides its content, so the count is dropped. Each dashboard metric card label is an `h2` (5 on Overview, 4 on Analytics). The Interviews nav link has `aria-label="Interviews"` while its upcoming-count badge is `aria-hidden`, so the count is not exposed. Status colours always come with a text label (no colour-only indicators found).
Recommended fix: make `<main>` wrap only the page content; add a visually hidden `h1` "Job Board"; render metric labels as `<p>`/`<dt>`; include the count in the link's accessible name.

### A11Y-007 — Board-settings reorder uses dnd-kit's default announcements, so screen readers hear internal IDs
Severity: Low   Category: a11y/dnd   Status: Confirmed (source and dnd-kit defaults verified)
Phase: P7   Session: D
Files: `src/components/board-settings.tsx:70,99`, `node_modules/@dnd-kit/core/dist/core.esm.js:43-68`
Evidence: `BoardSettings`' `DndContext` sets only `screenReaderInstructions`. The default announcements read `"Picked up draggable item " + active.id` and `"… over droppable area " + over.id`, so users hear `reorder:APPLIED` / `APPLIED` instead of the board names. The Kanban `DndContext` does use custom labels (`application-dashboard.tsx:749-767`), verified correct, including custom board names.
Recommended fix: pass `announcements` built from `boards` labels.

### UI-001 — No shared dialog primitive: `JobModal` re-implements the focus trap, and five dialogs duplicate the Escape/backdrop/close-button code
Severity: Low   Category: ui/duplication   Status: Confirmed (source)
Hypothesis ref: H13   Phase: P8   Session: D
Files: `src/components/job-modal.tsx:49-86`, `src/hooks/use-dialog-focus-trap.ts`, `src/components/delete-dialog.tsx:27-37`, `src/components/delete-all-data-dialog.tsx:22-31`, `src/components/duplicate-warning-dialog.tsx:38-51`, `src/components/interview-date-dialog.tsx:25-33`
Evidence: `JobModal` copies the trap (a different focusable selector, no `suspended` support, captures its trigger from `document.activeElement`). Four dialogs each add their own document `keydown` Escape effect; the backdrop markup and the close "×" SVG are repeated. The body-overflow lock is repeated in each dialog but has no effect (global `body { overflow: hidden }`).
Impact: behaviour drifts between dialogs (REACT-003 and A11Y-003 come from this); every fix has to be applied five or six times.
Recommended fix: one `Dialog` component (backdrop, labelled panel, trap, Escape via a dialog stack, return focus, exit presence) used by all dialogs; remove the no-op overflow lock.
Related: REACT-003, A11Y-003.
**Session F symptom (Confirmed, Playwright probe):** after focus is moved out of the Add dialog (the `JobModal` trap redirects it to Close) and the dialog is cancelled, the next Edit dialog opens with focus on **Close** instead of Company (checked at +0, +200 and +1000 ms). Without that step Edit focuses its first input. This is why `keyboard.spec.ts:122` fails. Severity stays Low.

### UI-002 — Below 768 px the expanded sidebar overlays the board, and it is expanded by default and on SSR
Severity: Low   Category: ui/responsive   Status: Inferred (narrow viewport not exercised by the targeted specs)
Phase: P8   Session: D
Files: `src/app/globals.css` (`.sidebar-panel` absolute, `width: min(320px, calc(100vw - 48px))`; the `@media (max-width: 767px)` block), `src/lib/settings-defaults.ts:5`
Evidence: under 768 px `.app-workspace` has one grid column, and the absolutely positioned sidebar (z-index 20) covers the board with no backdrop, no outside-click close and no auto-collapse. `sidebarCollapsed` defaults to `false`, and SSR always renders expanded (REACT-001). Only the collapsed state gets a dedicated grid column (`.app-workspace.sidebar-collapsed`).
Recommended fix: treat the expanded sidebar as a modal drawer on narrow screens (backdrop, Escape, focus management), or default to collapsed below 768 px without persisting that.

### UI-003 — Loading and error states: no retry, inconsistent retention of the last good data, placeholder heights not tied to content
Severity: Low   Category: ui/states   Status: Inferred (layout-shift part Unverified)
Phase: P8   Session: D
Files: `src/components/dashboard-overview.tsx:119-135`, `src/components/dashboard-stale-applications.tsx:106-146`, `src/components/dashboard-analytics.tsx:168-206`
Evidence: all three error messages say "try again later" but offer no retry control; a retry happens only when `today`, the threshold or `applications` changes. On a failed refresh Overview discards its last good data (`setResult(null)`), Stale keeps it but hides it behind the error (`data && !error`), and Analytics keys errors by selection. Loading copy is sr-only on Overview and Analytics but visible on Stale. Analytics uses fixed `h-52` placeholders for the chart areas, and whether they match the rendered chart height is not verified (possible layout shift).
Recommended fix: one shared "load state" helper: keep the last good data, show an inline error with a Retry button, and use consistent loading copy.

### UI-004 — Theme implementation: duplicated dark-class logic and a dead `color-scheme` rule
Severity: Low   Category: ui/theme   Status: Confirmed (source)
Phase: P8   Session: D
Files: `src/app/layout.tsx:36`, `src/components/theme-provider.tsx:24-33`, `src/app/globals.css:53-54`
Evidence: the inline script and `ThemeProvider` each implement the same `dark`/`system` rule. `:root.light { color-scheme: light; }` never matches because nothing adds a `light` class; it is harmless because light is the UA default. Verified correct: the dark tokens are redefined under `.dark` for every `@theme` colour; the system `matchMedia` change listener is attached and removed; `theme` is enum-validated before it reaches the inline script. Theme changes are not optimistic (REACT-002).
Recommended fix: share one `applyTheme(theme)` string/function between the script and the provider; drop the `.light` rule or add the class.

### P6–P8 observations handed to Session E (PERF), not separate findings
- `ApplicationDashboard` recomputes `sidebarItems` (3 filters + sort), `archivedItems`, `getInterviewListItems`, `getUpcomingInterviewCount` and a linear `find` on every render, with 0 `useMemo` (`application-dashboard.tsx:612-623`). `KanbanBoard` filters the full list once per board (`kanban-board.tsx:61-64`).
- The Kanban FLIP `useLayoutEffect` calls `getBoundingClientRect` on every card in both cleanup and effect for every `applications`/`boards` change (`kanban-board.tsx:27-57`), including the settings-refresh re-renders from REACT-002.
- `MotionPresence` calls `setSnapshot` during render whenever `children` identity changes (`motion-presence.tsx:14`); for an open dialog that is every parent render, which adds one extra render pass per open dialog.
- `useDashboardShortcuts` removes and re-adds its document listener on every render (`use-dashboard-shortcuts.ts:65-162`); cheap, but it causes the ordering issue in A11Y-003.
- The PATCH-per-keystroke volume (REACT-002) and the double dashboard fetch (REACT-005) are the P9 "settings PATCH volume" and "double fetches" items.

### P6 checklist
- [x] Settings hydration order (REACT-001)
- [x] Settings write storm and conflicts (REACT-002)
- [x] Effect cleanups: all listeners, timers, observers and pointer captures are cleaned up; no leak found
- [x] Stale closures in undo and shortcuts: the main paths are fresh (the shortcut listener is re-subscribed each render; `onUndo` is read at call time); remaining stale reads are in REACT-002 (toggles) and REACT-004 (`movingId`)
- [x] Overlapping mutations (REACT-004)
- [x] Optimistic rollback: `moveApplication` rolls back status, archive, interview date and prompt flag on failure; a 409 loads the server copy; no defect beyond REACT-004
- [x] Hydration mismatch sources (see the hypothesis table)
- [x] Loading, empty and error per page (UI-003)
- [x] Unnecessary client components (REACT-008; the others need client state)

### P7 checklist
- [x] Every dialog: role, label, initial focus, trap, Escape, return focus. All six have `role=dialog/alertdialog`, `aria-modal`, `aria-labelledby`; destructive ones use `alertdialog` with `aria-describedby`. Issues: REACT-003, A11Y-003, UI-001
- [x] Stacked dialogs (Settings with Duplicate: trap suspended and focus returned, verified in source; Settings with Delete-all: guarded by `settingsConfirmationOpen`)
- [x] Keyboard DnD and announcements (custom coordinate getter follows the board order from `getBoards()`; custom labels are used; A11Y-001, A11Y-007)
- [x] Shortcut scope and destructive keys (Delete/Backspace requires the focused element to *be* a board card, is blocked while any dialog is open, and only opens a confirmation. Editable targets, including `[contenteditable]` and `select`, are excluded except for Escape)
- [x] Collapsed sidebar `inert` and focus (A11Y-004)
- [x] Tablist pattern (A11Y-002)
- [x] Nested interactive elements (A11Y-001)
- [x] Live regions (A11Y-005)
- [x] Reduced motion (CSS and JS agree once `data-motion` is set; pre-hydration gap in REACT-001)

### P8 checklist
- [x] Narrow and wide layouts (UI-002; wide: `page-shell` max 100rem, columns clamp 15.5–22.5rem with `justify-content: safe center`)
- [x] Overflow and `min-w-0` (grid `minmax(0,1fr)`, `min-w-0` on scroll containers and text blocks; no defect found)
- [x] Scroll containers (`useScrollbarActivity` uses passive listeners and is cleaned up; one per column plus the board)
- [x] Theme switching incl. system change (UI-004)
- [x] Layout shift in loading states (UI-003; `StableButtonLabel` reserves width correctly)
- [x] Duplicated UI patterns (UI-001)


### Session D reproduction results

| Check | Command (isolated) | Result |
|---|---|---|
| H5/H6 API probe | `bash scripts/run-backup-api-test.sh <scratch>/d-probe.mjs` (temp DB and server) | exit 0. Results under REACT-001 and BAK-003 |
| Session D Playwright probes D1–D6 | `bash scripts/run-playwright.sh --config <scratch>/pw/pw.config.ts --project audit-d` | 6/7 passed on the first run; D6 timed out on a harness artifact: the stale-row Archive button is `pointer-events: none` until `:hover` (`globals.css:577-589`, intended hover-reveal, keyboard reveals via `:focus-within`). D5's double-toggle presses fired before hydration. Rerun of D5+D6 (hover first; wait for `html[data-motion]`): 2/2 passed. Probes record observations; they do not assert the bug |
| Targeted existing specs (`keyboard`, `shortcut-scope`, `sidebar-*`, `duplicate-import-focus`, `interview-date`, `kanban-layout`, `scrollbars`, `settings-zoom`, `application-revision`) | same runner, project `existing`, in one combined run with the probes | **Aborted**: the background task hit its 10-minute cap (exit 143) during `sidebar-layout`. Before that, 3 passed (`kanban-layout`, `settings-zoom`, `shortcut-scope` "Escape closes the interview date prompt…") and 21 failed, 14 of them at the 60 s test timeout. The reporter was killed before printing failure details, so **the causes are Unverified**: this may be environment (a concurrent Session B API server was using heavy CPU; first-compile latency under `next dev --webpack`) or real. Not counted as app regressions. Session F should run `npm run test:keyboard` alone and read the failures (and expect TEST-001) |

| Probe | Observation |
|---|---|
| D1 first load with `sidebarCollapsed:true`, threshold 30, custom boards | `.app-workspace` class sequence `expanded → collapsed` on `/dashboard`, `/dashboard/stale`, `/jobs`. Exactly one `overview`/`stale` request each, with `threshold=30` (REACT-001) |
| D2 Edit → Interview (both motion modes) | prompt visible, focus on `<body>` at 0 ms and 800 ms, 5 `focusin` events, no errors (REACT-003) |
| D3 Escape during keyboard board reorder | Settings dialog closed; board order unchanged (A11Y-003) |
| D4 typing 9 chars into a board name | 9 PATCHes in 645 ms (REACT-002) |
| D5 `Cmd+Shift+S` with focus on a sidebar row | focus on `<body>`, sidebar collapsed (A11Y-004). Two quick presses → 2 PATCHes, stored `sidebarCollapsed: true` (REACT-002) |
| D6 Archive on `/dashboard/stale` | 2 `GET /api/dashboard/stale`, neither aborted (REACT-005) |

Side effects of these runs: each `run-playwright.sh` run made Next's dev server add a `.next-playwright.<id>/{types,dev/types}/**/*.ts` pair to the **tracked** `tsconfig.json` (H18 reproduced; three pairs from Session D, including `fHT22d`, which Session B noticed). **Not reverted**, per plan §9; Session E/F decide. The first run's wrapper was killed by the task cap before its cleanup trap ran; Session D stopped its own orphaned Playwright, `next dev` and Chrome processes and removed the leftover `.next-playwright.fHT22d` directory (the runner's trap would have deleted it). `prisma/dev.db` was not touched.

### Preliminary hypotheses — status after Session D

| H | Session D result |
|---|---|
| H5 | **Confirmed** (merged into BAK-003 with Session B; Session D added the non-JSON → "Request body must be valid JSON" symptom, the missing `error.tsx`/`global-error.tsx`, and `/`). |
| H6 | **Confirmed**: SSR always renders default settings, and the layout flips after hydration (REACT-001). **Disproved:** the extra overview/stale fetch with threshold 15 (the `today` gate prevents it), cross-request leakage through the server singleton, and hydration-mismatch warnings. |
| H7 | **Confirmed** (REACT-002): one PATCH per keystroke, stale-closure double toggle, drag persisting transient state, `alert` vs toast. A 409 does throw, and the message is also used for same-tab import races (source). |
| H12 | **Confirmed**: silent drop while `movingId` is set (REACT-004, source); double fetch per mutation, both completing (REACT-005, reproduced); shared `error` state and the delete-failure path (REACT-006, source). |
| H13 | Split. **Confirmed:** the Escape router closes Settings during a keyboard reorder (A11Y-003); the interview prompt mounts under the still-mounted Edit trap and ends with focus on `<body>` (REACT-003); `JobModal` duplicates the trap (UI-001). **Disproved:** the body-overflow restore order has no visible effect (`body { overflow: hidden }` globally); the Escape order for the dashboard's own dialogs works (dialog listeners register at mount before the shortcut listener is re-appended; `JobModal` uses capture). |
| H14 | **Confirmed**: nested interactive elements in a `role=button` card and missing keyboard drag on sidebar/archived rows (A11Y-001); the tablist is not an ARIA tabs widget (A11Y-002); the `h2 aria-label` over a button (A11Y-006); the toast live region is `aria-hidden` and `inert` until shown (A11Y-005, announcement Unverified). |

### Not issues (Session D), so the next audit does not repeat them
- `isMac` computed during render: Node ≥21 has `navigator.platform` (`MacIntel` on this host), and `isMac` is only rendered in dialogs that open after an interaction, so it is never in SSR output. No mismatch.
- `today` is `""` on the server: every consumer gates on it (`if (!today) return`), and the sidebar badge uses `today || currentLocalDate()` on the same machine. No mismatch.
- Stale closures in undo and shortcuts: the shortcut listener is re-subscribed every render, and `onUndo` / the toast button use the current render's `restoreLatestChange`.
- Optimistic rollback in `moveApplication` restores all four fields; a 409 loads the server copy.
- Kanban keyboard DnD: the coordinate getter follows the customised board order, the announcements use custom board labels, and Space picks up while Enter edits, which matches the instructions.
- Delete/Backspace shortcut: it fires only when the focused element *is* a board card, never while a dialog is open, and it opens a confirmation.
- Theme: dark tokens cover every colour token; the inline script prevents a theme flash; the `theme` value is enum-validated before it reaches `dangerouslySetInnerHTML`.
- The stale-row Archive button being hidden until hover is intentional, and it is revealed on `:focus-within` for keyboard users and outside the `(hover: hover) and (pointer: fine)` media query for touch.

### Handoffs answered for Session B
- How the UI surfaces server 500s (DATA-001), from source (Inferred): status moves and archive → the page `role=alert` banner "Something went wrong"; add/edit → the modal error; delete → the page banner (REACT-006); settings writes → `window.alert` or a toast (REACT-002); dashboard views → "… could not be loaded. Please try again later." with no retry (UI-003); import → the toast "Import failed: Something went wrong".
- Client import UX at runtime (the duplicate prompt then "Cancel import", closing Settings mid-import, a worker error): **Unverified**. `duplicate-import-focus.spec.ts` was in the aborted combined run and failed without recorded details.

### Unverified after Session D
- Why the 21 targeted existing specs failed in the aborted combined run (environment vs real). Session F should rerun them alone.
- The exact focus sequence behind REACT-003 (the symptom is confirmed).
- A11Y-005 screen-reader announcement behaviour; any AT-based check (no axe or screen reader available; `@axe-core/playwright` is recommended, not installed).
- UI-002 narrow-viewport overlay behaviour, and the UI-003 analytics placeholder layout shift (not exercised).
- REACT-004 and REACT-006 races (source only; they need a delayed or failing `page.route` to reproduce).
- A11Y-004 separator and drag-collapse paths (only the shortcut path was reproduced).

---

## Session B — Phases 2, 3 and 10 (persistence, backup/restore, security)

HEAD `5f74723`, tree clean before and after. No application code changed. Every behavioural check ran against isolated temporary SQLite databases through `scripts/run-backup-api-test.sh`, using temporary probe scripts in the session scratchpad (`probe.mjs`, `probe2.mjs`; not added to the repo). `prisma/dev.db` was never opened. The harness copies `prisma/` into `/private/tmp` (a known P11 hygiene item). The fingerprint was unchanged after all runs: size 53248, mtime 2026-09-27T11:46:19, sha256 `416ef643…c944c`.

### Checks run (Session B)

| Check | Command | Result |
|---|---|---|
| Probe, P2/P3/P10 scenarios (26 probes) | `PROBE_OUT=… bash scripts/run-backup-api-test.sh <scratchpad>/probe.mjs` | Completed, exit 0 (observations below) |
| Contention follow-up (exits 1 on purpose so the harness prints `server.log`) | `bash scripts/run-backup-api-test.sh <scratchpad>/probe2.mjs` | Exit 1 as designed; server errors captured |
| Backup API suite (R1–R3) | `npm run test:backup` | **Pass** |
| Smoke suite (R4) | `npm run test:smoke` | **Pass** — "no-login routing, CRUD, all status moves, SQLite persistence, event history, validation, and cascade deletion" |
| Settings store (carried-over fix) | `node --test scripts/settings-store-test.mjs` | **Pass** (1/1) |
| Dependency advisories (read-only) | `npm audit --json` | **0** vulnerabilities (info/low/moderate/high/critical all 0) |

Not run, by scope: Playwright, `next build`, and the dashboard API suite (Session C ran it). All probes ran against `next dev --webpack` (the harness). Behaviour under `next start` is **Inferred** to be the same, since it uses the same route code and no Host validation exists anywhere.

### Previous-audit regressions (R1–R4): all held

| # | Result | Evidence |
|---|---|---|
| R1 strict boards | **Held** | `npm run test:backup` passes: partial, duplicate, bad-color, blank-label, overlong and extra-field boards → 400; custom boards round-trip through PATCH and import. |
| R2 status vs complete history | **Held** | `test:backup`: `status: OFFER` against the history `null→APPLIED` → 400 `applications[0].status`; incomplete legacy history → 201. *New edge case in the same validator: BAK-001.* |
| R3 atomic import (applications + settings) | **Held** | `test:backup` trigger-forced settings failure → 500, application count unchanged, settings unchanged. Probe: an event-ID conflict (409) and the modified-record conflict (409) created nothing, including the valid new record in the same file (`freshCreated: false`, `newRecordCreated: false`). Three concurrent imports of the same 200 new records → 201/201/201 with created 200/0/0, skipped 0/200/200, rows 200 (no duplicates, no 500). |
| R4 smoke routing | **Held** | `npm run test:smoke` passes end to end. |
| Carried-over: queued board edits | **Held** | `settings-store-test.mjs` passes. |

### P2 checklist
- [x] Schema constraints and indexes (no index on `archived`; `UndoSnapshot` has no FK, which is harmless as shown below; `lastUpdated @updatedAt` is bumped by archive toggles and by same-status PATCHes, and feeds BAK-002)
- [x] Each mutation route: origin, content type, size, Zod strictness, revision, events, error codes (SEC matrix; DATA-002)
- [x] Undo snapshot lifecycle (TTL ≈ 10 min; the payload includes events and revision; a restore with another application's token → 404; a second restore → 404; revision and `lastUpdated` preserved; the plain DELETE leaves no snapshot; events cascade on delete)
- [x] Purge scope (applications, events and snapshots deleted; settings kept; body must be exactly `{}`)
- [x] Cleanup side effects on GET: they cause failures under contention (DATA-001)
- [x] P2034 retry: it never fires in practice; SQLite contention surfaces as a socket timeout (DATA-001)
- [x] 409 payload shape: `{ error, application }` with the current record; a revision far above the current value → 409, a negative one → 400

### P3 checklist
- [x] Round-trip equality: export → purge → import → export gives **byte-identical** JSON (9 applications, 6,249 bytes, including archived, interview date, unicode/emoji, a multi-line note, custom settings)
- [x] Malformed and incompatible files: `null`, a string, a number, an empty body, a top-level array, `applications` given as an object, `version: "1"` or `2`, missing or `{}` settings, an extra top-level key, a wrong status enum, a wrong event type, invalid UTF-8 → all 400 with no writes. A UTF-8 BOM is accepted (201; harmless).
- [x] Prototype keys: `__proto__` at top level, in `settings`, in an application and in an event, plus `constructor` in an application → 400 "Unrecognized field". `JSON.parse` creates own properties; the strict Zod objects reject them. In a settings PATCH, `changes.__proto__` → 400. In POST create, `__proto__` is stripped (201; DATA-002, not pollution)
- [x] Date offsets (ARCH-001; Session C for the views)
- [x] URL protocol (ARCH-001)
- [x] Duplicate IDs: application IDs within the file → 400; event IDs across records → 400; an event ID owned by an existing application → 409 with nothing written; an application ID equal to an existing event ID → 201 (separate tables, fine)
- [x] Identical vs modified existing records (BAK-002)
- [x] 5,000-record timing (H4, below)
- [x] 10 MB boundary: a body of exactly 10,485,760 bytes → 201; one byte more (with Content-Length) → 413; a chunked 11 MB body → **400** instead of 413 (SEC-002)
- [x] Settings replacement semantics (BAK-002)
- [x] Forced rollback (R3)
- [x] Client cancel, abandon and in-flight paths: **source-checked only (Inferred)**. `importInFlight` blocks a second import. "Cancel import" and "View existing" (`abandonImport`) send nothing. Delete All is disabled for the whole import (`importProgress` during validation, `hasPendingImport` during the loop and POST). Closing Settings does not stop the import, which runs in the dashboard hook and toasts its result. Runtime behaviour belongs to Session D/Playwright.
- [x] Worker failure: source-checked (Inferred). `worker.onerror` and a constructor throw both resolve to a user-facing message and reset `importInFlight`.
- [x] The four previous fixes still hold

**H4 scale (Confirmed, dev server):** 5,000 records × 3 events with 300-character notes (6.6 MB) → 201 in **13.1 s**. 5,000 records × 7 events (9.6 MB, the most events that fit under 10 MB) → 201 in **18.5 s**, with 35,000 event rows. A separate run of 5,000 × 1 → 11.8 s. All are well inside the 60 s transaction timeout, so the H4 **timeout risk is disproved at the 5,000 limit**. The real cost is that the import holds SQLite's write lock for its whole duration (DATA-001). The 201 response echoes every created record (3.6 MB for 5,000).

### P10 checklist
- [x] Host and DNS-rebinding reproduction (SEC-001)
- [x] CSRF on all mutations: all 8 mutation handlers call `checkMutationRequest` first (8/8 by grep). The matrix covers POST/PUT/PATCH/DELETE on applications, restore, purge, import and the settings PATCH, each with no Origin, `Origin: null`, a foreign Origin, a foreign Origin plus `X-Forwarded-Host`, and a `localhost` vs `127.0.0.1` mismatch: **all 403**. `text/plain` and `application/x-www-form-urlencoded` with the correct Origin → **415**, so no form-POST CSRF is possible. The target record was unchanged afterwards and the settings row was never created.
- [x] XSS and `href` sinks: none exploitable (see "Not issues")
- [x] Theme script injection path: none (see "Not issues")
- [x] Prototype pollution: none (P3 above)
- [x] Rate-limit side effects (SEC-002)
- [x] Error leakage: 500 responses are always `{"error":"Something went wrong"}`, and the server logs only `error.message`. No stack, SQL or path appears in any response. One mis-mapping: server-side ZodErrors are reported as a client 400 (BAK-003).
- [x] `npm audit` (read-only): 0 advisories
- [x] Destructive safeguards: purge requires Origin, JSON content type and exactly `{}` (`{"a":1}`, no body and an array are all rejected), and the UI uses an `alertdialog` confirmation with Escape and backdrop disabled while deleting. The Delete All button is disabled during import, undo, save, delete, move and the interview-date save (`application-dashboard.tsx:900`, `settings-modal.tsx:65,203`). Purge clears pending undo snapshots on the server and `clearApplicationUndo()` clears them on the client. The only purge bypass is SEC-001.

### Findings (Session B)

### SEC-001 — No Host validation: a DNS-rebinding page can read all data, change settings and purge everything
Severity: **High**   Category: security/local-threat-model   Status: **Confirmed** on the dev server (Session B) **and on `next start`** (Session F production build, temp DB; see the Session F section)
Hypothesis ref: H15   Phase: P10   Session: B
Files: `src/lib/mutation-request.ts:70-80`, `src/proxy.ts:7-23` (no Host check; matcher `/api/:path*` only), every GET route (`applications/route.ts:10`, `applications/export/route.ts:6`, `settings/route.ts:13`, `dashboard/*`), server-rendered pages (`components/application-page.tsx:5-23` embeds every application)
Evidence (probe "P10 H15 DNS rebinding", with `Host: evil.test:<port>` and `Origin: http://evil.test:<port>`, exactly what a rebound page sends):
- `GET /api/applications/export` → **200**, 224 applications, response contains the canary record.
- `GET /dashboard` → **200** (the server-rendered page embeds all applications).
- `PATCH /api/settings` → **200** (settings changed).
- `DELETE /api/applications/purge` with body `{}` → **200**; application count **224 → 0**, canary deleted.
- `isMatchingOrigin` compares the Origin only with the request's own `Host`, so when both are attacker-controlled the check always passes. Nothing anywhere compares Host with an allowlist.
Impact: any website the user visits while Nook runs can, after rebinding its hostname to 127.0.0.1, silently exfiltrate the complete job-search history and delete it irrecoverably (purge also removes undo snapshots). The attacker must guess the port; the default is `3000`.
Realistic: yes. DNS rebinding against localhost dev servers is a well-documented, practical technique, and binding to `127.0.0.1` does not prevent it. The absence of auth makes it the one realistic remote attack.
Trigger/Repro: start the harness server, then send any request with `Host: evil.test:<port>` (plus the matching `Origin` for mutations) using `node:http` (fetch cannot override Host).
Recommended fix: in `src/proxy.ts`, reject any request whose `Host` is not `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`, and widen the matcher from `/api/:path*` to all routes so pages are covered too. Keep the Origin check as it is.
Regression test: add to `smoke-test.mjs` (using `node:http`): GET export, GET `/dashboard` and DELETE purge with `Host: evil.test:<port>` → 4xx, with data unchanged.
Related: SEC-002 (same proxy file).

### BAK-001 — States the app itself can produce fail the snapshot history validator, so the export cannot be re-imported and an undoable delete cannot be undone
Severity: **High** (data-loss path; rare trigger)   Category: backup/integrity   Status: **Confirmed**
Hypothesis ref: H10 (restore path), R2 (same validator)   Phase: P2/P3   Session: B
Files: `src/lib/backup-snapshot.ts:97-158` (history superRefine: "An initial status event must be first" `:109-111`, "Saved status must match…" `:155-157`), `src/lib/backup-snapshot.ts:159-161` (`applicationRestoreSnapshotSchema` reuses it), `src/app/api/applications/[id]/restore/route.ts:32`, `src/app/api/applications/[id]/route.ts:85-95` (the PATCH/PUT event uses `createdAt: new Date()` with no ordering guard)
Evidence (probe "future-dated history"):
1. Import a valid record whose only event is `null→APPLIED` at `2099-01-01T00:00:00Z` → **201**.
2. `PATCH {revision:0,status:"INTERVIEW"}` → **200**. This appends `APPLIED→INTERVIEW` with `createdAt = now`, which sorts *before* the initial event.
3. Export, then re-import either that record alone or the **entire export** → **400** "Unsupported or invalid Nook version 1 backup" (`applications[5].events[0].fromStatus: An initial status event must be first`; `applications[5].status: Saved status must match the final status in history`). One bad record makes the whole backup unrestorable.
4. `DELETE ?undoable=1` → 200 (the record is gone), then restore with the token → **400** with the same two issues. The record does not exist afterwards; the snapshot stays until its 10-minute expiry and is then cleaned up, so the **record is permanently lost**.
Impact: an "Undo" on delete fails with a validation error and the application and its history are lost. Nook's own export of the database cannot be imported (neither into a fresh DB nor back into itself).
Realistic: the trigger requires event timestamps that are out of order relative to the server clock: an imported backup with future-dated events (hand-edited, or exported on a machine whose clock ran ahead), or a local clock that moves backwards between two status changes (a manual change or an NTP correction after running fast). Rare, but the consequence is data loss, so it is rated High under the plan's rule. It is **not** reachable with normal clocks and app-only data.
Recommended fix (pick one; none needs a backup-version change):
(a) Restore must not reject what the server itself snapshotted: validate the undo payload with the field schema but without the history superRefine, or insert the stored rows directly.
(b) Make the write path unable to create an out-of-order history: create status events at `max(now, latestEventCreatedAt + 1 ms)`.
(c) Additionally reject imported events/`createdAt` later than the import time (a rejection, not a repair).
Regression test: `backup-api-test.mjs`. Import a future-dated history, PATCH status, then (1) the export re-imports into a purged DB and (2) an undoable delete restores 201.
Related: R2 (the validator is correct for the cases it was written for); CALC-001 (undo writes reverse events, the same event-creation path).

### DATA-001 — SQLite write contention surfaces as HTTP 500 after ~5 s; the P2034 retry never applies, and GET requests fail because they perform writes
Severity: **Medium**   Category: persistence/robustness   Status: **Confirmed**
Hypothesis ref: H16 (side effects on GET), H4 (lock-hold part)   Phase: P2/P3   Session: B
Files: `src/app/api/applications/[id]/route.ts:70-105` (retry only on `P2034`), `src/lib/undo-snapshots.ts:3-7` (a `deleteMany`, i.e. a write), called from `applications/route.ts:12` (GET list), `components/application-page.tsx:6` (**every page render**), `[id]/route.ts:119`, `restore/route.ts:17`; `import/route.ts:26-45` (one interactive transaction holds the write lock for the whole import); `src/lib/api.ts:28-29`
Evidence:
- 20 concurrent `PATCH {revision:0,status}` on one record → **1×200, 3×409, 16×500**. Server log: `API request failed Socket timeout (the database failed to respond to a query within the configured timeout…)`, plus one `Transaction already closed … timeout for this transaction was 5000 ms, however 20720 ms passed`. The 500s arrive in waves at 5.3, 10.4, 15.6 and 20.8 s, and the single successful request took **22 s**. Data stayed consistent: revision 1, exactly 2 events. 10 concurrent PUTs → 1×200, 1×409, 8×500.
- During an 11.8–18.5 s import: `GET /api/applications` → **500**, `GET /dashboard` → **500** (`prisma.undoSnapshot.deleteMany()` socket timeout, from `application-page.tsx:6`), `PATCH /api/settings` → 500, `POST /api/applications` → 500, each after ~5.1 s. Pure reads (`GET /api/settings`, `GET /api/dashboard/overview`) → 200.
- Prisma reports SQLite lock waits as a socket timeout (P1008-class), not P2034, so the retry loop at `[id]/route.ts:101` never retries them.
Impact: while a backup import runs (seconds for a few hundred records, 12–19 s at 5,000), reloading or navigating to any page shows a server error, the sidebar and archive toggles fail with an alert, and a create returns "Something went wrong". Every write is retryable, but the user gets a generic 500 with no retry. The 20-way concurrency is synthetic; one UI action plus an import is realistic.
Recommended fix: make `cleanupExpiredUndoSnapshots` best-effort (catch and ignore lock timeouts) and move it out of page render and GET handlers (e.g. run it only in the undoable DELETE and restore handlers). Map SQLite lock and socket timeouts to a 503 with a "try again" message, or retry them like P2034. Shorten the import's lock: build the rows first, then use `createMany` for applications and events in the same transaction. Optionally raise the SQLite busy timeout in `DATABASE_URL` (`?socket_timeout=`/`connection_limit=1`), and verify that against Prisma 6.12 before relying on it.
Regression test: an API test that runs an import of about 2,000 records while issuing a GET `/api/applications` and a page GET → both 200. Concurrent same-revision PATCHes → only 200/409, never 500.
Related: ARCH-004 (every page renders through `ApplicationPage`); Session D for the UI error surface (`window.alert`, ARCH-003).

### BAK-002 — Import conflict and settings semantics are all-or-nothing and undocumented: settings are always replaced, and any later edit (even archive then unarchive) makes the whole file conflict
Severity: **Low**   Category: backup/semantics   Status: **Confirmed**
Hypothesis ref: H3   Phase: P3   Session: B
Files: `src/app/api/applications/import/route.ts:29-33,39-43,46`, `src/lib/backup-snapshot.ts:167-187` (`canonicalSnapshot` compares every field including `lastUpdated`), `prisma/schema.prisma:21` (`@updatedAt`), `src/hooks/use-application-backup.ts:103-105`, `README.md:19,69`
Evidence:
- Importing a file whose only record already exists identically → 201, `createdIds: []`, `skippedIds: 1`. Settings still changed from `system/dashboard` (revision 7) to `light/interviews` (revision **8**).
- After an archive plus unarchive of that record, which leaves no visible difference but bumps `lastUpdated`, re-importing the earlier export together with a genuinely new record → **409** `Conflicting IDs: cmukntqx0…`; the new record was **not** created.
- The client shows only the raw message: a toast reading "Import failed: Conflicting IDs: <cuid>". The UI never tells the user which application conflicts, or that restoring an older backup over current data is unsupported.
- The README says only "Export your data and import a Nook backup" and does not mention that import replaces settings or never updates existing records.
Impact: restoring yesterday's backup into a database where anything has since changed does nothing, and the error is not actionable. A merge-style import silently overwrites current preferences. No data loss (atomic, and nothing is overwritten).
Realistic: yes; this is the normal "restore an older backup" workflow.
Recommended fix: a product decision, not a code defect. At minimum, name the conflicting records (company/role) in the error, and document both rules in the README (P13, Session E). Options: exclude `lastUpdated` (and archive-only changes) from the conflict comparison; apply settings only when at least one record is created, or let the user choose.
Regression test: already pinned by `backup-api-test.mjs` (identical → skipped; modified → 409). Add an assertion on the error content if the message changes.
Session E (P13): the documentation half is recorded as DOC-001. The README says nothing about settings replacement, skip/conflict rules or limits.

### BAK-003 — An invalid stored Settings row blocks export and settings changes and 500s every page; server-side ZodErrors are reported as client "400 Invalid request data"
Severity: **Low**   Category: robustness/error-mapping   Status: **Confirmed**
Hypothesis ref: H5   Phase: P3   Session: B
Files: `src/lib/database-settings.ts:5-8`, `src/app/api/applications/export/route.ts:8-11`, `src/app/api/settings/route.ts:26-27`, `src/app/layout.tsx:34-35`, `src/lib/api.ts:20-22`
Evidence (probe "corrupt Settings row"; set `Settings.value = '{"theme":"neon"}'` in the temporary DB):
- `GET /api/settings` → **400** "Invalid request data" with six issues about the *stored* value.
- `GET /api/applications/export` → **400** (the application export is blocked by settings).
- `PATCH /api/settings` → **400**, so settings cannot be repaired through the UI.
- `GET /dashboard` → **500** (the root layout awaits `readSettings()`); `GET /api/applications` → 200.
- `POST /api/applications/import` with a valid backup → **201** and repairs the row (the upsert never reads the old value). Import is the only recovery, but the user cannot export a backup to import.
Impact: the user cannot open the app or back up their applications until the row is fixed by hand. The 400 wording blames the request.
Realistic: low. The row is only written through validated paths, so this needs manual DB edits, a partial write, or a future schema tightening. It is the single point of failure for every page.
Recommended fix: have the export read applications independently of settings (or fall back to defaults and say so); in `readSettings`, log and fall back to defaults instead of throwing, so layout and PATCH can overwrite it. In `apiError`, map only request-derived ZodErrors to 400 and return 500 for server-side validation.
Regression test: `backup-api-test.mjs`. Corrupt the row through Prisma; export → 200 with the applications; PATCH settings → 200 and repairs the row.
Related: Session D owns the layout/hydration part of H5/H6.
Session D symptoms (independent d-probe through `run-backup-api-test.sh`; REACT-007 merged here):
- **Non-JSON** row (`{not json`): `GET /`, `/dashboard`, `/jobs` → 500 (Next's `__next_error__` page); `GET /api/settings`, `GET /api/applications/export` and `PATCH /api/settings` → **400 "Request body must be valid JSON"** (`apiError` maps the server-side `SyntaxError` from `JSON.parse(row.value)` to the request-body message). `GET /api/applications` → 200.
- **Schema-invalid** row (`theme: "blue"`): the same page 500s; the APIs return 400 "Invalid request data" with the `theme` issue.
- Recovery: `POST /api/applications/import` with an empty v1 backup → 201, settings revision 2, then `GET /dashboard` → 200.
- `src/app` has no `error.tsx` or `global-error.tsx`, so there is no in-app recovery page. `/` fails too, not only the dashboard routes.
- Severity: Session D had provisionally rated this Medium (total outage, no in-app recovery); Session B's Low is kept because the trigger needs a manual edit or a future schema change. Session F may revisit.

### DATA-002 — Mutation schemas are inconsistently strict: POST create and the PATCH status branch silently drop unknown keys
Severity: **Low**   Category: api-validation   Status: **Confirmed**
Hypothesis ref: H11   Phase: P2   Session: B
Files: `src/lib/application-schema.ts:61-70` (`applicationInputSchema` is not strict), `:78-84` (`applicationStatusSchema` is not strict), `:91-94`, `src/app/api/applications/[id]/route.ts:48-55`
Evidence: `PATCH {revision, status:"INTERVIEW", company:"Injected", notes:"x", foo:1}` → **200**, company unchanged. `POST {…, foo, revision:99, archived:true, id:"chosen-id", __proto__}` → **201**, with a generated ID, revision 0 and `archived: false`. By contrast PUT, the archive PATCH, the settings PATCH and import all return **400** "Unrecognized field". `{revision, status, archived:true}` takes the status branch and sets both (intended, `use` at `application-dashboard.tsx:471`).
Impact: none on data (keys are stripped, not applied). It hides client bugs, and the API contract differs between routes.
Recommended fix: `.strict()` on `applicationInputSchema` (POST) and `applicationStatusSchema`. Test that the dashboard never sends extra keys first (e.g. the `interviewDate` form field).
Regression test: `smoke-test.mjs`, an extra key on POST and on the status PATCH → 400.

### SEC-002 — `proxy.ts` side effects: a process-global 2,000 requests/min limit shared by everything, and Next truncates bodies over 10 MB before the route's own limit check
Severity: **Low**   Category: robustness   Status: **Confirmed**
Hypothesis ref: H16 (rate-limit part)   Phase: P10   Session: B
Files: `src/proxy.ts:3-19`, `src/lib/mutation-request.ts:26-51`
Evidence:
- A burst of 2,200 `GET /api/settings` → 1,994×200 and **206×429**. While limited, an import → **429** (`Retry-After: 19`); `/dashboard` → 200 (pages are not matched). There is one bucket for the whole process and it is not per client.
- A chunked 11 MB import body → **400** "Request body must be valid JSON", not 413. Server log: `Request body exceeded 10MB for /api/applications/import. Only the first 10MB will be available unless configured` (Next's `middlewareClientMaxBodySize`, triggered because a proxy exists). Requests with a Content-Length (every browser `fetch` with a string body) still get 413 (exactly 10 MB → 201; +1 byte → 413).
Impact: any local page (or a rebinding page, SEC-001) can lock the UI out of every API call for up to a minute. Oversized chunked uploads get a misleading error. Normal single-user use (UI plus tests) stays far below 2,000/min.
Recommended fix: keep or drop the limiter deliberately; if kept, raise the limit or scope it to mutations. Once the Host allowlist exists, the limiter adds little. Optionally set `middlewareClientMaxBodySize` just above 10 MB so the route's 413 is authoritative.
Regression test: none needed beyond SEC-001's; optionally a chunked >10 MB import in `backup-api-test.mjs` → 413.
**Session F note:** under `next start`, a DELETE whose small `{}` body is sent chunked (no Content-Length) returns 400 with an empty body, even for a same-origin request; with a Content-Length it succeeds. Browsers send a Content-Length, so this matters only for hand-written tests/probes.

### Not issues (Session B), so the next audit does not repeat them
- **XSS via `jobUrl`:** not exploitable. The single `href` sink (`kanban-board.tsx:110-116,141`) trims and accepts only `http:`/`https:` via `new URL`; the modal uses an `<input value>`. No other `jobUrl` rendering exists (grep).
- **Theme script injection:** `layout.tsx:35-39` interpolates `JSON.stringify(settings.theme)`. `readSettings` has already validated `theme` against `light|dark|system`, and an invalid row throws before the script is built (BAK-003). There is no path for an arbitrary string.
- **Prototype pollution:** none (P3 checklist).
- **CSRF:** complete coverage (P10 checklist).
- **Import transaction timeout (H4):** 18.5 s worst case at the limits vs the 60 s timeout; this assumes a dev server on this machine, and `next start` is faster.
- **Undo snapshot without FK / unguarded `JSON.parse` / `revision` default (rest of H10):** a cross-application token → 404; the payload is written only by the server, so `JSON.parse` sees only server JSON; the payload carries `revision`, so the Zod default is never used (restored revision 1 = the pre-delete value). The only real restore defect is BAK-001.
- **Same-status PATCH:** 200, revision +1, no event (correct). Archive toggles never change status or events (the lifecycle invariant holds).
- **Concurrent imports of the same records:** exactly one creates; the others skip (no P2002 500).
- **Error leakage:** none (P10 checklist).
- **Purging a record with ID `purge` through the UI delete:** 400; no purge (ARCH-001, IDs).

### Preliminary hypotheses — status after Session B

| H | Session B result |
|---|---|
| H1 | **Confirmed** (with Session C). New: an unchanged edit save persists the shifted date. ARCH-001. |
| H2 | **Confirmed** for storage, un-editability, untrimmed text and unbounded event text; the **XSS part is disproved** by the renderer guard. ARCH-001. |
| H3 | **Confirmed**: settings are replaced when every record is skipped; any change, even archive then unarchive, returns 409 for the whole file. Recorded as a Low semantics and docs issue (BAK-002). |
| H4 | **Timeout disproved** at 5,000 (13.1 s / 18.5 s vs 60 s). **Lock-hold consequence confirmed** (DATA-001). |
| H5 | **Confirmed** server-side (BAK-003): export and settings APIs blocked, page 500, import the only recovery. The client hydration part stays with Session D. |
| H10 | Remaining parts **not issues** (see above). New restore defect **Confirmed**: BAK-001. |
| H11 | **Confirmed**, Low (DATA-002). Union branching works correctly for mixed payloads. |
| H15 | **Confirmed**, High (SEC-001): read, settings write and full purge through rebinding. |
| H16 | **Confirmed**: GET/page cleanup writes fail under lock (DATA-001); the global limiter can 429 legitimate calls (SEC-002). |

### Unverified / handed off (Session B)
- Behaviour under `next start` for SEC-001 and DATA-001 (only the dev server was exercised). Inferred to be identical; confirm during the Session F build.
- Client import UX at runtime: the duplicate prompt, then "Cancel import", closing Settings mid-import, and a worker error. Source-checked only; Playwright belongs to Session D.
- How the UI surfaces DATA-001's 500s (alert vs toast vs page error): Session D.
- Whether a SQLite busy-timeout URL parameter fixes DATA-001 with Prisma 6.12: not tried (it would be a fix).
- **Tree drift observed at the end of Session B (not caused by it):** `git status` shows ` M tsconfig.json`, which adds `.next-playwright.fHT22d/{types,dev/types}/**/*.ts`, and the directory `.next-playwright.fHT22d` exists. This comes from a concurrent Playwright run, likely Session D (`run-playwright.sh`, H18). Session B's harness runs build inside `/private/tmp/nook-backup-api.*` copies and cannot write the project's `tsconfig.json`. Left as-is for Session E/F; not reverted.

---

## Session E — Phases 9, 11, 12 and 13 (performance, tests, dead code/dependencies/configuration, documentation)

HEAD `5f74723`. No application code, tests, scripts, configuration or README were changed. The only tracked-file drift is the pre-existing ` M tsconfig.json` (H18, see TEST-002), which was left untouched. Before starting I read the results of Sessions A–D; symptoms that belong to an existing root cause were appended to that entry (TEST-001, REACT-005, ARCH-002, ARCH-004, BAK-002) rather than opened again.

Isolation: the performance probe ran only through `scripts/run-backup-api-test.sh` on a temporary DB (`/private/tmp/nook-backup-api.*`). The isolated build ran in `/private/tmp/nook-e-build.*` and copied only `prisma/schema.prisma`. Scratch files live in the session scratchpad (`e-perf.mjs`, `e-build.sh`, logs) and are for Session F to delete per plan §9. `prisma/dev.db` was never opened or queried; fingerprint afterwards: 53248 B, mtime 2026-09-27T11:46:19, sha256 `416ef643f19b632e…` (unchanged).

### Checks run (Session E)

| Check | Command | Result |
|---|---|---|
| Shortcut unit tests | `npm run test:shortcuts` | **Pass** 4/4 |
| Duplicate matcher | `npm run test:duplicates` | **Pass** |
| Unwired unit tests | `node --test scripts/interviews-grouping-test.mjs scripts/motion-preference-test.mjs scripts/settings-store-test.mjs` | **Pass** 8/8 |
| Import duplicate-index scale | `node scripts/import-scale-test.mjs` | **Pass**: `{"records":5000,"batchSize":10,"elapsedMs":6650,"longestBatchMs":28}` |
| Setup script | `npm run test:setup` | **Pass** 4/4 (includes a real `db push` into a temp dir and a second run that preserves one record; unchanged schema only) |
| P9 endpoint timings at 500 and 5,000 records | `PERF_OUT=… bash scripts/run-backup-api-test.sh <scratchpad>/e-perf.mjs` | All endpoint measurements completed (tables in PERF-001/002). The script then exited 1 in its **own** trailing micro-benchmark (`list.filter is not a function`, because `GET /api/applications` returns `{ applications }`). That was a probe bug, not an app failure, and the client-render micro-benchmark was therefore **not** measured |
| Isolated production build (bundle sizes) | `bash <scratchpad>/e-build.sh` (`next build` in a temp copy with symlinked `node_modules`) | **Did not run to completion**: Turbopack panicked with `Symlink [project]/node_modules is invalid, it points out of the filesystem root` (a harness limitation, not an app defect). The `--webpack` fallback in the script did not trigger. The bundle report stays **Unverified**; it is Session F's `npm run build` step |

Not run (by instruction): Playwright, `npm run build` in the project, typecheck/lint re-runs (the Session A baseline is green, and Session F re-runs them), manual UI.

### P9 — Performance

Method: seeded 500, then 5,000 applications. Each has 1–2 status events and a 300-character note; 20% are archived, 1 in 7 has an interview date, and applied dates are spread over 730 days. The DB was written with Prisma `createMany`. Each endpoint got one warm-up request and then 9 sequential requests; the table shows p50 and max. **All numbers are from `next dev --webpack`** (the harness). Production (`next start`) is expected to be faster; that is Inferred, not measured.

| Endpoint | n=500 p50 / bytes | n=5,000 p50 (max) / bytes |
|---|---|---|
| `GET /api/applications` | 40 ms / 333 KB | 170 ms (188) / 3.34 MB |
| `GET /api/dashboard/overview` | 61 ms / 1.2 KB | **513 ms** (531) / 1.5 KB |
| `GET /api/dashboard/stale` | 44 ms / 70 KB | 366 ms (436) / **681 KB** |
| `GET /api/dashboard/analytics` CURRENT_MONTH | 10 ms | 17 ms |
| `GET /api/dashboard/analytics` CURRENT_YEAR | 12 ms | 99 ms |
| `GET /api/dashboard/analytics` CUSTOM_YEAR 2025 | 28 ms | 140 ms |
| `GET /api/applications/export` | 47 ms / 492 KB | 390 ms / 4.93 MB |
| `GET /jobs` (SSR HTML) | 267 ms / **1.33 MB** | **3,070 ms (4,100) / 13.1 MB** |
| `GET /dashboard` (SSR HTML) | 58 ms / 382 KB | 303 ms (464) / 3.61 MB |
| `GET /interviews` (SSR HTML) | 58 ms / 378 KB | 362 ms (462) / 3.62 MB |

### PERF-001 — Every page server-renders and ships the full application list (all columns, including notes); `/jobs` also server-renders every card
Severity: Low (realistic ≤500 records: 267 ms / 1.3 MB). It becomes a noticeable delay at the 5,000-record import limit.   Category: performance/payload   Status: **Confirmed** (measured, dev server); production numbers Unverified
Hypothesis ref: H22 (performance part)   Phase: P9   Session: E
Files: `src/components/application-page.tsx:5-22` (unbounded `findMany` with no `select`, so `notes` ≤5,000 chars, `jobUrl`, `source` and every other column go to the client), all five page routes, `src/components/application-dashboard.tsx` (one client shell), `src/components/kanban-board.tsx:61-64`
Evidence: the table above. `/dashboard` and `/interviews` weigh about the same as `GET /api/applications` (3.6 MB vs 3.3 MB at n=5,000), which shows that the RSC payload carrying `initialApplications` dominates. `/jobs` is 3.6× larger (13.1 MB) because it also renders the markup for all board cards. Growth is linear: 10× the records gives about 10× the bytes and time. Each navigation between pages repeats the full load because every route is a separate `force-dynamic` render of the same shell (ARCH-004).
Impact: at 5,000 records each visit to `/jobs` costs about 3 s of server time and 13 MB in dev. At realistic personal volumes (tens to a few hundred) the cost is sub-second and not user-visible. Worst case (theoretical): 5,000 × 5,000-character notes would add about 25 MB per page.
Recommended fix: select only the columns the shell needs (notes and jobUrl could load with the edit modal), and share one client shell across routes (a layout-level client component) so navigation does not refetch. Optionally page or virtualise the board.
Regression test: a probe like `e-perf.mjs` asserting byte and time budgets per page at n=500.
Related: ARCH-004 (structural cause), DATA-001 (every page render also performs the undo-snapshot cleanup write).

### PERF-002 — Dashboard endpoints analyse every history several times per request, and the stale response serialises every item twice
Severity: Low   Category: performance/server   Status: **Confirmed** (timings and payload); the split of cost between DB, CPU and serialisation is Inferred
Hypothesis ref: plan P9 "repeated history analysis", "unbounded loadApplications", "`trend.buckets.find`"   Phase: P9   Session: E
Files: `src/lib/dashboard-analytics.ts:75-99` (`coverageFor` and `rateFor` each call `analyzeStatusHistory` for every application, and `rateFor` also calls `coverageFor`, so each rate costs 2N analyses), `:215-251` (overview: 2 rates = 4N, plus `staleApplications` N, plus `staleTimingCoverage` N ≈ **6N** analyses over an unbounded `loadApplications()`), `:265-302` (analytics: 3 rates = 6N, and `coverageFor` is computed three times with identical results), `:189-210` + `:254-262` (stale returns `applicationsBySeverity` **and** `applications` **and** `top`), `src/components/dashboard-stale-applications.tsx:120` (the client reads only `applicationsBySeverity`)
Evidence: overview 61 → 513 ms from n=500 to n=5,000, while analytics over a similar cohort (CUSTOM_YEAR, about 2,500 records) takes 140 ms and CURRENT_MONTH 17 ms. Stale returns 681 KB at n=5,000 because each stale item appears in both `applicationsBySeverity[...]` and `applications`. The `trend.buckets.find` inside the loop (`:285-287`) runs over at most 6 weekly buckets, so it is **theoretical/negligible**.
Impact: sub-second everywhere, even at the limit; it compounds with REACT-005's double fetch. Not user-visible at realistic volumes.
Recommended fix: analyse each application once per request (map id → `analyzeStatusHistory` result) and compute coverage once; drop the unused `applications`/`top` from the stale response, or have the client use them instead of `applicationsBySeverity`. Check `dashboard-api-test.mjs` assertions before removing fields.
Regression test: `dashboard-api-test.mjs` still passes (it pins the semantics), plus an optional payload-size assertion.
Related: REACT-005, PERF-001.

### PERF-003 — Client render cost: every dashboard render refilters and resorts the full list, and the Kanban FLIP effect measures every card
Severity: Low   Category: performance/client   Status: **Inferred** (source-supported; not measured, because browser profiling was not requested)
Hypothesis ref: H22, Session D hand-offs   Phase: P9   Session: E
Files: `src/components/application-dashboard.tsx:612-623` (0 `useMemo`: `sidebarItems` 3 filters + sort, `archivedItems`, `getInterviewListItems`, `getUpcomingInterviewCount`, a linear `find`), `src/components/kanban-board.tsx:27-57` (`getBoundingClientRect` on every card in both cleanup and effect for each `applications`/`boards` change), `:61-64` (one full-list filter per board), `src/components/motion-presence.tsx:14`, `src/hooks/use-dashboard-shortcuts.ts:65-162`
Classification of Session D's hand-offs:
- **Source-supported, likely inefficient:** the FLIP measurement. Two layout reads per card per change, forcing layout; at 5,000 server-rendered cards (PERF-001) this is the only client item likely to be felt. It also re-runs on the settings refreshes from REACT-002.
- **Source-supported but cheap:** the filters and sorts. O(n log n) over plain objects is about low milliseconds at 5,000 (estimate; the probe's micro-benchmark did not run).
- **Theoretical:** `MotionPresence` adding one extra render per open dialog, and re-adding the shortcut listener every render (its real cost is the ordering bug A11Y-003, not performance).
Recommended fix: memoise the derived lists on `[applications, search, filter, today]`; limit the FLIP measurement to cards whose status changed (or skip it when motion is off). Do these only after PERF-001, which dominates.
Regression test: none automated (a profiling task, if ever needed).
Related: ARCH-004, REACT-002, A11Y-003.

**Other P9 checklist items:**
- *Double fetches*: REACT-005 (costed above).
- *Settings PATCH volume*: REACT-002 (9 PATCHes for 9 characters, measured by Session D); no new entry.
- *Bundle report*: **Unverified** (isolated build failed; see checks).
- *Import loop `setState` every 10 records*: `import-scale-test` longest 10-record batch is 28 ms at 5,000, so it is not a problem.

### P9 checklist
- [x] Seeded 5,000-record endpoint timings (dev server)
- [x] Double fetches (REACT-005, costed)
- [x] Repeated history analysis (PERF-002)
- [x] Render cost of the dashboard shell (PERF-003, Inferred)
- [ ] Bundle report from the build (**Unverified**, handed to Session F)
- [x] Settings PATCH volume (REACT-002)

### P11 — Test suite audit

**Inventory (13 files in `scripts/`, 23 specs with 49 tests plus `api-helpers.ts` in `tests/e2e/`)**

| File | Kind | Wired in `package.json` | Result this session |
|---|---|---|---|
| `scripts/keyboard-shortcuts-test.mjs` | unit (node:test, ESM transpile) | `test:shortcuts` | Pass |
| `scripts/duplicate-match-test.mjs` | unit (plain asserts) | `test:duplicates` | Pass |
| `scripts/setup-test.mjs` | unit + one real `db push` | `test:setup` | Pass |
| `scripts/interviews-grouping-test.mjs` | unit (CJS transpile + hand-mocked `require`) | **no** | Pass |
| `scripts/motion-preference-test.mjs` | unit (CJS + hand-mocked `require`) | **no** | Pass |
| `scripts/settings-store-test.mjs` | unit (CJS + mocked `react`) | **no** | Pass (also Session B) |
| `scripts/import-scale-test.mjs` | timing check | **no** | Pass |
| `scripts/backup-api-test.mjs` | API (temp DB and server) | `test:backup` (default arg) | Pass (Session B) |
| `scripts/smoke-test.mjs` | API | `test:smoke` | Pass (Session B) |
| `scripts/dashboard-api-test.mjs` | API | **no** (`bash scripts/run-backup-api-test.sh scripts/dashboard-api-test.mjs`) | Pass (Session C) |
| `scripts/run-backup-api-test.sh` | runner | via test:backup/test:smoke | — |
| `scripts/run-playwright.sh` | runner | `test:keyboard` (runs **all** 23 specs) | — |
| `scripts/setup.mjs` | production script | `setup` | — |
| `tests/e2e/*.spec.ts` (23) | Playwright, Chrome channel, 1 worker | `test:keyboard` | Not run (Session F) |

**Coverage matrix (critical paths → covering test; "—" means none)**

| Path / finding | Unit | API | E2E |
|---|---|---|---|
| Create/edit/status/archive/delete lifecycle, events | — | smoke, dashboard | keyboard, interview-date, sidebar-* |
| Revision conflict 409 | — | backup | application-revision |
| Origin/content-type/size checks (CSRF) | — | smoke | origin-protection |
| **Host allowlist / DNS rebinding (SEC-001, High)** | — | **—** | — |
| Backup round trip, strict boards, atomicity (R1–R3) | — | backup | backup-recovery, backup-import-limits, import-overlap |
| **Restore of an out-of-order history (BAK-001, High)** | — | **—** | — |
| Import offset/non-midnight dates, `jobUrl` protocol, text trim, IDs (ARCH-001) | — | **—** | — |
| Undo recorded as a reverse event, rates/stale impact (CALC-001) | — | — (the "ever reached" semantics are pinned for real moves) | deletion-recovery (delete undo only) |
| SQLite contention → 500 (DATA-001) | — | — | — |
| Corrupt settings row (BAK-003) | — | — | — |
| Unknown-key strictness (DATA-002) | — | — | — |
| Rate limiter / chunked 413 (SEC-002) | — | — | — |
| Analytics periods, week buckets, stale cutoffs, timezone | — | dashboard | analytics-heading |
| Year 9999 analytics (DATE-001) | — | — | — |
| Midnight rollover (DATE-002) | — | — | — |
| Interview grouping | interviews-grouping | — | interviews (**broken**, TEST-001) |
| Duplicate detection | duplicate-match, import-scale | — | duplicate-import-focus |
| Shortcuts matcher | keyboard-shortcuts | — | keyboard, shortcut-scope, shortcut-panel-sections |
| Settings store queueing | settings-store | backup (settings PATCH/import) | settings-zoom, sidebar-interactions |
| Settings hydration flash, PATCH-per-keystroke (REACT-001/002) | — | — | — |
| Interview prompt focus from the Edit modal (REACT-003) | — | — | — (interview-date covers other paths) |
| Escape during keyboard reorder (A11Y-003), collapse focus loss (A11Y-004) | — | — | — |
| `backup-snapshot` history validator (`possibleTrailEnds`) direct cases | **—** | indirect (backup) | — |
| `status-history`, `analytics-period`, `calendar-date` direct edge cases | **—** (only `addCalendarDays`/`startOfCalendarWeek` in interviews-grouping) | indirect (dashboard) | — |
| Setup on a *changed* schema (H17) | — | — | — |

### TEST-002 — H18: each Playwright run appends a new `.next-playwright.<random>` include pair to the tracked `tsconfig.json`
Severity: Low   Category: test-infra/config-drift   Status: **Confirmed** (mechanism verified in Next's source; drift observed growing 6 → 9 pairs)
Hypothesis ref: H18   Phase: P11/P12   Session: E
Files: `scripts/run-playwright.sh:5,10` (`mktemp -d "$project_root/.next-playwright.XXXXXX"`, a new random in-project `distDir` per run), `next.config.ts:5` (`distDir: process.env.PLAYWRIGHT_NEXT_DIST_DIR ?? ".next"`), `node_modules/next/dist/lib/typescript/writeConfigurationDefaults.js:286,302-316` (for App Router projects, any of `getTypeDefinitionGlobPatterns(distDir)` missing from `include` is **pushed and written back**), `node_modules/next/dist/lib/typescript/type-paths.js:29-40` (`${distDir}/types/**/*.ts` and `${distDir}/dev/types/**/*.ts`), `tsconfig.json:30-53`, `eslint.config.mjs:8`
Evidence: the tracked file at HEAD has 6 pairs (`0tzClf`, `GfHVd7`, `vw7hav`, `HsWEek`, `70jFid`, `6livTq`), all committed in earlier commits (`git log -S'.next-playwright' -- tsconfig.json` → `f6318b5`, `2d2242a`). The working tree now has 9 (`fHT22d`, `0cmjv2`, `uE5OAm` added by Session D's three runs; `git diff --stat`: 7 insertions, 1 deletion). The directories themselves are removed by the runner's `trap cleanup EXIT`, and none exist now. `run-backup-api-test.sh` is **not** a cause: it copies `tsconfig.json` into `/private/tmp` and mutates only the copy.
Category of cause: **tooling side effect by design** (Next keeps tsconfig in sync with `distDir`), combined with a runner choice (a random `distDir` inside the project). Not an app defect.
Secondary effects (Inferred): (1) if a run is killed before its trap runs (as happened in Session D), the leftover directory matches the committed include globs, so `npm run typecheck` would type-check generated route types, and `eslint .` would lint it because `globalIgnores` covers only `.next/**` (ESLint 9 flat config does not skip dot-directories). (2) Every run produces a tracked diff that invites accidental commits.
Recommended fix (not applied): use one fixed ignored `distDir` (e.g. `.next-playwright`) so the include pair is added once and stays stable, or point Next at a Playwright-only tsconfig (`typescript.tsconfigPath` in `next.config.ts` when `PLAYWRIGHT_NEXT_DIST_DIR` is set). Remove the 9 stale pairs once, with the user's approval, and add `.next-playwright*/**` to `globalIgnores`. A fixed name means two concurrent Playwright runs would clash; that is acceptable because the plan already serialises them.
Regression test: after `npm run test:keyboard`, `git diff --exit-code tsconfig.json` passes.
Related: plan §9 step 8 (Session F must report the drift, not revert it).

### TEST-003 — Five test files are not wired into `package.json`; there is no aggregate `test` script, and `test:keyboard` is a misnomer
Severity: Low   Category: tests/wiring   Status: **Confirmed**
Hypothesis ref: H21 (wiring part)   Phase: P11   Session: E
Files: `package.json:5-21`, `scripts/interviews-grouping-test.mjs`, `scripts/motion-preference-test.mjs`, `scripts/settings-store-test.mjs`, `scripts/import-scale-test.mjs`, `scripts/dashboard-api-test.mjs`, `AGENTS.md:23`
Evidence: no script runs those five files. They all pass today, so they are unwired rather than rotten. `dashboard-api-test.mjs` (566 lines, the only regression suite for Overview, Stale and Analytics) runs only when someone knows the raw `bash scripts/run-backup-api-test.sh scripts/dashboard-api-test.mjs` command, which appears in neither `package.json` nor AGENTS.md. `test:keyboard` runs the whole 23-spec e2e suite, not only keyboard tests. `test:backup` relies on the runner's default argument. There is no `npm test`. CI is not configured.
Impact: regressions in analytics, settings-store queueing (a previous-audit fix) and interview grouping go unnoticed unless someone knows the file names.
Recommended fix: add `test:unit` (`node --test` over the unit files), `test:dashboard`, and a `test` aggregate (unit + setup + the three API suites, excluding Playwright); consider renaming `test:keyboard` to `test:e2e` (keep an alias if it is referenced elsewhere), and list them in AGENTS.md.
Regression test: n/a.
Related: DOC-002.

### TEST-004 — The unit harness hand-transpiles modules and hand-mocks `require`; mocks silently answer unknown imports, and some assertions are implementation-coupled or obsolete
Severity: Low   Category: tests/brittleness   Status: **Confirmed** (source)
Hypothesis ref: H21 (harness part)   Phase: P11   Session: E
Files: `scripts/motion-preference-test.mjs:13-21,35-36`, `scripts/settings-store-test.mjs:9-13`, `scripts/interviews-grouping-test.mjs:9-19`, `scripts/import-scale-test.mjs:12-13`, `scripts/keyboard-shortcuts-test.mjs:20`, `tests/e2e/*.spec.ts` (about 20 CSS-class locators such as `.sidebar-panel`, `.app-workspace`, `.nook-toast`, `.sidebar-edge-rail`; 2 `waitForTimeout`), `tests/e2e/scrollbars.spec.ts:1-30` (writes through Prisma directly)
Evidence:
- `motion-preference-test.mjs:17-20`: the mock `require` returns `{ settingsSchema: … }` for **any** specifier it does not recognise, so a new import added to `general-preferences.ts` would get a fake module and no error. `settings-store-test.mjs` does the same with `{ defaultSettings }`.
- Imports are rewritten with string `replace` (`import-scale-test.mjs:13`), so a changed import path breaks silently or loudly depending on the fallback.
- `motion-preference-test.mjs:35` "database Motion choice drives effective motion when browser storage is unavailable" makes `localStorage` throw, a localStorage-era scenario. Motion no longer touches `localStorage` at all (only the sidebar width does), so the test still passes but its premise is obsolete.
- `keyboard-shortcuts-test.mjs:20` asserts `shortcutDefinitions.length === 21`, which fails on every added shortcut without indicating a regression.
- ARCH-003 (hooks and `window.alert` inside `src/lib`) is why the lib modules need a DOM or React mocks.
- E2E: selectors tied to CSS classes break on styling refactors; `workers: 1` plus shared-DB specs that clean up by `source` value (`scrollbars.spec.ts:16`) make order dependence possible (Inferred, not observed).
Classification: these are **bad-test risks**, not app defects. No test currently gives a false result, apart from TEST-001.
Recommended fix: have the mock `require` throw on unknown specifiers; replace the hand-rolled loader with Node's built-in TypeScript type stripping (Node 26 runs `.ts` directly), or a single shared loader with a real `@/` resolver; assert behaviour rather than counts; prefer role- or test-id-based selectors.
Regression test: n/a.
Related: ARCH-003, TEST-001.

### TEST-005 — Important production behaviour has no regression coverage, including both High findings
Severity: Medium (gaps around High/data-loss findings)   Category: tests/coverage   Status: **Confirmed** (matrix above, by grep of every suite)
Hypothesis ref: H21   Phase: P11   Session: E
Files: coverage matrix above
Prioritised missing regression tests (where each should live):
1. SEC-001 Host allowlist: `smoke-test.mjs` via `node:http` with a foreign Host → 4xx for GET export, `/dashboard` and purge.
2. BAK-001 out-of-order history: `backup-api-test.mjs`. Import a future-dated history, PATCH, then export → import and undoable delete → restore both succeed.
3. ARCH-001 import field rules: `backup-api-test.mjs`. Reject offset/non-midnight dates, non-http(s) `jobUrl`, untrimmed/empty text, unsafe IDs and unbounded `detail`.
4. CALC-001 undo semantics: `dashboard-api-test.mjs`. Move, undo, then events, rates and stale membership match the pre-move state.
5. DATA-001 contention: a new API case running an import while GET list and a page GET each return 200, and same-revision PATCHes returning only 200/409.
6. Direct unit tests for `backup-snapshot` (small hand-built histories for `possibleTrailEnds`), `status-history`, `analytics-period` and `calendar-date`.
7. REACT-001/002, REACT-003, A11Y-003, A11Y-004: the Session D probes D1–D5 turned into permanent Playwright cases.
8. DATE-001, DATE-002, BAK-003, DATA-002, SEC-002: small API or unit cases as listed in each entry.
9. H17: setup against a schema change (documents the behaviour; see DEP-002).
Duplication (checked, acceptable): backup behaviour is covered by the API suite (logic) and by e2e (`backup-recovery`, `backup-import-limits`, `import-overlap`, UI flow). The overlap is mainly the 413/limit checks, which is cheap; no removal is recommended.
Regression test: this entry *is* the list.
Related: every entry named above.

### TEST-006 — Legacy assertions and a test-only production branch
Severity: Low   Category: tests/obsolete   Status: **Confirmed** (source)
Hypothesis ref: H19 (non-undoable DELETE part)   Phase: P11/P12   Session: E
Files: `scripts/smoke-test.mjs:4,29-34`, `src/app/api/applications/[id]/route.ts:121,132-134`, `scripts/backup-api-test.mjs:89,207`, `scripts/smoke-test.mjs:150,153`
Evidence:
- `smoke-test.mjs:4` comment: "Run against a running local app". The script is only run through the isolated runner (`test:smoke`), and AGENTS.md forbids targeting the user's app. The comment is stale and invites the wrong use.
- `smoke-test.mjs:29-34` asserts that `/login` and `/api/auth/session` redirect to `/dashboard`, a guard for authentication removed in an earlier restructure (the previous audit's R4). It does no harm, but its value is low; it really pins the `[...slug]` catch-all.
- The plain (non-`?undoable=1`) DELETE branch is reached only by `backup-api-test.mjs:89,207` and `smoke-test.mjs:150,153`; the UI always sends `?undoable=1` (`application-dashboard.tsx:429`). This is production code that exists for tests and is reachable by any same-origin client.
Recommended fix: fix the comment; keep or rename the catch-all assertion as "unknown routes redirect"; either make the tests use the undoable path or document the plain DELETE as a supported API.
Related: SEC-001 (any extra mutation surface matters only through rebinding).

### TEST-007 — `run-backup-api-test.sh` copies the whole `prisma/` directory, including the user's real `dev.db`, into `/private/tmp` on every run
Severity: Low   Category: tests/hygiene-privacy   Status: **Confirmed** (source; `prisma/` contains `dev.db` + `schema.prisma`)
Hypothesis ref: plan P11 "runner side effects"   Phase: P11   Session: E
Files: `scripts/run-backup-api-test.sh:20` (`cp -R "$project_root/src" "$project_root/prisma" …`), `:6-17` (the trap deletes `$test_dir`)
Evidence: the copy is never opened (the server uses `DATABASE_URL=file:$test_dir/audit.db`), and the trap removes it on exit. A killed run (SIGKILL or a task-timeout, as in Session D's Playwright case) would leave a copy of the user's job-search data in `/private/tmp/nook-backup-api.*` until the next reboot or cleanup. The real DB is only read, never modified (the fingerprint was unchanged across Sessions B–E).
Recommended fix: copy only `prisma/schema.prisma` (as `e-build.sh` did).
**Session F symptom (Confirmed):** `tests/e2e/empty-state-copy.spec.ts:12,18,23` saves screenshots to fixed `/private/tmp/nook-empty-{analytics,interviews-past,stale}.png` paths outside Playwright's output directory; they persist after the run. Use `testInfo.outputPath()` instead.
Regression test: none needed.
Related: TEST-002 (the other runner side effect).

### P11 checklist
- [x] Coverage matrix
- [x] Unwired scripts (TEST-003)
- [x] Harness brittleness (TEST-004)
- [x] Duplicated tests (TEST-005: acceptable overlap)
- [x] Implementation-coupled assertions (TEST-004)
- [x] Missing regression tests from all findings (TEST-005)
- [x] Runner side effects: tsconfig (TEST-002), `/tmp` DB copy (TEST-007)

### P12 — Dead code, dependencies and configuration

Method: every `export` in `src/` was grepped against all other `src/` files, then against `scripts/` and `tests/`. Framework exports (`GET`, `dynamic`, `metadata`, `config`, `proxy`) were excluded. Dynamic references were checked by grepping the symbol names as strings.

### CLEAN-001 — Dead exports and functions
Severity: Low   Category: dead-code   Status: **Confirmed**
Hypothesis ref: H19   Phase: P12   Session: E
Files and evidence (each symbol appears only at its definition, including in `scripts/` and `tests/`):
- `undoDeleteRecovery`: `src/hooks/use-toast-undo.ts:205-207,224` is returned from the hook, but the only consumer destructures without it (`application-dashboard.tsx:133`).
- `parseStatusTransitionDetail` and its `transitionDetailPattern`: `src/lib/status-history.ts:18-34`.
- `statusLabel`: `src/lib/status-meta.ts:39-41`.
- Unused exported types: `StartupPage`, `StaleApplicationThreshold`, `DefaultBoardStatus` (`src/lib/general-preferences.ts:11,13,15`); `BackupSettings` (`src/lib/backup-settings-schema.ts:38`).
- Exported but used only in their own file (the `export` keyword is unnecessary; not dead): `DeleteRecovery`, `InterviewGroup`, `AnalyticsRange`, `ParsedStatusTransition`, `MotionMode`, `parseCalendarDateKey`, `timeZoneSchema`, `isEditableShortcutTarget`, `ShortcutSection`, `ShortcutPage`, `DashboardShortcut`, `ValidationIssue`, `formatValidationIssues`, `applicationStatusSchema`, `applicationArchiveSchema`, `eventSnapshotSchema`, `applicationSnapshotSchema`, `DuplicateCandidate`, `MAX_MUTATION_BODY_BYTES`, `BoardColor`, `DEFAULT_BOARDS`, `boardFor`.
Impact: none at runtime; noise for maintainers.
Recommended fix: delete the dead functions and types; the file-local exports can stay or be un-exported.
Regression test: typecheck and lint.

### CLEAN-002 — Unused schema surface: `EventType.NOTE_ADDED`, `ApplicationEvent.emailSnippet`, and the redundant `detail` mirror
Severity: Low   Category: dead-code/schema   Status: **Confirmed**
Hypothesis ref: H19   Phase: P12   Session: E
Files: `prisma/schema.prisma:36-44,62-65`, `src/lib/backup-snapshot.ts:51-53,56,69,77,170,183`, `src/app/api/applications/export/route.ts:16`, `src/app/api/applications/[id]/restore/route.ts:27-30`, `tests/e2e/backup-import-limits.spec.ts:71`
Evidence: `grep NOTE_ADDED src scripts tests` → no producer anywhere. `emailSnippet` is only carried through export, restore and the canonical comparison, and accepted unbounded on import (ARCH-001). `detail` duplicates the typed `fromStatus`/`toStatus` fields and is validated for equality with `statusTransitionDetail` (`backup-snapshot.ts:69,77`), so it carries no information of its own.
Impact: the import path accepts event types and fields the app never creates (ARCH-001's unbounded-text symptom rides on this).
Recommended fix: a product decision. Removing them changes the Prisma schema (via `db push`; see DEP-002) and the v1 backup schema. Per AGENTS.md the backup stays `"version": 1` and simply rejects such fields afterwards (no migration or repair). Until then, bound `detail`/`emailSnippet` as ARCH-001 recommends.
Regression test: `backup-api-test.mjs`, a `NOTE_ADDED` event → 400 (if removed).
Related: ARCH-001.

### CLEAN-003 — Leftover localStorage-era indirection and duplicated magic values
Severity: Low   Category: duplication/cleanup   Status: **Confirmed** (source)
Hypothesis ref: H19   Phase: P12   Session: E
Files: `src/lib/general-preferences.ts:6-9,22-26`, `src/components/settings-modal.tsx:14,146,155,164,175`, `src/components/application-dashboard.tsx:46-51`, `src/components/application-sidebar.tsx:131-132`, `src/app/globals.css:257,268,499`, `src/app/api/applications/[id]/route.ts:123`, `src/lib/dashboard-analytics.ts:156`, `src/components/board-settings.tsx:30`, `src/hooks/use-board-drag.ts:93`
Evidence:
- `DEFAULT_BOARD_KEY`/`MOTION_KEY`/`STARTUP_PAGE_KEY`/`STALE_THRESHOLD_KEY` feed a stringly typed `setPreference(key: string, value: string)` that validates through `settingsSchema.partial()` at runtime. `subscribeToPreferences` is an alias of `subscribeSettings`. The typed `updateSettings({ … })` already exists.
- Sidebar widths: `MIN_SIDEBAR_WIDTH = 304`/`MAX = 420` are constants in the dashboard, but `application-sidebar.tsx:131-132` hard-codes `aria-valuemin={304}`/`aria-valuemax={420}`; `320px` appears in three CSS rules and in `DEFAULT_SIDEBAR_WIDTH`.
- The 10-minute undo TTL is an inline `10 * 60_000` (`[id]/route.ts:123`); the client reads the server's `expiresAt` (good), so only the server value matters.
- Stale severity cutoffs 60/30 are inline (`dashboard-analytics.ts:156`); the TouchSensor `{ delay: 200, tolerance: 6 }` is repeated in two files.
Impact: none today; drift risk.
Recommended fix: replace `setPreference` and its keys with typed `updateSettings` calls; pass the width constants to the sidebar; name the TTL and cutoffs. Combine with ARCH-002.
Related: ARCH-002, ARCH-003.

### DEP-001 — Dependencies: all used, no advisories; mixed pinning, no `engines`, stale package name
Severity: Low   Category: dependencies   Status: **Confirmed**
Hypothesis ref: H19 (package name)   Phase: P12   Session: E
Files: `package.json:2,23-45`, `package-lock.json`
Evidence: every runtime dependency is imported. Files importing each: `@dnd-kit/core` 5, `@dnd-kit/utilities` 3, `@prisma/client` 24, `lucide-react` 2, `zod` 8. Dev dependencies are all used (`typescript` by the unit harness, `@playwright/test` by e2e, the Tailwind/PostCSS pair by `postcss.config.mjs`). `npm audit`: 0 advisories (Session B). Pinning is mixed: `^` for `@dnd-kit/core`, `@dnd-kit/utilities`, `lucide-react`, `@playwright/test`, and exact for everything else. The lockfile resolves to 6.3.1 / 3.2.2 / 1.48.0 / 1.63.0, so installs are reproducible from the lockfile. There is no `engines` field, although `next@16.3.5` requires Node `>=20.9.0` (and the harness assumes a recent Node). The package name is `application-tracker`, not Nook.
Not an issue: `@prisma/client` imported as a value in client files (Session A, browser enum entry).
Recommended fix: pin the four caret ranges or document the policy; add `"engines": { "node": ">=20.9.0" }`; rename the package to `nook` (cosmetic).
Regression test: n/a.

### DEP-002 — Schema tooling is inconsistent: `db push` workflow, but a `prisma migrate dev` script and contradictory migration ignore rules
Severity: Low (becomes a data-loss prompt only if the user runs `npm run db:migrate`)   Category: config/persistence-tooling   Status: **Confirmed** (configuration); `migrate dev` behaviour **Inferred** from Prisma's documented drift handling (not run; it would touch a DB)
Hypothesis ref: H17   Phase: P12/P13   Session: E
Files: `package.json:19` (`"db:migrate": "prisma migrate dev"`), `scripts/setup.mjs:32-43` (`prisma db push`), `.gitignore:47,65-67`, `README.md:39,41`, `scripts/setup-test.mjs:79-121`
Evidence:
- There is no `prisma/migrations/`, and setup and both runners use `db push`. `npm run db:migrate` on a `db push`-created database with data would detect drift (no `_prisma_migrations` history) and offer to **reset the database**. It is interactive, so a user who accepts loses everything. The script is not in the README, but `package.json` exposes it.
- `.gitignore:47` ignores `prisma/migrations/`, then `:65-66` re-includes `!prisma/migrations/` and `!prisma/migrations/**`. `git check-ignore -v prisma/migrations/x.sql` → matched by `!prisma/migrations/**`, so the net effect is **tracked**. The rules contradict each other.
- README "keeps existing … data when they do not need to change" is true for an unchanged schema (`test:setup` "preserves records on a second run" passes). For a future schema change with data-loss warnings, `db push` (non-interactive, no `--accept-data-loss`) fails and `setup.mjs` exits non-zero. The data is kept, but the user has no upgrade path (Inferred, not run).
Recommended fix: remove `db:migrate`, or replace it with a documented `db push` alias. Resolve the `.gitignore` rules one way. Decide the schema-change policy before the next schema edit; AGENTS.md says to avoid migrations, so keep additive `db push`-safe changes and document that a destructive change requires export → reset → import.
Regression test: `setup-test.mjs` case for an additive schema change (passes) and a destructive one (fails clearly with a message).
Related: CLEAN-002 (any removal is a schema change).

### DEP-003 — Configuration and repository drift
Severity: Low   Category: config-drift   Status: **Confirmed**
Hypothesis ref: H19 (`AGENTS.md` ignored)   Phase: P12   Session: E
Files: `.gitignore:69`, `AGENTS.md` (footer), `eslint.config.mjs:8`, `tsconfig.json:3`, `next.config.ts`
Evidence:
- `AGENTS.md` is gitignored (`.gitignore:69`, `git check-ignore -v AGENTS.md`), yet it is the project's instruction file, and its Next-generated footer says "committing it with your work keeps the tree clean", which contradicts the ignore. `next dev` regenerates AGENTS.md/CLAUDE.md (seen in the harness copy's log: "Generated AGENTS.md and CLAUDE.md for AI agents. Set `agentRules: false` in next.config to disable."). In the project only `AGENTS.md` exists; there is no `CLAUDE.md`.
- ESLint `globalIgnores` lacks `.next-playwright*/**` (TEST-002).
- Checked and **not issues**: `target: "ES2017"` with `noEmit` + `moduleResolution: bundler` (Next/SWC does the transpilation; `tsc` only type-checks), `next-env.d.ts` and `tsconfig.tsbuildinfo` ignored, `.DS_Store` ignored, `test-results/` present but ignored, and `.env` has the same keys as `.env.example` (Session A).
Recommended fix: decide whether AGENTS.md is shared (un-ignore it) or local (then set `agentRules: false`, or accept regeneration). Add the ESLint ignore.
Related: DOC-002, TEST-002.

### P12 checklist
- [x] Unused exports, files and branches (CLEAN-001; TEST-006 for the test-only DELETE branch)
- [x] Duplicated constants and magic values (ARCH-002, CLEAN-003)
- [x] Dependency usage (DEP-001)
- [x] Scripts vs architecture (DEP-002, TEST-003)
- [x] `.gitignore`, tsconfig and next.config drift (DEP-002, DEP-003, TEST-002)
- [x] Stray local files (only ignored ones: `.DS_Store`, `tsconfig.tsbuildinfo`, `test-results/`, `next-env.d.ts`)

### P13 — Documentation accuracy

### DOC-001 — README: inaccurate undo claim, and missing user-facing facts about backups, limits and requirements
Severity: Low   Category: docs/readme   Status: **Confirmed** (each claim compared with the code)
Hypothesis ref: H3, H17 (docs parts)   Phase: P13   Session: E
Files: `README.md:5-19,21-23,29-41,63-65`
Claim-by-claim:
- **Accurate:** Overview, Job Board with drag-and-drop and keyboard, add/edit/search/filter/delete (sidebar status filter at `application-sidebar.tsx:291-302`), duplicate warnings, Interviews, Analytics, Stale with a configurable threshold (7/15/30), archive and restore, keyboard shortcuts, customisable boards, themes and motion, the setup commands, `127.0.0.1:3000` (`dev` binds `-H 127.0.0.1`), and the command list (all exist in `package.json`). `npm run setup` "prepares Prisma" is correct (`db push` also generates the client).
- **Inaccurate or misleading:** "Undo: Reverse recent status changes, archive actions, and deletions" (`:15`). Only the **single latest** action can be undone: one toast slot plus one delete-recovery slot (`use-toast-undo.ts:24-25`). A status undo is recorded as a new status change, not a reversal (CALC-001). Delete recovery lasts 10 minutes (`[id]/route.ts:123`) and does not survive navigating to another page (Session C/D hand-off, Inferred).
- "Customizable boards" is true on the Job Board, sidebar and modal, but Analytics and Stale ignore custom names and colours (BIZ-002).
- **Missing (user-facing):** what an import does (always replaces settings, never updates existing records, and any changed record rejects the whole file: BAK-002); limits (5,000 applications and 10 MB per backup, `backup-limits.ts`); the required Node version (≥20.9); that closing the terminal stops Nook (the dev server is the normal run mode, and `build`/`start` is the alternative).
- The wording "local-first" (`:3,23`) usually implies sync; AGENTS.md says "local-only". Minor.
- The README reads as a user guide and not as a changelog (good); keep it that way when these are added.
Recommended fix (not applied): correct the Undo bullet ("Undo your most recent change; deleted applications can be restored for 10 minutes"); add a short "What import does" paragraph and the limits under Backup & Restore; add Node ≥20.9 to Setup.
Related: BAK-002, CALC-001, BIZ-002, DEP-002.

### DOC-002 — AGENTS.md drift
Severity: Low   Category: docs/agents   Status: **Confirmed**
Phase: P13   Session: E
Files: `AGENTS.md:9-10,21-24` and the Next footer
Evidence: the validation section names only `test:backup` and `test:smoke` for the isolated runner. It omits `dashboard-api-test.mjs` and the four unwired unit tests (TEST-003). "Hooks in `src/hooks/`" is contradicted by `useSettings`/`useBoards` in `src/lib` (ARCH-003). The file itself is gitignored (DEP-003), so collaborators never receive it. Accurate: `mutation-request.ts`, `application-date.ts` and `calendar-date.ts` exist and are the right reuse points; the backup rules match `backup-snapshot.ts`/`backup-settings-schema.ts`; the Playwright rule matches `playwright.config.ts:5`.
Recommended fix: add the dashboard suite and unit command, and resolve the ignore decision (DEP-003).
Related: TEST-003, DEP-003, ARCH-003.

### DOC-003 — Code comments that contradict behaviour
Severity: Low   Category: docs/comments   Status: **Confirmed**
Phase: P13   Session: E
Evidence: `scripts/smoke-test.mjs:4` "Run against a running local app" (TEST-006). Checked and **not an issue**: `application-dashboard.tsx:47`, where the "first three filter pills" width rationale matches the existing sidebar filter pills (`application-sidebar.tsx:291-302`). The pixel arithmetic (254.08 + 12 + 36 + 1 ≈ 304) is Unverified without a browser. `.env.example:1` ("relative to prisma/schema.prisma") is correct. The previous audit's stale reference to `src/lib/backup-settings.ts` was already noted by Session A.

### P13 checklist
- [x] README claim-by-claim (DOC-001)
- [x] Setup and commands (DOC-001: accurate; DEP-002: `db:migrate` hazard)
- [x] Backup documentation (DOC-001, BAK-002)
- [x] AGENTS.md accuracy (DOC-002)
- [x] Contradictory comments (DOC-003)

### Preliminary hypotheses — status after Session E

| H | Session E result |
|---|---|
| H17 | **Confirmed** as configuration inconsistency (DEP-002): `db:migrate` exposes `prisma migrate dev` against a `db push` database (reset prompt Inferred); contradictory `.gitignore` rules (net: tracked). The README "keeps existing data" claim holds for an unchanged schema (`test:setup` passes); the future-schema-change path is Inferred. |
| H18 | **Confirmed and root-caused** (TEST-002): Next's `writeConfigurationDefaults` appends the `distDir` type globs, and `run-playwright.sh` picks a new random in-project `distDir` per run. Now 9 pairs (3 new since the baseline). Not reverted. |
| H19 | **Confirmed**: dead code (CLEAN-001), unused `NOTE_ADDED`/`emailSnippet` (CLEAN-002), `*_KEY`/`setPreference` indirection and magic values (CLEAN-003), constants (ARCH-002), a test-only DELETE branch (TEST-006), package name (DEP-001), `AGENTS.md` ignored (DEP-003). |
| H21 | **Confirmed**: 5 unwired files (TEST-003), a brittle harness (TEST-004), missing direct unit tests and regression gaps (TEST-005), and one broken e2e spec (TEST-001, fails every day). |
| H22 | Performance part **Confirmed** (PERF-001): every page ships the full list; `/jobs` is 1.33 MB / 267 ms at 500 and 13.1 MB / 3.1 s at 5,000 (dev). Render-cost part Inferred (PERF-003). |
| H12 (cost) | REACT-005 costed: about 0.7–1 s extra server work per mutation at 5,000 (dev). |

No hypothesis was disproved in Session E. **Disproved as performance concerns:** `trend.buckets.find` (≤6 buckets), the import loop's `setState` cadence (longest batch 28 ms), and `MotionPresence`'s extra render (theoretical).

### Unverified after Session E
- Client bundle sizes and route composition (the isolated Turbopack build cannot use a symlinked `node_modules`). Session F's `npm run build` should record them.
- Production (`next start`) timings; all P9 numbers come from the dev server.
- Client render cost (PERF-003): no browser profiling (not requested).
- The actual TEST-001 failure output (Playwright not run; the failure is derived for all seven weekdays).
- `prisma migrate dev` behaviour on a `db push` DB, and `db push` on a destructive schema change (DEP-002): both deliberately not run.
- The DOC-003 pixel arithmetic.

### For Session F
1. Run `npm run test:keyboard` alone. Expect `interviews.spec.ts` "includes dated applications…" to fail on any weekday (TEST-001). Read the other failures before classifying them, since Session D's 21 failures are unexplained.
2. After Playwright, `tsconfig.json` will gain a 10th `.next-playwright.*` pair (TEST-002). Report it; do not revert it without the user's approval. Also check that no `.next-playwright.*` directory is left behind.
3. `npm run build` in the project: record the route list and client JS sizes (P9's unverified bundle item).
4. Run the unwired suites as plan §9 lists (the unit set, `import-scale`, the dashboard API suite); all passed in Session E or C.
5. Delete the Session E scratch files (`e-perf.mjs`, `e-build.sh`, `e-perf.log`, `e-build.log`), then confirm the `prisma/dev.db` fingerprint (53248 B, mtime 2026-09-27T11:46:19, sha256 `416ef643…c944c`).
6. Check for leftover `/private/tmp/nook-backup-api.*` or `nook-e-build.*` directories (TEST-007); none are expected, because both traps ran.

---

## Session F — Phase 14 (final verification, reconciliation)

HEAD `5f74723`. No application code, tests, scripts, configuration or README changed. Scratch files lived in the Session F scratchpad and were deleted at the end. `prisma/dev.db` was never opened; the fingerprint is unchanged (see below).

### Pre-flight
- No Playwright, `next dev`, `next build` or other audit process running. `git status`: ` M tsconfig.json` only (9 `.next-playwright.*` pairs, as Session E left it). No `.next-playwright.*` directory, no `/private/tmp/nook-*` directory.
- `prisma/dev.db`: 53248 B, mtime 2026-09-27T11:46:19, sha256 `416ef643…c944c` (matches baseline).
- Deleted the Session E scratch files `e-perf.mjs`, `e-build.sh`, `e-perf.log`, `e-build.log`. Sessions B and C scratch files (`probe.mjs`, `probe2.mjs`, `p4-dates.mjs`, `p4-midnight.mjs`, `p5-api.mjs`, `p5-api*.out`) remain in their own session scratchpads under `/private/tmp/claude-501/…` (outside the repo; not deleted, because they were not in Session F's cleanup list).

### Final verification (run sequentially, nothing else running)

| # | Command | Result |
|---|---|---|
| 1 | `npm run typecheck` | **Pass** (3 s), no diagnostics |
| 2 | `npm run lint` | **Pass** (9 s), no warnings |
| 3 | `npm run test:shortcuts` | **Pass** 4/4 |
| 3 | `npm run test:duplicates` | **Pass** |
| 3 | `node --test scripts/interviews-grouping-test.mjs scripts/motion-preference-test.mjs scripts/settings-store-test.mjs` | **Pass** 8/8 |
| 3 | `npm run test:setup` | **Pass** 4/4 |
| 3 | `node scripts/import-scale-test.mjs` | **Pass** `{"records":5000,"elapsedMs":6130,"longestBatchMs":25}` |
| 3 | `npm run test:backup` | **Pass** |
| 3 | `npm run test:smoke` | **Pass** |
| 3 | `bash scripts/run-backup-api-test.sh scripts/dashboard-api-test.mjs` | **Pass** |
| 4 | `npm run build` | **Pass** (Turbopack, compiled 10.8 s, TypeScript 6.0 s, no warnings). 18 routes, all `ƒ` dynamic, plus `ƒ Proxy (Middleware)` |
| 5 | `npm run test:keyboard` | **Fail**: 17 passed, 32 failed, 18.1 min, exit 1. Healthy run (no hang, no environment failure). Classified below |

Typecheck and lint were unaffected by the tsconfig `.next-playwright.*` entries (no such directories existed during those runs). The build did not modify `tsconfig.json`.

### Build: route and bundle information (closes the P9 bundle item as far as possible)
Next 16.3.5 with Turbopack prints the route list but **no sizes or First Load JS**. The numbers below are measured from `.next/static/chunks` and the per-route `*_client-reference-manifest.js` files (raw / gzip -9), not reported by Next.
- 17 client chunks, 1.22 MB raw / 338 KB gzip in total. Root main files (every route): 6 chunks including React DOM (229 KB raw / 71 KB gz).
- Per route (root + route chunks): `/jobs`, `/dashboard`, `/dashboard/analytics`, `/dashboard/stale`, `/interviews` → 10 chunks, **1,163 KB raw / 326 KB gzip** each (identical: one shared client shell, ARCH-004). `/`, `/[...slug]`, `/_not-found` → 8–9 chunks, **~980 KB raw / 274 KB gzip**.
- The largest chunk (`20343g5dds4h1.js`, 433 KB raw / 105 KB gz) contains zod (`$ZodType`, `ZodError`) and the Prisma browser runtime (`Decimal`, `PrismaClientValidationError`, `getRuntime`; `@prisma/client/runtime/index-browser.js` is 35 KB + 7 KB of source). It is loaded by **every** route, including the redirect-only ones → PERF-004.
- The `ApplicationDashboard` + dnd-kit + lucide chunk is 188 KB raw / 53 KB gz. Turbopack strips module paths, so per-module attribution beyond these markers is Inferred.

### Production server check (`next start`, temp DB)
Script: `next start -H 127.0.0.1` on the Session F build with `DATABASE_URL=file:/private/tmp/nook-f-start.*/f.db` (`prisma db push --skip-generate`, then a marker Settings row with revision 4242 inserted with `sqlite3`; the probe aborts unless `GET /api/settings` reports revision 4242, so the real `dev.db` could not be written). Temp dir removed by trap.
- Build correctness: `GET /` 200, `/dashboard` 200, `/jobs` 200, `/interviews` 200, `/dashboard/analytics` 200, `/dashboard/stale` 200, `/nope` 307. Page times 17–185 ms at n≈1 (production; not comparable to Session E's dev-server scale numbers).
- **SEC-001 under `next start`: Confirmed.** With `Host: evil.test:<port>`: `GET /api/applications/export` → 200 including the canary; `GET /dashboard` → 200 including the canary; `PATCH /api/settings` with evil Host+Origin → 200; `DELETE /api/applications/purge` body `{}` with evil Host+Origin and a Content-Length → **200, applications 1 → 0**. Foreign Origin with the real Host → 403 (CSRF check works).
- Tooling note (appended to SEC-002): a DELETE whose `{}` body is sent **chunked** (no Content-Length) returns 400 with an empty body under `next start`, even for a same-origin control request. Browsers send Content-Length for string bodies, so there is no user impact; it only matters for hand-written probes/tests.

### Playwright classification (`npm run test:keyboard`, all 32 failures)
Method: read every failure and its page snapshot; then (a) one rerun of the failing spec files **unchanged** through `scripts/run-playwright.sh --config <scratch>` with a `globalSetup` that stores `startupPage: "job-board"` (30 tests: 11 passed, 19 failed; backup-recovery and duplicate-import-focus excluded because their imports overwrite settings); (b) three small observation probes (scratch specs, not added to `tests/`). Root causes found:

1. **Specs assume `/` opens the Job Board.** `/` redirects to the stored startup page, default `"dashboard"` (unchanged since `f6318b5`), and `Add job`, board cards and sidebar application rows exist only on `/jobs`. Every snapshot in the full run shows `heading "Overview"`. Tests then waited 45 s and their `finally` cleanup failed ("Target page, context or browser has been closed"), leaving records behind.
2. **Specs seed or assert settings through localStorage** (`nook-sidebar-collapsed`, `nook-archived-expanded`, 20+ call sites), but `5f74723` moved these settings into SQLite. The seeds have no effect.
3. **Persisted settings leak between tests.** Settings now live in the one shared test DB. `shortcut-scope:75` toggles the sidebar with the shortcut (a PATCH), then fails on its localStorage assertion before toggling back; every later sidebar test starts collapsed (snapshots show `button "Expand sidebar"` from `shortcut-scope:137` onward) and its `localStorage.removeItem` reset is inert.
4. **Specs assert removed UI or behaviour**: the Dashboard sidebar "Recent applications" list (removed in `f65917d`); the partial-import message "settings could not be restored" (impossible since the atomic import in `5f74723`, previous fix R3); a `light` class on `<html>` (the app only toggles `dark`, UI-004); `.nook-toast` count 0 (the node is intentionally retained for the exit animation since `f6318b5`); Sunday-start "This Week" grouping (TEST-001).

| Spec:line | Classification | Evidence |
|---|---|---|
| application-revision:6, deletion-recovery:53/73/106, interview-date:76/103, keyboard:181 | Obsolete test (cause 1) — **Confirmed** | pass in the rerun with startup page Job Board |
| empty-state-copy:3 | Test infrastructure (cascade: records left by cause-1 timeouts) — **Confirmed** | passes in the rerun |
| backup-recovery:6, duplicate-import-focus:6 | Obsolete test (cause 1) — Inferred | same signature (Overview snapshot, cleanup "context closed"); not rerun |
| backup-recovery:44 | Obsolete test (cause 4, R3) — Confirmed | message absent from `src` since `5f74723` |
| backup-recovery:82, keyboard:278, shortcut-scope:75 | Obsolete test (cause 2) — Confirmed | localStorage seeds/asserts at `backup-recovery:83,114`, `keyboard.spec` `beforeEach`, `shortcut-scope:118` |
| interviews:185 | Obsolete test (TEST-001) — **Confirmed** | "This Week" heading not found, as predicted |
| keyboard:334 | Obsolete assertion (cause 4) — Confirmed | probe: toast wrapper loses `nook-toast-show`, `aria-hidden=true`, opacity 0 after 6.5 s real time and after the spec's fake-clock hover timing; only the DOM node remains |
| navigation:37, shortcut-scope:137, sidebar-context:70/187 | Obsolete test (cause 4, "Recent applications") — Confirmed | strings absent from `src`; removed in `f65917d` |
| scrollbars:84 | Obsolete test (cause 4, `light` class) — Confirmed | `layout.tsx:36`/`theme-provider.tsx:28` only toggle `dark` |
| sidebar-context:134, sidebar-interactions:37/89/116, sidebar-layout:7/62, sidebar-navigation:45, sidebar-resize:29/65 | Test infrastructure (cause 3) plus obsolete localStorage setup (cause 2) — Confirmed | rerun snapshots all start collapsed; `sidebar-interactions:46,86` also assert localStorage |
| keyboard:122 | **Application defect, Low** (UI-001 symptom) — Confirmed | probe: when focus is moved out of the Add dialog (the trap sends it to Close) and the dialog is then cancelled, the next Edit dialog opens with focus on **Close** instead of Company (+0, +200, +1000 ms). Without that step Edit focuses its first input |
| keyboard:233 | **Unresolved** (not an app regression in shortcut scope) | probe replaying the exact key sequence with a pause after closing Settings: Cmd+Shift+, in the search field is suppressed (Settings stays hidden, focus and value kept). The spec types into search immediately after "Close settings", while Settings is still visible for its exit animation (`visible: true` at +0 ms, false at +300 ms). Likely the exiting dialog's trap reclaims focus so the shortcut re-opens Settings (REACT-003 class), Inferred only |

Totals: 30 test-side (obsolete test or test infrastructure), 1 application defect (Low), 1 unresolved. **No environment/resource failures; no confirmed application regression.** Session D's 21 unexplained failures match these causes (same specs), so they were not environment-caused as first suspected, apart from the task cap that killed that run.

### H18 / TEST-002 — tsconfig drift (evidence)
- Before Playwright: 9 pairs (copy kept in the scratchpad for the diff).
- After `npm run test:keyboard`: **exactly one pair added**, `.next-playwright.m6MkwS/{types,dev/types}/**/*.ts` (10 pairs). `git diff --stat`: `tsconfig.json | 10 +++++++++-`.
- The classification rerun and three probes, which use the same runner, added `uEvjeZ`, `2mwc0T`, `LMcDll`, `dqi57B`: **14 pairs** at the end, `git diff --stat` `tsconfig.json | 18 +++++++++++++++++-` (17 insertions, 1 deletion) against HEAD.
- Not reverted. Plan §9 step 8 says to report tracked-file drift and not revert it without asking the user. No `.next-playwright.*` directory remains (each runner trap ran).

### Status and severity changes in Session F
- **TEST-001**: Inferred → **Confirmed**. Severity Medium unchanged.
- **SEC-001**: now Confirmed on `next start` as well as `next dev`. Severity High unchanged.
- **New PERF-004** (Low, Confirmed) and **new TEST-008** (Medium, Confirmed), below.
- **UI-001**: new confirmed symptom (Edit dialog initial focus on Close after an Add-dialog focus redirect). Severity Low unchanged.
- **SEC-002**: tooling note (chunked DELETE body → 400 under `next start`). Severity unchanged.
- **TEST-007**: new symptom: `tests/e2e/empty-state-copy.spec.ts:12,18,23` write screenshots to fixed `/private/tmp/nook-empty-*.png` paths outside Playwright's output dir, and they persist after the run (Session F deleted the three it created).
- **BAK-003**: Session D asked Session F to revisit Low vs Medium. Kept **Low**: nothing new; the trigger still needs a manual DB edit or a future schema tightening. Its fix is cheap and should ride along with ARCH-001.
- Every other severity and status is unchanged.

### PERF-004 — Every route's client bundle includes zod and the Prisma browser runtime via the root layout's settings modules
Severity: Low   Category: performance/bundle   Status: **Confirmed** (build artefacts); module attribution partly Inferred (Turbopack strips module paths)
Hypothesis ref: plan P9 "client bundle size"   Phase: P9/P14   Session: F
Files: `src/components/theme-provider.tsx:4` → `src/lib/settings-store.ts:3` → `src/lib/settings-defaults.ts:1,3` (`settingsSchema.parse(...)` at module load, a **value** import) → `src/lib/backup-settings-schema.ts:1,3` (`zod`, `@prisma/client` `Status`); `src/components/motion-preference.tsx:4` → `src/lib/general-preferences.ts:1,4`
Evidence: chunk `20343g5dds4h1.js`, 433 KB raw / 105 KB gzip, contains the zod and Prisma-browser markers and is listed in the client-reference manifest of every route, including `/`, `/[...slug]` and `/_not-found`. That is about a third of each route's 274–326 KB gzip. `ThemeProvider` and `MotionPreference` are mounted by the root layout, so no route can avoid it. The full dashboard shell also needs zod client-side (import worker, settings validation), so the saving is concentrated on the redirect-only routes and on first paint.
Impact: a few hundred KB of extra JS parsed on first load. Local-only app served from disk, so not user-visible in practice. Theoretical at Nook's scale.
Recommended fix: make `settings-defaults.ts` a plain literal typed as `ParsedBackupSettings` (no parse at module load), import `Status` values from a local constant list where only enum names are needed, and keep zod validation in the modules that actually validate (store writes, worker). Re-measure with the build.
Regression test: none automated; compare the chunk list of `/` after the change.
Related: ARCH-004, ARCH-005, ARCH-002 (the same constants).

### TEST-008 — The Playwright suite is broadly obsolete after the settings→SQLite move and later UI changes; 30 of its 32 failures are test-side, so the suite cannot detect regressions
Severity: **Medium** (the e2e suite is the only coverage for the REACT/A11Y/UI paths, and it is red for test reasons)   Category: tests/drift   Status: **Confirmed** (Session F full run and classification rerun)
Hypothesis ref: H21   Phase: P11/P14   Session: F
Files: `tests/e2e/*.spec.ts` (all `page.goto("/")` callers expecting the Job Board: application-revision, backup-recovery, deletion-recovery, duplicate-import-focus, interview-date, keyboard, scrollbars, sidebar-*), the localStorage setup in `keyboard.spec.ts` `beforeEach`, `navigation.spec.ts:10-11`, `sidebar-interactions.spec.ts:11-12,46,86`, `sidebar-context.spec.ts:19-20`, `sidebar-layout.spec.ts:4`, `sidebar-resize.spec.ts:20-22`, `shortcut-scope.spec.ts:118`, `backup-recovery.spec.ts:83,114`, `interviews.spec.ts:56`, `deletion-recovery.spec.ts:44-45`, `kanban-layout.spec.ts:8`; `scripts/run-playwright.sh` (one DB for the whole run)
Evidence: see the classification table above. The specs were last changed in `f6318b5`; `5f74723` (settings to SQLite, atomic import) and `f65917d` (sidebar behaviour) changed the app without updating them, and neither 2026-09-27 audit ran Playwright. Two failures are knock-on effects: records left by timed-out cleanups and a persisted sidebar state.
Impact: `npm run test:keyboard` is red (32/49) on a tree with **no confirmed app regression**. Real regressions are masked, and fixes for REACT-001/002/003 and A11Y-003/004 have no working e2e safety net.
Recommended fix: (1) open `/jobs` directly (or set `startupPage` via the API in a fixture) instead of `/`; (2) replace localStorage seeds and asserts with `PATCH /api/settings` in a fixture and read settings back through `GET /api/settings`; (3) reset settings to defaults in a `beforeEach`/fixture so persisted state cannot leak (settings are now DB-shared); (4) delete or rewrite the Recent-applications, partial-settings-failure and `light`-class assertions; (5) replace `toHaveCount(0)` on `.nook-toast` with a check of the wrapper's hidden state; (6) fix TEST-001. Keep `sidebar-width` in localStorage, which the app still uses.
Regression test: `npm run test:keyboard` green on an unchanged tree, then run twice in a row to prove there is no order dependence.
Related: TEST-001, TEST-004 (selectors, order dependence, now observed), TEST-005, UI-001.

### Unverified after Session F (genuine gaps)
- `keyboard:233` exact mechanism (Settings re-opens when the search field is used during the Settings exit animation). The shortcut-scope rule itself is verified correct.
- A11Y-005 screen-reader announcements (needs AT). No axe scan (not installed).
- Production-server timings at 500/5,000 records (only n≈1 under `next start`; the Session E numbers are dev-server).
- PERF-003 client render cost (no browser profiling).
- Module-level bundle attribution beyond the zod/Prisma/React/dnd-kit markers (Turbopack strips paths).
- REACT-004/REACT-006 races, UI-002 narrow viewport, UI-003 placeholder layout shift, the DOC-003 pixel arithmetic, DATE-002 sleep/wake, and the A11Y-004 separator/drag paths: the Playwright specs that would exercise some of them are the obsolete ones (TEST-008).
- DEP-002 `prisma migrate dev` / destructive `db push` behaviour: deliberately not run.
- Client import "Cancel import" and closing Settings mid-import: `backup-import-limits` and `import-overlap` passed (duplicate review, overlap guard); `duplicate-import-focus` failed on cause 1 and was not rerun.
