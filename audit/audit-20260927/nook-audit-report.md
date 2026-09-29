# Nook audit

**Scope:** Audit completed at commit `96e5102` on `main`. The working tree was clean before and after the audit. No application code or real SQLite data was changed. API checks used the repository’s temporary SQLite harness; the temporary reproduction script was removed.

## Verification

| Check | Result |
|---|---|
| Typecheck, lint, production build | Pass |
| Focused shortcut, duplicate, setup, interview grouping, and motion checks | Pass |
| Import scale check | Pass: 5,000 records processed |
| Backup and dashboard API suites | Pass with isolated SQLite databases |
| Lockfile advisory check | Pass: `npm audit` reported 0 vulnerabilities |
| Smoke suite | **Fail:** stopped at a stale routing assertion before its CRUD checks |
| Browser behavior | Unverified; browser tests were excluded by the repository instructions |

The source review covered routes, request checks, validation, create/edit/status/archive/delete/undo flows, backup and setup, dashboard date calculations, browser storage, UI semantics, loading states, and README claims. Development and production scripts bind to `127.0.0.1`; mutation routes check origin, JSON content type, and body size. Saved posting links are checked for HTTP(S) before rendering.

## Confirmed findings

### 1. High — Version 1 import accepts invalid board settings

[The settings schema](src/lib/backup-settings-schema.ts#L12) defines `boards` as an array of unknown values. During restore, [board normalization](src/lib/board-preferences.ts#L27) silently drops invalid entries or replaces invalid fields. In an isolated API reproduction, a backup containing `boards: [null, { status: "NOT_A_STATUS", label: 12 }]` returned **201**.

**Impact:** An invalid backup can report success while losing its board configuration. This conflicts with the project rule that invalid version 1 backups fail validation.

**Fix and verification:** Give board entries a strict schema covering status, label, color, empty text, and uniqueness. Reject malformed entries before import. Add API cases for invalid and valid customized boards, and verify a valid export/import round trip preserves them.

### 2. Medium — Import accepts a current status that disagrees with history

[Application snapshot validation](src/lib/backup-snapshot.ts#L91) checks transitions within event groups but does not require the final known status to equal `application.status`. An isolated import changed an exported record’s status from `APPLIED` to `OFFER` while retaining only its initial `APPLIED` event. Import returned **201**; the dashboard then reported that record’s history as incomplete.

**Impact:** A backup can create internally inconsistent application history, reducing the reliability of history coverage and status based analytics.

**Fix and verification:** When a snapshot has a complete typed history, require its final transition to match the saved status. Preserve the existing treatment of genuinely incomplete legacy history where necessary. Add an API rejection case for the mismatch and a round trip case for valid history.

### 3. Low — Smoke suite is out of sync with routing

[The smoke test](scripts/smoke-test.mjs#L28) expects `/login` and `/dashboard` to return 404. [The catchall route](src/app/[...slug]/page.tsx#L3) redirects unmatched pages to `/dashboard`, and `/dashboard` is a real route. The suite stopped at `/login`: **expected 404, received 307**.

**Impact:** The smoke check cannot currently validate its later CRUD and persistence assertions.

**Fix and verification:** Update the route assertions to reflect the intended current behavior, then run the full isolated smoke suite. Keep its later data assertions intact.

## Risk inferred from source review

**Low — Settings restore can finish partially.** [Settings are applied one operation at a time](src/lib/backup-settings.ts#L31). A browser storage write can fail after earlier preferences have changed; [the import flow](src/hooks/use-application-backup.ts#L104) then reports that settings could not be restored. This was **not reproduced in a browser**. A fix would validate and stage settings before applying them, with an explicit recovery path for storage failures; verify with a focused storage failure test.

## Remaining gaps

The smoke suite’s later assertions remain unverified until its route expectations are corrected. Browser accessibility, keyboard, responsive, theme, and motion behavior was assessed from source only, as browser tests were not requested. The 5,000 record scale check measures duplicate matching, not a full 5,000 record database import or dashboard response time.
