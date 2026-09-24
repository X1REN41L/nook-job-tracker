import { useRef, useState } from "react";
import type { JobFormState } from "@/components/job-modal";
import { currentLocalDate } from "@/lib/application-date";
import { backupSnapshotSchema, type BackupSnapshot } from "@/lib/backup-snapshot";
import { applyBackupSettings, readBackupSettings } from "@/lib/backup-settings";
import { normalizeDuplicateText, type DuplicateMatch } from "@/lib/duplicate-match";
import { ImportDuplicateIndex } from "@/lib/import-duplicate-index";
import type { ApplicationRecord } from "@/types/application";

type RecordSnapshot = BackupSnapshot["applications"][number];
type CompanyGroup = ImportDuplicateIndex<ApplicationRecord>;
type PendingImport = { records: RecordSnapshot[]; index: number; groups: Map<string, CompanyGroup>; ids: Set<string>; settings: BackupSnapshot["settings"] };
const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function useApplicationBackup({ applications, insertApplications, onDuplicate, showToast, theme, setTheme }: {
  applications: ApplicationRecord[];
  insertApplications: (backup: BackupSnapshot) => Promise<{ created: ApplicationRecord[]; skippedIds: string[] }>;
  onDuplicate: (candidate: JobFormState, match: DuplicateMatch<ApplicationRecord>) => void;
  showToast: (message: string) => void;
  theme: string | undefined;
  setTheme: (theme: string) => void;
}) {
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const importInFlight = useRef(false);

  async function exportApplications() {
    try {
      const response = await fetch("/api/applications/export");
      if (!response.ok) throw new Error();
      const backup = { ...await response.json(), settings: readBackupSettings(theme) };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nook-export-${currentLocalDate()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      showToast(`Exported ${backup.applications.length} applications and settings as JSON`);
    } catch { showToast("Could not export the backup"); }
  }

  async function importApplications(file: File) {
    if (importInFlight.current) return null;
    importInFlight.current = true;
    let contents: unknown;
    try { contents = JSON.parse(await file.text()); }
    catch { importInFlight.current = false; return "Choose a valid JSON backup file."; }
    const parsed = backupSnapshotSchema.safeParse(contents);
    if (!parsed.success) { importInFlight.current = false; return "Unsupported or invalid Nook version 2 backup."; }
    const groups = new Map<string, CompanyGroup>();
    for (const item of applications) {
      const key = normalizeDuplicateText(item.company);
      const group = groups.get(key) ?? new ImportDuplicateIndex<ApplicationRecord>();
      group.add(item);
      groups.set(key, group);
    }
    const backup = contents as BackupSnapshot;
    void continueImport({ records: backup.applications, index: 0, groups, ids: new Set(applications.map((item) => item.id)), settings: backup.settings });
    return null;
  }

  async function continueImport(pending: PendingImport, allowCurrentDuplicate = false) {
    let next = pending;
    let awaitingDuplicateDecision = false;
    setPendingImport(next);
    try {
      while (next.index < next.records.length) {
        const record = next.records[next.index];
        const key = normalizeDuplicateText(record.company);
        const group = next.groups.get(key) ?? new ImportDuplicateIndex<ApplicationRecord>();
        const candidate: JobFormState = {
          company: record.company, role: record.role, status: record.status, source: record.source ?? "",
          appliedDate: record.appliedDate.slice(0, 10), interviewDate: record.interviewDate?.slice(0, 10) ?? "",
          notes: record.notes ?? "", jobUrl: record.jobUrl ?? "",
        };
        const match = next.ids.has(record.id) || allowCurrentDuplicate ? null : group.find(record.role);
        allowCurrentDuplicate = false;
        if (match) {
          setImportProgress(null);
          setPendingImport(next);
          onDuplicate(candidate, match);
          awaitingDuplicateDecision = true;
          return;
        }
        if (!next.ids.has(record.id)) {
          group.add(record as ApplicationRecord);
          next.groups.set(key, group);
          next.ids.add(record.id);
        }
        next = { ...next, index: next.index + 1 };
        if (next.index % 10 === 0) {
          setImportProgress({ current: next.index, total: next.records.length });
          await yieldToUI();
        }
      }
      setImportProgress({ current: next.records.length, total: next.records.length });
      const result = await insertApplications({ version: 2, applications: next.records, settings: next.settings });
      try {
        applyBackupSettings(next.settings, setTheme);
        showToast(`Imported ${result.created.length} applications; skipped ${result.skippedIds.length}; settings restored`);
      } catch {
        showToast(`Imported ${result.created.length} applications; skipped ${result.skippedIds.length}; settings could not be restored`);
      }
    } catch (caught) {
      showToast(`Import failed: ${caught instanceof Error ? caught.message : "Could not import the backup"}`);
    } finally {
      if (!awaitingDuplicateDecision) {
        setImportProgress(null);
        setPendingImport(null);
        importInFlight.current = false;
      }
    }
  }

  function resumeImportAllowDuplicate() { return pendingImport ? continueImport(pendingImport, true) : Promise.resolve(); }
  function cancelImport() {
    if (!pendingImport) return;
    showToast("Import cancelled; no applications were added");
    setPendingImport(null);
    importInFlight.current = false;
  }
  function abandonImport() { setPendingImport(null); importInFlight.current = false; }
  return { importProgress, hasPendingImport: pendingImport !== null, exportApplications, importApplications, resumeImportAllowDuplicate, cancelImport, abandonImport };
}
