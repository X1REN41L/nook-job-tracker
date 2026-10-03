import { useEffect, useRef, useState } from "react";
import type { StagedApplication } from "@/lib/backup-staging";
import type { DuplicateMatch } from "@/lib/duplicate-match";
import type { ApplicationSummary, JobFormState } from "@/types/application";

type PendingImport = { generation: number; token: string; records: StagedApplication[]; index: number; after: number; total: number };

export function useApplicationBackup({ insertApplications, onDuplicate, showToast }: {
  insertApplications: (token: string) => Promise<{ created: number; skipped: number }>;
  onDuplicate: (candidate: JobFormState, match: DuplicateMatch<ApplicationSummary>) => void;
  showToast: (message: string) => void;
}) {
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const importInFlight = useRef(false);
  const exportInFlight = useRef(false);
  const upload = useRef<AbortController | null>(null);
  const session = useRef<string | null>(null);
  const cancellation = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const mounted = useRef(true);
  const toast = useRef(showToast);
  toast.current = showToast;
  const commit = useRef(insertApplications);
  commit.current = insertApplications;
  useEffect(() => {
    mounted.current = true;
    const retainedToken = sessionStorage.getItem("nook-backup-commit");
    if (retainedToken) void (async () => {
      try {
        const response = await fetch(`/api/applications/import/${retainedToken}?status=1`);
        const outcome = await response.json();
        if (!mounted.current) return;
        if (outcome.state === "complete") {
          const result = await commit.current(retainedToken);
          sessionStorage.removeItem("nook-backup-commit");
          toast.current(`Imported ${result.created} applications; skipped ${result.skipped}; settings restored`);
        } else if (outcome.state === "committing") toast.current("The backup is still importing. Reload shortly to check its result.");
        else {
          sessionStorage.removeItem("nook-backup-commit");
          toast.current(outcome.error ?? "The previous import result has expired. Check your applications before importing again.");
        }
      } catch { toast.current("Could not reconnect to the previous import. Reload to check its result."); }
    })();
    return () => {
      mounted.current = false;
      upload.current?.abort();
      if (session.current) void cancelSession(session.current);
    };
  }, []);

  async function exportApplications() {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    try {
      const response = await fetch("/api/applications/export", { method: "POST", headers: { "Content-Type": "application/json" } });
      const prepared = await response.json();
      if (!response.ok) throw new Error(prepared.error ?? "Could not prepare the export");
      const link = document.createElement("a");
      link.href = `/api/applications/export?token=${prepared.token}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast(`Prepared ${prepared.applications} applications and settings; download requested`);
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not export the backup"); }
    finally { exportInFlight.current = false; }
  }

  async function importApplications(file: File) {
    if (importInFlight.current) return null;
    importInFlight.current = true;
    const selectedGeneration = ++generation.current;
    const controller = new AbortController();
    upload.current = controller;
    setImportProgress({ current: 0, total: 1 });
    try {
      await cancellation.current;
      if (generation.current !== selectedGeneration) return null;
      const response = await fetch("/api/applications/import/upload", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: file, signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not validate the backup");
      if (!mounted.current || generation.current !== selectedGeneration) { await cancelSession(body.token); return null; }
      session.current = body.token;
      void continueImport({ generation: selectedGeneration, token: body.token, records: [], index: 0, after: -1, total: body.applications });
      return null;
    } catch (error) {
      if (generation.current !== selectedGeneration) return null;
      setImportProgress(null);
      importInFlight.current = false;
      return error instanceof Error ? error.message : "Could not upload the backup";
    } finally { if (upload.current === controller) upload.current = null; }
  }

  async function continueImport(pending: PendingImport, allowCurrentDuplicate = false) {
    let next = pending;
    let awaitingDuplicateDecision = false;
    let commitStarted = false;
    setPendingImport(next);
    try {
      while (session.current === next.token && mounted.current) {
        if (next.index >= next.records.length) {
          const response = await fetch(`/api/applications/import/${next.token}?after=${next.after}`);
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "Could not read the staged backup");
          if (session.current !== next.token || !mounted.current) return;
          if (!body.applications.length) break;
          next = { ...next, records: body.applications, index: 0 };
        }
        const record = next.records[next.index];
        const candidate: JobFormState = {
          company: record.company, role: record.role, status: record.status, source: record.source ?? "",
          appliedDate: record.appliedDate.slice(0, 10), notes: record.notes ?? "", jobUrl: record.jobUrl ?? "",
        };
        let match: DuplicateMatch<ApplicationSummary> | null = null;
        if (!allowCurrentDuplicate) {
          const response = await fetch(`/api/applications/import/${next.token}?candidate=${record.position}`);
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "Could not review duplicates");
          if (session.current !== next.token || !mounted.current) return;
          match = body.match;
        }
        allowCurrentDuplicate = false;
        if (match) {
          setImportProgress(null);
          setPendingImport(next);
          onDuplicate(candidate, match);
          awaitingDuplicateDecision = true;
          return;
        }
        next = { ...next, index: next.index + 1, after: record.position };
        setImportProgress({ current: record.position + 1, total: next.total });
      }
      if (session.current !== next.token || !mounted.current) return;
      commitStarted = true;
      sessionStorage.setItem("nook-backup-commit", next.token);
      const result = await insertApplications(next.token);
      sessionStorage.removeItem("nook-backup-commit");
      session.current = null;
      showToast(`Imported ${result.created} applications; skipped ${result.skipped}; settings restored`);
    } catch (caught) {
      if (generation.current === next.generation) showToast(`${commitStarted ? "Import result" : "Import failed"}: ${caught instanceof Error ? caught.message : "Could not import the backup"}${commitStarted ? " Reload to check the retained result." : ""}`);
    } finally {
      if (!awaitingDuplicateDecision) {
        if (session.current === next.token) { session.current = null; await cancelSession(next.token); }
        if (generation.current === next.generation) {
          if (mounted.current) { setImportProgress(null); setPendingImport(null); }
          importInFlight.current = false;
        }
      }
    }
  }

  function resumeImportAllowDuplicate() { return pendingImport ? continueImport(pendingImport, true) : Promise.resolve(); }
  function abandonImport() {
    generation.current++;
    upload.current?.abort();
    if (session.current) { cancellation.current = cancelSession(session.current); session.current = null; }
    setImportProgress(null);
    setPendingImport(null);
    importInFlight.current = false;
  }
  function cancelImport() {
    abandonImport();
    showToast("Import cancelled; no applications were added");
  }
  return { importProgress, hasPendingImport: pendingImport !== null, exportApplications, importApplications, resumeImportAllowDuplicate, cancelImport, abandonImport };
}

async function cancelSession(token: string) {
  try { await fetch(`/api/applications/import/${token}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, keepalive: true }); }
  catch { /* Abandoned review sessions also expire on the server. */ }
}
