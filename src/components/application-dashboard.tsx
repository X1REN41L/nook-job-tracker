"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { InterviewType, Status } from "@prisma/client";
import { FormEvent, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { ApplicationDetailPanel } from "@/components/application-detail-panel";
import type { ApplicationChange } from "@/components/application-detail-sections";
import { ApplicationSidebar } from "@/components/application-sidebar";
import { ApplicationsTable } from "@/components/applications-table";
import { BoardToolbar, DEFAULT_BOARD_FILTERS, isBoardFiltered, type BoardFilters } from "@/components/board-toolbar";
import { CommandPalette, type PaletteCommand } from "@/components/command-palette";
import { KanbanBoard, KanbanCardOverlay } from "@/components/kanban-board";
import { DeleteDialog } from "@/components/delete-dialog";
import { DuplicateWarningDialog } from "@/components/duplicate-warning-dialog";
import { InterviewDateDialog } from "@/components/interview-date-dialog";
import { MotionPresence } from "@/components/motion-presence";
import { InterviewsList } from "@/components/interviews-list";
import { DashboardOverview } from "@/components/dashboard-overview";
import { DashboardAnalytics } from "@/components/dashboard-analytics";
import { JobModal } from "@/components/job-modal";
import { SettingsModal } from "@/components/settings-modal";
import { ShortcutOverlay } from "@/components/shortcut-overlay";
import { useApplicationBackup } from "@/hooks/use-application-backup";
import { ARCHIVED_DROP_ID, SIDEBAR_EDGE_DROP_ID, useBoardDrag } from "@/hooks/use-board-drag";
import { useDashboardShortcuts } from "@/hooks/use-dashboard-shortcuts";
import { useScrollbarActivity } from "@/hooks/use-scrollbar-activity";
import { useStaleApplications } from "@/hooks/use-stale-applications";
import { useToastUndo, type StatusUndo, type ToastUndo } from "@/hooks/use-toast-undo";
import { useSettings } from "@/hooks/use-settings";
import { useSettingsUpdate } from "@/hooks/use-settings-update";
import { currentLocalDate, currentLocalMinute } from "@/lib/application-date";
import { applicationSources, compareApplications, DEFAULT_APPLICATION_FILTERS, matchesApplicationSearch, matchesBoardStatusFilter, type ApplicationFilters } from "@/lib/application-list";
import { subscribeToLocalDate, subscribeToLocalMinute } from "@/lib/local-date-subscription";
import { setSettingsState } from "@/lib/settings-store";
import { BOARDS, BOARD_STATUSES, boardLabel } from "@/lib/board-preferences";
import { isInProgressApplication } from "@/lib/status-values";
import { applicationApiPath } from "@/lib/application-api-path";
import { applicationInputSchema, interviewDateSchema } from "@/lib/application-schema";
import { findPossibleDuplicate, type DuplicateMatch } from "@/lib/duplicate-match";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { fetchApplicationSummaries, readApplicationResponse } from "@/lib/application-pages";
import { getInterviewListItems, getUpcomingInterviewCount, hasUpcomingInterview } from "@/lib/interviews";
import type { ApplicationRecord, ApplicationSummary, JobFormState } from "@/types/application";
import type { StaleApplication } from "@/types/dashboard";
import type { ApplicationPageName, DashboardSection } from "@/types/navigation";

const blankForm = (): JobFormState => ({ company: "", role: "", status: Status.APPLIED, source: "", appliedDate: currentLocalDate(), notes: "", jobUrl: "" });
type DragSource = "board" | "archived";
const SIDEBAR_WIDTH_KEY = "nook-sidebar-width";
const SIDEBAR_WIDTH_EVENT = "nook-sidebar-width-change";
const DEFAULT_SIDEBAR_WIDTH = 320;
// Just wide enough for the logo row to show the whole motto: 8px gutter + 36px logo + 12px gap
// + 187px "Nook your job search, kept tidy" + 42px room for the collapse toggle + 8px gutter + 1px border.
const MIN_SIDEBAR_WIDTH = 294;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_COLLAPSE_THRESHOLD = 180;
const SIDEBAR_REOPEN_THRESHOLD = 80;
type MoveResult = "moved" | "unchanged" | "busy" | "conflict" | "failed";
// A possible duplicate found while adding (or importing) a job, or while editing an application's details.
// A details edit waits on `resolve` for the choice to save anyway.
type PendingDuplicate =
  | { kind: "add"; candidate: JobFormState; match: DuplicateMatch<ApplicationSummary> }
  | { kind: "details"; match: DuplicateMatch<ApplicationSummary>; resolve: (saveAnyway: boolean) => void };

function subscribeToSidebarPreference(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(SIDEBAR_WIDTH_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(SIDEBAR_WIDTH_EVENT, onStoreChange);
  };
}


function getSidebarWidth() {
  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (saved === null) return DEFAULT_SIDEBAR_WIDTH;
    const width = Number(saved);
    return Number.isFinite(width) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)) : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}


function getServerLocalDate() {
  return "";
}

export function ApplicationDashboard({ initialApplications, page, dashboardSection = "overview", tableFilters = DEFAULT_APPLICATION_FILTERS }: {
  initialApplications: ApplicationSummary[];
  page: ApplicationPageName;
  dashboardSection?: DashboardSection;
  tableFilters?: ApplicationFilters;
}) {
  const router = useRouter();
  const boardScrollRef = useScrollbarActivity<HTMLElement>();
  const settings = useSettings();
  const [applications, setApplications] = useState(initialApplications);
  // The latest full record a save returned, so the details panel shows its notes and contacts without reloading.
  const [latestRecord, setLatestRecord] = useState<ApplicationRecord | null>(null);
  const [form, setForm] = useState<JobFormState>(blankForm);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // One application from a card or the details panel, or several selected in the table.
  const [pendingDelete, setPendingDelete] = useState<ApplicationSummary[] | null>(null);
  const [pendingInterviewDate, setPendingInterviewDate] = useState<ApplicationSummary | null>(null);
  const [interviewDateDraft, setInterviewDateDraft] = useState("");
  const [interviewTypeDraft, setInterviewTypeDraft] = useState<InterviewType>(InterviewType.OTHER);
  const [interviewDateError, setInterviewDateError] = useState("");
  const [savingInterviewDate, setSavingInterviewDate] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // In-flight status moves per application. The ref is the guard (it is current within one render);
  // the state mirrors it for rendering.
  const movingIdsRef = useRef(new Set<string>());
  const [movingIds, setMovingIds] = useState<ReadonlySet<string>>(() => new Set());
  // Bumped once per server-confirmed change; dashboard views refetch on it, not on optimistic updates.
  const [dataRevision, setDataRevision] = useState(0);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [boardFilters, setBoardFilters] = useState<BoardFilters>(DEFAULT_BOARD_FILTERS);
  const [bulkBusy, setBulkBusy] = useState(false);
  const isMac = typeof navigator !== "undefined" && isMacPlatform();
  const sidebarCollapsed = settings.sidebarCollapsed;
  const sidebarWidth = useSyncExternalStore(subscribeToSidebarPreference, getSidebarWidth, () => DEFAULT_SIDEBAR_WIDTH);
  const archivedExpanded = settings.archivedExpanded;
  const today = useSyncExternalStore(subscribeToLocalDate, currentLocalDate, getServerLocalDate);
  // Interviews move from upcoming to past during the day, so they follow the clock to the minute.
  const now = useSyncExternalStore(subscribeToLocalMinute, currentLocalMinute, getServerLocalDate);
  const { toast, deleteRecovery, undoing, showToast, clearApplicationUndo, pauseToastDismissTimer, endToastInteraction, resumeUndoToastOnTab, undoLatestChange, dismissToast } = useToastUndo({ onUndo: restoreLatestChange });
  const saveSettings = useSettingsUpdate(showToast);
  const lastToastRef = useRef(toast);
  // A move that asks for an interview date offers its Undo once the prompt is done.
  const promptedMoveUndo = useRef<{ message: string; undo: StatusUndo } | null>(null);
  if (toast) lastToastRef.current = toast;
  const visibleToast = toast ?? lastToastRef.current;
  const { importProgress, hasPendingImport, exportApplications, importApplications, resumeImportAllowDuplicate, cancelImport, abandonImport } = useApplicationBackup({
    insertApplications,
    onDuplicate: (candidate, match) => setPendingDuplicate({ kind: "add", candidate, match }),
    showToast,
  });
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const boardHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const boardSearchRef = useRef<HTMLInputElement | null>(null);
  const focusExpandOnCollapseRef = useRef(false);
  const interviewSearchRef = useRef<HTMLInputElement | null>(null);
  const tableSearchRef = useRef<HTMLInputElement | null>(null);
  const shortcutTriggerRef = useRef<HTMLElement | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const submissionInFlight = useRef(false);
  const dndContextId = useId();
  const { activeId, temporarilyExpanded, sensors, collisionDetection, autoScroll, onDragStart, onDragMove, onDragEnd, onDragCancel } = useBoardDrag({
    sidebarCollapsed,
    onDrop: handleDrop,
  });
  const effectiveSidebarCollapsed = sidebarCollapsed && !temporarilyExpanded;
  // Loaded on every page: the board, the Table and the Archived list tag stale applications, and the Table's Needs attention filter uses them.
  const stale = useStaleApplications(today, dataRevision);
  const staleData = stale.data;
  const staleById = new Map<string, StaleApplication>(staleData
    ? [...staleData.applicationsBySeverity.CRITICAL, ...staleData.applicationsBySeverity.HIGH, ...staleData.applicationsBySeverity.MEDIUM, ...staleData.archived].map((item) => [item.id, item])
    : []);
  const staleDays = new Map([...staleById].map(([id, item]) => [id, item.staleDays]));
  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  function reconcileApplications(update: (current: ApplicationSummary[]) => ApplicationSummary[]) {
    setApplications(update);
    setDataRevision((revision) => revision + 1);
  }

  /** Shows the server's saved version of one application in place of the one on screen. */
  function replaceApplication(record: ApplicationRecord) {
    reconcileApplications((current) => current.map((item) => item.id === record.id ? record : item));
    setLatestRecord(record);
  }

  function beginMove(applicationId: string) {
    if (movingIdsRef.current.has(applicationId)) return false;
    movingIdsRef.current.add(applicationId);
    setMovingIds(new Set(movingIdsRef.current));
    return true;
  }

  function endMove(applicationId: string) {
    movingIdsRef.current.delete(applicationId);
    setMovingIds(new Set(movingIdsRef.current));
  }

  function setSidebarCollapsed(nextCollapsed: boolean) {
    if (nextCollapsed) {
      const active = document.activeElement;
      if (active?.closest(".sidebar-content, .sidebar-resize-handle")) focusExpandOnCollapseRef.current = true;
    }
    saveSettings({ sidebarCollapsed: nextCollapsed });
  }

  function toggleSidebar() {
    if (!sidebarCollapsed) {
      const active = document.activeElement;
      if (active?.closest(".sidebar-content, .sidebar-resize-handle")) focusExpandOnCollapseRef.current = true;
    }
    saveSettings((current) => ({ sidebarCollapsed: !current.sidebarCollapsed }));
  }

  function saveSidebarWidth(width: number) {
    const nextWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
      window.dispatchEvent(new Event(SIDEBAR_WIDTH_EVENT));
    } catch {
      // Keep the current width when storage is unavailable.
    }
  }

  function handleSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || window.innerWidth < 768 || !workspaceRef.current) return;
    event.preventDefault();
    resizeCleanupRef.current?.();

    const workspace = workspaceRef.current;
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    handle.setPointerCapture(pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const startedCollapsed = sidebarCollapsed;
    let currentWidth = startWidth;
    let changed = false;

    workspace.classList.add("sidebar-resizing");
    document.body.classList.add("sidebar-resizing-active");

    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      if (startedCollapsed) {
        const distanceFromLeft = pointer.clientX - workspace.getBoundingClientRect().left;
        if (distanceFromLeft <= SIDEBAR_REOPEN_THRESHOLD) return;
        cleanup();
        setSidebarCollapsed(false);
        return;
      }

      const proposed = startWidth + pointer.clientX - startX;
      currentWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, proposed));
      workspace.style.setProperty("--sidebar-drag-width", `${currentWidth}px`);
      changed = true;
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      workspace.classList.remove("sidebar-resizing");
      document.body.classList.remove("sidebar-resizing-active");
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      resizeCleanupRef.current = null;
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      cleanup();
      if (startedCollapsed) return;
      const proposed = startWidth + pointer.clientX - startX;
      if (proposed < SIDEBAR_COLLAPSE_THRESHOLD) {
        setSidebarCollapsed(true);
      } else if (changed || pointer.clientX !== startX) {
        saveSidebarWidth(proposed);
      }
      window.requestAnimationFrame(() => workspace.style.removeProperty("--sidebar-drag-width"));
    };
    const cancel = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      cleanup();
      workspace.style.removeProperty("--sidebar-drag-width");
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    resizeCleanupRef.current = cleanup;
  }

  function handleSidebarResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    saveSidebarWidth(sidebarWidth + (event.key === "ArrowRight" ? 10 : -10));
  }

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  function toggleArchived() {
    saveSettings((current) => ({ archivedExpanded: !current.archivedExpanded }));
  }

  async function insertApplications(token: string) {
    const response = await fetch("/api/applications/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await readApplicationResponse(response);
    if (!response.ok) throw new Error(body.error ?? "Could not import the applications");
    setSettingsState({ settings: body.settings, revision: body.settingsRevision });
    const refreshed = await fetchApplicationSummaries();
    reconcileApplications(() => refreshed.sort(compareApplications));
    return { created: body.created as number, skipped: body.skipped as number };
  }

  async function deleteAllApplicationData() {
    try {
      const response = await fetch("/api/applications/purge", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await readApplicationResponse(response);
      if (!response.ok) throw new Error(body.error ?? "Could not delete application data");

      reconcileApplications(() => []);
      resetForm();
      setIsModalOpen(false);
      setPendingDelete(null);
      deleteTriggerRef.current = null;
      setPendingInterviewDate(null);
      promptedMoveUndo.current = null;
      setInterviewDateDraft("");
      setInterviewDateError("");
      movingIdsRef.current.clear();
      setMovingIds(new Set());
      setBoardFilters(DEFAULT_BOARD_FILTERS);
      setDetailId(null);
      setError("");
      clearApplicationUndo();
      showToast("All application data deleted.");
      return true;
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Could not delete application data");
      return false;
    }
  }

  function updateField<K extends keyof JobFormState>(field: K, value: JobFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  function resetForm() { setForm(blankForm()); setPendingDuplicate(null); setFormError(""); }
  function openAddModal() { resetForm(); setIsModalOpen(true); }
  function closeModal() { setIsModalOpen(false); resetForm(); }
  function openDetail(application: ApplicationSummary) {
    setDetailId(application.id);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;
    setFormError("");
    const parsed = applicationInputSchema.safeParse(form);
    if (!parsed.success) { setFormError(parsed.error.issues[0]?.message ?? "Check the form and try again."); return; }
    const match = findPossibleDuplicate(form, applications);
    if (match) {
      setPendingDuplicate({ kind: "add", candidate: { ...form }, match });
      return;
    }
    await saveApplication({ ...form });
  }

  async function saveApplication(candidate: JobFormState) {
    if (submissionInFlight.current) return false;
    submissionInFlight.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate),
      });
      const body = await readApplicationResponse(response);
      if (!response.ok) throw new Error(body.error ?? "Could not save the application");
      reconcileApplications((current) => [body.application, ...current].sort(compareApplications));
      showToast(`Added ${body.application.company}`);
      closeModal();
      return true;
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Could not save the application");
      return false;
    } finally {
      submissionInFlight.current = false;
      setSaving(false);
    }
  }

  async function addDuplicateAnyway() {
    if (!pendingDuplicate || submissionInFlight.current) return;
    const pending = pendingDuplicate;
    if (pending.kind === "details") {
      setPendingDuplicate(null);
      pending.resolve(true);
      return;
    }
    if (hasPendingImport) {
      setPendingDuplicate(null);
      await resumeImportAllowDuplicate();
      return;
    }
    const saved = await saveApplication(pending.candidate);
    if (!saved) setPendingDuplicate(null);
  }

  function viewExistingDuplicate() {
    if (!pendingDuplicate || saving) return;
    if (pendingDuplicate.kind === "details") pendingDuplicate.resolve(false);
    else if (hasPendingImport) {
      abandonImport();
      setPendingDuplicate(null);
      showToast("Import cancelled; no applications were added");
      return;
    }
    const existing = applications.find(({ id }) => id === pendingDuplicate.match.application.id) ?? pendingDuplicate.match.application;
    setPendingDuplicate(null);
    closeModal();
    openDetail(existing);
  }

  function requestDelete(application: ApplicationSummary, trigger: HTMLElement | null) {
    deleteTriggerRef.current = trigger;
    setPendingDelete([{ ...application }]);
  }

  function requestBulkDelete(targets: ApplicationSummary[], trigger: HTMLElement | null) {
    if (!targets.length) return;
    deleteTriggerRef.current = trigger;
    setPendingDelete(targets.map((application) => ({ ...application })));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.length > 1) {
      await confirmBulkDelete(pendingDelete);
      return;
    }
    const [deletedApplication] = pendingDelete;
    setError("");
    setDeleting(true);
    try {
      const response = await fetch(`${applicationApiPath(deletedApplication.id)}?undoable=1`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: deletedApplication.revision }),
      });
      const body = await readApplicationResponse(response);
      if (response.status === 409 && body.application) {
        replaceApplication(body.application as ApplicationRecord);
        setPendingDelete(null);
        setError("This application changed since confirmation. The latest saved version has been loaded; review it and confirm deletion again.");
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not delete the application");
      reconcileApplications((current) => current.filter((item) => item.id !== deletedApplication.id));
      if (detailId === deletedApplication.id) setDetailId(null);
      showToast(`Deleted ${deletedApplication.company}`, {
        kind: "delete",
        application: deletedApplication,
        token: body.token,
        expiresAt: body.expiresAt,
      });
      setPendingDelete(null);
      requestAnimationFrame(() => boardHeadingRef.current?.focus());
    } catch (caught) {
      setPendingDelete(null);
      setError(caught instanceof Error ? caught.message : "Could not delete the application");
    } finally {
      setDeleting(false);
    }
  }

  // One request deletes the whole selection, so it is all deleted or none of it is; one Undo restores it all.
  async function confirmBulkDelete(targets: ApplicationSummary[]) {
    if (targets.some(({ id }) => movingIdsRef.current.has(id))) {
      setError("Wait for the changes to finish saving, then try again.");
      setPendingDelete(null);
      return;
    }
    setError("");
    setDeleting(true);
    try {
      const response = await fetch("/api/applications/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applications: targets.map(({ id, revision }) => ({ id, revision })) }),
      });
      const body = await readApplicationResponse(response);
      if (response.status === 409 && Array.isArray(body.applications)) {
        for (const application of body.applications) replaceApplication(application as ApplicationRecord);
        setPendingDelete(null);
        setError("Applications changed since confirmation. The latest saved versions have been loaded; review them and confirm deletion again. Nothing was deleted.");
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not delete the applications");
      const deletedIds = new Set<string>(body.deletedIds);
      reconcileApplications((current) => current.filter((item) => !deletedIds.has(item.id)));
      if (detailId && deletedIds.has(detailId)) setDetailId(null);
      // Applications already deleted elsewhere count as done; only the ones this delete removed come back on Undo.
      const count = targets.length;
      showToast(`Deleted ${count} ${count === 1 ? "application" : "applications"}`, deletedIds.size
        ? { kind: "delete-batch", applications: targets.filter(({ id }) => deletedIds.has(id)), token: body.token, expiresAt: body.expiresAt }
        : undefined);
      setPendingDelete(null);
      requestAnimationFrame(() => tableSearchRef.current?.focus());
    } catch (caught) {
      setPendingDelete(null);
      setError(caught instanceof Error ? `${caught.message}. Nothing was deleted.` : "Could not delete the applications. Nothing was deleted.");
    } finally {
      setDeleting(false);
    }
  }

  async function moveApplication(
    application: ApplicationSummary,
    status: Status,
    offerUndo = true,
    restoration?: Pick<ApplicationSummary, "interviewDatePromptDismissed">,
    archived = application.archived,
    // Collects undo entries for a bulk change instead of offering one toast per application.
    batch?: StatusUndo[],
  ): Promise<MoveResult> {
    // Checked before the no-op test: an in-flight move has already applied its optimistic state.
    if (movingIdsRef.current.has(application.id)) {
      if (offerUndo) showToast(`${application.company} is still being updated. Try again in a moment.`);
      return "busy";
    }
    if (application.status === status && application.archived === archived) return "unchanged";
    const previousStatus = application.status;
    const previousArchived = application.archived;
    const previousInterviewDatePromptDismissed = application.interviewDatePromptDismissed;
    setError("");
    beginMove(application.id);
    setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status, archived, ...restoration } : item));
    try {
      const response = await fetch(applicationApiPath(application.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(status === previousStatus && archived !== previousArchived
          ? { revision: application.revision, archived }
          : {
              revision: application.revision,
              status,
              ...(archived !== previousArchived && { archived }),
              ...(restoration && {
                interviewDatePromptDismissed: restoration.interviewDatePromptDismissed,
              }),
            }),
      });
      const body = await readApplicationResponse(response);
      if (response.status === 409 && body.application) {
        replaceApplication(body.application as ApplicationRecord);
        // Undo (offerUndo false) and bulk changes report the conflict themselves.
        if (offerUndo && !batch) setError("This application changed elsewhere. The latest saved version has been loaded; try your action again.");
        return "conflict";
      }
      if (!response.ok) throw new Error(body.error ?? "Could not update the application status");
      replaceApplication(body.application as ApplicationRecord);
      const undo: StatusUndo = { kind: "status", applicationId: application.id, status: previousStatus, archived: previousArchived, interviewDatePromptDismissed: previousInterviewDatePromptDismissed, expectedLatestStatusEventId: body.latestStatusEventId ?? null, movedRevision: body.application.revision };
      const asksForDate = !batch && !restoration && previousStatus !== Status.INTERVIEW && needsInterviewPrompt(body.application);
      if (batch) {
        batch.push(undo);
      } else if (offerUndo) {
        const message = previousArchived !== archived
          ? `${archived ? "Archived" : "Restored"} ${application.company}`
          : `${application.company} moved from ${boardLabel(BOARDS, previousStatus)} to ${boardLabel(BOARDS, status)}`;
        if (asksForDate) {
          // Any earlier toast steps aside; this move's Undo waits until the date is given or skipped.
          dismissToast();
          promptedMoveUndo.current = { message, undo };
        } else {
          showToast(message, undo);
        }
      }
      if (asksForDate) openInterviewDatePrompt(body.application);
      return "moved";
    } catch (caught) {
      if (!batch) setError(caught instanceof Error ? caught.message : "Could not update the application status");
      setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status: previousStatus, archived: previousArchived, interviewDatePromptDismissed: previousInterviewDatePromptDismissed } : item));
      if (!offerUndo) throw caught;
      return "failed";
    } finally {
      endMove(application.id);
    }
  }

  // Bulk changes send one request per application, so each keeps its own revision check and status history.
  async function bulkMove(targets: ApplicationSummary[], change: { status: Status } | { archived: boolean }) {
    const undo: StatusUndo[] = [];
    let failed = 0;
    setError("");
    setBulkBusy(true);
    try {
      for (const application of targets) {
        const status = "status" in change ? change.status : application.status;
        const archived = "archived" in change ? change.archived : application.archived;
        const result = await moveApplication(application, status, true, undefined, archived, undo);
        if (result !== "moved" && result !== "unchanged") failed += 1;
      }
    } finally {
      setBulkBusy(false);
    }
    const moved = undo.length;
    const noun = moved === 1 ? "application" : "applications";
    const summary = moved === 0 && failed === 0
      ? "Nothing to change"
      : "status" in change
        ? `Moved ${moved} ${noun} to ${boardLabel(BOARDS, change.status)}`
        : `${change.archived ? "Archived" : "Restored"} ${moved} ${noun}`;
    const problems = failed ? `. ${failed} could not be updated because ${failed === 1 ? "it" : "they"} changed elsewhere or ${failed === 1 ? "was" : "were"} busy.` : "";
    showToast(`${summary}${problems}`, moved ? { kind: "batch", items: undo } : undefined);
  }

  // Moving to Interview asks for the first round unless one is already scheduled or the prompt was skipped.
  function needsInterviewPrompt(application: ApplicationSummary) {
    return application.status === Status.INTERVIEW && !application.interviewDatePromptDismissed && !hasUpcomingInterview(application, currentLocalMinute());
  }

  function openInterviewDatePrompt(application: ApplicationSummary) {
    setInterviewDateDraft(currentLocalDate());
    setInterviewTypeDraft(InterviewType.OTHER);
    setInterviewDateError("");
    setPendingInterviewDate(application);
  }

  /**
   * Closes the interview date prompt and offers the Undo for the move that opened it. `saved` is the revision
   * change from saving a date or skipping, with the round a saved date added. The save belongs to the move, so
   * Undo still reverts the move after it and removes that round.
   */
  function closeInterviewDatePrompt(saved?: { from: number; to: number; interviewId?: string }) {
    setPendingInterviewDate(null);
    const prompted = promptedMoveUndo.current;
    promptedMoveUndo.current = null;
    if (!prompted) return;
    const undo = saved && saved.from === prompted.undo.movedRevision
      ? { ...prompted.undo, movedRevision: saved.to, ...(saved.interviewId && { promptInterviewId: saved.interviewId }) }
      : prompted.undo;
    showToast(prompted.message, undo);
  }

  /**
   * Saves one change to an application: its details (PUT, after a duplicate check), its follow-up (PATCH), or an
   * interview round, contact, dated note, or status change. Each request carries the application's revision.
   * Returns an error message, or null once saved.
   */
  async function saveApplicationChange(application: ApplicationSummary, change: ApplicationChange) {
    if (change.kind === "details") {
      const match = findPossibleDuplicate(change.fields, applications, application.id);
      // An empty message keeps the form open without an error when the user decides not to save.
      if (match && !await new Promise<boolean>((resolve) => setPendingDuplicate({ kind: "details", match, resolve }))) return "";
    }
    try {
      const response = change.kind === "follow-up"
        ? await fetch(applicationApiPath(application.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: application.revision, followUpDate: change.followUpDate, followUpNote: change.followUpNote }),
        })
        : change.kind === "details"
        ? await fetch(applicationApiPath(application.id), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...change.fields, revision: application.revision }),
        })
        : await fetch(applicationApiPath(application.id, change.collection, change.itemId), {
          method: change.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...change.fields, revision: application.revision }),
        });
      const body = await readApplicationResponse(response);
      if (response.status === 409 && body.application) {
        replaceApplication(body.application as ApplicationRecord);
        return "This application changed elsewhere. The latest version is loaded; review it and try again.";
      }
      if (!response.ok) return (body.issues?.[0]?.message as string | undefined) ?? body.error ?? "Could not save the change";
      replaceApplication(body.application as ApplicationRecord);
      return null;
    } catch {
      return "Could not save the change";
    }
  }

  async function saveInterviewDate(skip: boolean) {
    if (!pendingInterviewDate || savingInterviewDate) return;
    const parsed = skip ? null : interviewDateSchema.safeParse(interviewDateDraft);
    if (!skip && !parsed?.success) {
      setInterviewDateError(parsed?.error.issues[0]?.message ?? "Enter a valid interview date");
      return;
    }
    setSavingInterviewDate(true);
    setInterviewDateError("");
    try {
      const response = skip
        ? await fetch(applicationApiPath(pendingInterviewDate.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: pendingInterviewDate.revision, status: Status.INTERVIEW, interviewDatePromptDismissed: true }),
        })
        : await fetch(applicationApiPath(pendingInterviewDate.id, "interviews"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: pendingInterviewDate.revision, date: interviewDateDraft, type: interviewTypeDraft }),
        });
      const body = await readApplicationResponse(response);
      if (response.status === 409 && body.application) {
        const latest = body.application as ApplicationRecord;
        replaceApplication(latest);
        setPendingInterviewDate(latest);
        setInterviewDateError("This application changed elsewhere. The latest version has been loaded; your date is still here. Review it and save again.");
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not update the interview date");
      const saved = body.application as ApplicationRecord;
      replaceApplication(saved);
      const earlierRounds = new Set(pendingInterviewDate.interviews.map(({ id }) => id));
      closeInterviewDatePrompt({
        from: pendingInterviewDate.revision,
        to: saved.revision,
        interviewId: saved.interviews.find(({ id }) => !earlierRounds.has(id))?.id,
      });
    } catch (caught) {
      setInterviewDateError(caught instanceof Error ? caught.message : "Could not update the interview date");
    } finally {
      setSavingInterviewDate(false);
    }
  }

  function focusKanbanCard(applicationId: string) {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-kanban-card-id="${applicationId}"]`)?.focus();
    });
  }

  async function undoStatusChange(undo: StatusUndo) {
    const application = applications.find(({ id }) => id === undo.applicationId);
    if (!application) return null;
    // Throwing re-offers the Undo toast (useToastUndo), so an undo that did not run is never consumed.
    const busyMessage = `${application.company} is still being updated. Try Undo again in a moment.`;
    if (undo.expectedLatestStatusEventId) {
      if (!beginMove(application.id)) throw new Error(busyMessage);
      // Like a move, Undo shows its result at once and puts the application back if the server refuses.
      const restored = { status: undo.status, archived: undo.archived, interviewDatePromptDismissed: undo.interviewDatePromptDismissed };
      const before = { status: application.status, archived: application.archived, interviewDatePromptDismissed: application.interviewDatePromptDismissed, interviews: application.interviews };
      setApplications((current) => current.map((item) => item.id === application.id
        ? { ...item, ...restored, interviews: item.interviews.filter(({ id }) => id !== undo.promptInterviewId) }
        : item));
      let settled = false;
      try {
        const response = await fetch(applicationApiPath(application.id, "undo-status"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: undo.movedRevision,
            expectedLatestStatusEventId: undo.expectedLatestStatusEventId,
            archived: undo.archived,
            interviewDatePromptDismissed: undo.interviewDatePromptDismissed,
            ...(undo.promptInterviewId && { promptInterviewId: undo.promptInterviewId }),
          }),
        });
        const body = await readApplicationResponse(response);
        if (response.status === 409 && body.application) {
          settled = true;
          replaceApplication(body.application as ApplicationRecord);
          throw new Error("This application changed elsewhere. The latest saved version has been loaded; review it before trying again.");
        }
        if (!response.ok) throw new Error(body.error ?? "Could not undo the status move");
        settled = true;
        replaceApplication(body.application as ApplicationRecord);
      } finally {
        if (!settled) setApplications((current) => current.map((item) => item.id === application.id ? { ...item, ...before } : item));
        endMove(application.id);
      }
    } else {
      const result = await moveApplication(application, undo.status, false, {
        interviewDatePromptDismissed: undo.interviewDatePromptDismissed,
      }, undo.archived);
      if (result === "busy") throw new Error(busyMessage);
      if (result === "conflict") throw new Error("This application changed elsewhere. The latest saved version has been loaded; review it before trying again.");
    }
    return application;
  }

  async function restoreLatestChange(undo: ToastUndo, restoreKeyboardFocus: boolean) {
    setPendingInterviewDate(null);
    promptedMoveUndo.current = null;
    if (undo.kind === "status") {
      const application = await undoStatusChange(undo);
      if (application && restoreKeyboardFocus && (BOARD_STATUSES as readonly Status[]).includes(undo.status)) focusKanbanCard(application.id);
      return;
    }
    if (undo.kind === "batch") {
      // Every application flips back at once; the server still saves them one at a time.
      const results = await Promise.allSettled(undo.items.map((item) => undoStatusChange(item)));
      const failed = results.filter(({ status }) => status === "rejected").length;
      // Re-offering the whole batch would retry the changes that were already undone, so a partial undo only reports.
      if (failed) showToast(`Undid ${undo.items.length - failed} of ${undo.items.length} changes. The others changed elsewhere or were busy.`);
      return;
    }
    // Deleted applications come back at once from the records kept with the Undo, then take the server's saved versions.
    const deleted = undo.kind === "delete-batch" ? undo.applications : [undo.application];
    const deletedIds = new Set(deleted.map(({ id }) => id));
    const withoutDeleted = (current: ApplicationSummary[]) => current.filter(({ id }) => !deletedIds.has(id));
    setApplications((current) => [...deleted, ...withoutDeleted(current)].sort(compareApplications));
    let restored: ApplicationRecord[];
    try {
      const response = undo.kind === "delete-batch"
        ? await fetch("/api/applications/bulk-restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: undo.token, ids: [...deletedIds] }),
        })
        : await fetch(applicationApiPath(undo.application.id, "restore"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: undo.token }),
        });
      const body = await readApplicationResponse(response);
      // Nothing is restored on failure, so Undo stays offered for another try until the window ends.
      if (!response.ok) throw new Error(body.error ?? (undo.kind === "delete-batch" ? "Could not restore the applications" : "Could not restore the application"));
      restored = undo.kind === "delete-batch" ? body.applications as ApplicationRecord[] : [body.application as ApplicationRecord];
    } catch (caught) {
      setApplications(withoutDeleted);
      throw caught;
    }
    reconcileApplications((current) => [...restored, ...withoutDeleted(current)].sort(compareApplications));
    if (undo.kind === "delete-batch") {
      showToast(`Restored ${restored.length} ${restored.length === 1 ? "application" : "applications"}`);
      return;
    }
    const [application] = restored;
    showToast(`Restored ${application.company}`);
    if (restoreKeyboardFocus && (BOARD_STATUSES as readonly Status[]).includes(application.status)) focusKanbanCard(application.id);
  }

  async function handleDrop(event: DragEndEvent) {
    const dragSource = (event.active.data.current?.source as DragSource | undefined) ?? "board";
    const keyboardDrag = event.activatorEvent instanceof KeyboardEvent;
    const applicationId = String(event.active.data.current?.applicationId ?? event.active.id);
    const application = applications.find(({ id }) => id === applicationId);
    const overId = event.over?.id;
    if (!application || overId === undefined) return;
    const droppedOnArchive = overId === ARCHIVED_DROP_ID || (dragSource === "board" && overId === SIDEBAR_EDGE_DROP_ID);
    if (droppedOnArchive) {
      if (dragSource === "archived") return;
      await moveApplication(application, application.status, true, undefined, true);
      return;
    }
    const nextStatus = overId as Status;
    if ((BOARD_STATUSES as readonly Status[]).includes(nextStatus)) {
      await moveApplication(application, nextStatus, true, undefined, false);
      if (keyboardDrag) focusKanbanCard(application.id);
    }
  }

  const activeApplications = applications.filter((item) => !item.archived);
  const boardApplications = activeApplications.filter((item) => matchesBoardStatusFilter(item.status, boardFilters.status) && matchesApplicationSearch(item, boardFilters.search));
  const boardColumns = BOARDS.filter((board) => matchesBoardStatusFilter(board.status, boardFilters.status));
  const boardFiltered = isBoardFiltered(boardFilters);
  const sources = applicationSources(applications);
  const detailApplication = detailId ? applications.find(({ id }) => id === detailId) ?? null : null;
  const archivedItems = applications
    .filter((item) => item.archived)
    .sort(compareApplications);
  const interviews = getInterviewListItems(applications);
  // The server and the first render in the browser don't know the browser's clock, so the count waits for it.
  const upcomingInterviewCount = now ? getUpcomingInterviewCount(applications, now) : null;
  const activeApplication = applications.find(({ id }) => id === activeId) ?? null;

  function dropTargetLabel(id: string | number) {
    if (id === ARCHIVED_DROP_ID) return "Archived";
    if (id === SIDEBAR_EDGE_DROP_ID) return "Archive";
    return Object.values(Status).includes(id as Status) ? boardLabel(BOARDS, id as Status) : "another drop target";
  }

  function focusSearch() {
    const input = { interviews: interviewSearchRef, "job-board": boardSearchRef, table: tableSearchRef, dashboard: null }[page]?.current;
    if (!input) return false;
    input.focus();
    return true;
  }

  const firstApplicationMonth = applications.reduce<string | null>((first, application) => {
    const month = application.appliedDate.slice(0, 7);
    return first === null || month < first ? month : first;
  }, null);

  const paletteCommands: PaletteCommand[] = [
    { id: "go-overview", label: "Overview", group: "Pages", keywords: "dashboard needs attention stale", shortcut: "go-dashboard", run: () => router.push("/dashboard") },
    { id: "go-analytics", label: "Analytics", group: "Pages", keywords: "dashboard charts", shortcut: "go-analytics", run: () => router.push("/dashboard/analytics") },
    { id: "go-job-board", label: "Job Board", group: "Pages", keywords: "kanban", shortcut: "go-job-board", run: () => router.push("/jobs") },
    { id: "go-table", label: "Table", group: "Pages", keywords: "list bulk", shortcut: "go-table", run: () => router.push("/table") },
    { id: "go-interviews", label: "Interviews", group: "Pages", keywords: "calendar", shortcut: "go-interviews", run: () => router.push("/interviews") },
    { id: "new-job", label: "New job", group: "Actions", keywords: "add application", shortcut: "new-job", run: openAddModal },
    // Waits for the palette to close and hand focus back, so the search box keeps it.
    ...(page === "dashboard" ? [] : [{ id: "search", label: "Search this page", group: "Actions" as const, keywords: "find filter", shortcut: "search" as const, run: () => { window.setTimeout(focusSearch); } }]),
    { id: "toggle-sidebar", label: "Toggle sidebar", group: "Actions", keywords: "collapse expand navigation", shortcut: "toggle-sidebar", run: toggleSidebar },
    { id: "toggle-theme", label: "Toggle light / dark theme", group: "Actions", keywords: "dark light mode appearance", run: () => saveSettings({ theme: document.documentElement.classList.contains("dark") ? "light" : "dark" }) },
    { id: "open-settings", label: "Open settings", group: "Actions", keywords: "preferences theme backup", shortcut: "open-settings", run: () => setSettingsOpen(true) },
    { id: "show-shortcuts", label: "Keyboard shortcuts", group: "Actions", keywords: "keys help", shortcut: "show-shortcuts", run: openShortcuts },
  ];

  function moveApplicationFocus(direction: "up" | "down" | "left" | "right") {
    const focus = (element: HTMLElement | undefined) => {
      if (!element) return false;
      element.focus();
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      return true;
    };
    if (page !== "job-board") return false;
    const columns = Array.from(document.querySelectorAll<HTMLElement>(".board-columns .kanban-column"));
    const focused = document.activeElement?.closest<HTMLElement>("[data-kanban-card-id]");
    const columnIndex = columns.findIndex((column) => focused && column.contains(focused));
    if (direction === "up" || direction === "down") {
      if (columnIndex < 0) {
        const ordered = direction === "up" ? [...columns].reverse() : columns;
        const firstCards = Array.from(ordered.find((column) => column.querySelector("[data-kanban-card-id]"))?.querySelectorAll<HTMLElement>("[data-kanban-card-id]") ?? []);
        return focus(direction === "up" ? firstCards.at(-1) : firstCards[0]);
      }
      const column = columns[columnIndex];
      const cards = Array.from(column?.querySelectorAll<HTMLElement>("[data-kanban-card-id]") ?? []);
      const index = cards.findIndex((card) => card === focused);
      return focus(cards[index < 0 ? direction === "up" ? cards.length - 1 : 0 : index + (direction === "down" ? 1 : -1)]);
    }
    const step = direction === "right" ? 1 : -1;
    for (let index = columnIndex < 0 ? direction === "right" ? 0 : columns.length - 1 : columnIndex + step; index >= 0 && index < columns.length; index += step) {
      const cards = Array.from(columns[index].querySelectorAll<HTMLElement>("[data-kanban-card-id]"));
      if (!cards.length) continue;
      if (!focused) return focus(cards[0]);
      const center = focused.getBoundingClientRect().top + focused.getBoundingClientRect().height / 2;
      return focus(cards.reduce((nearest, card) => {
        const cardRect = card.getBoundingClientRect();
        const nearestRect = nearest.getBoundingClientRect();
        return Math.abs(cardRect.top + cardRect.height / 2 - center) < Math.abs(nearestRect.top + nearestRect.height / 2 - center) ? card : nearest;
      }));
    }
    return false;
  }

  function openShortcuts() {
    shortcutTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShortcutsOpen(true);
  }

  useDashboardShortcuts({
    isMac,
    page,
    applications,
    isModalOpen,
    hasPendingDuplicate: pendingDuplicate !== null,
    hasPendingDelete: pendingDelete !== null,
    hasPendingInterviewDate: pendingInterviewDate !== null,
    shortcutsOpen,
    settingsOpen,
    detailOpen: detailApplication !== null,
    commandPaletteOpen,
    dragActive: activeId !== null,
    canUndo: Boolean(toast?.undo || deleteRecovery),
    onResumeUndoToastOnTab: resumeUndoToastOnTab,
    onNewJob: openAddModal,
    onOpenSettings: () => setSettingsOpen(true),
    onOpenCommandPalette: () => setCommandPaletteOpen(true),
    onFocusSearch: focusSearch,
    onShowShortcuts: openShortcuts,
    onUndo: () => { void undoLatestChange(true); },
    onToggleSidebar: toggleSidebar,
    onNavigate: (path) => router.push(path),
    onMoveApplicationFocus: moveApplicationFocus,
    onSwitchInterviewTab: (tab) => {
      // Clicking selects the tab without moving focus, so ← → keep working from wherever you are.
      const button = document.querySelector<HTMLElement>(`[role="tab"][data-interview-tab="${tab}"]`);
      if (!button || button.getAttribute("aria-selected") === "true") return false;
      button.click();
      return true;
    },
    onArchiveFocused: (application) => {
      if (application.archived) return;
      void moveApplication(application, application.status, true, undefined, true);
    },
    onDeleteFocused: (application, focused) => requestDelete(application, focused),
  });

  return (
    <div className="select-none-ui flex h-screen flex-col overflow-hidden bg-cream text-ink">
      {page === "job-board" && (
        <button aria-label="Add job" className="btn-primary fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-2.5 text-base shadow-nook-lift" onClick={openAddModal} type="button">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span className="hidden sm:inline">Add job</span>
        </button>
      )}

      {/* While the application view is open, it shows the error itself. */}
      {error && !isModalOpen && !detailApplication && (
        <p className="mx-7 mt-4 rounded-nook-sm border border-rose bg-rose-tint px-4 py-3 text-sm text-ink" role="alert">
          {error}
        </p>
      )}

      <DndContext
        id={dndContextId}
        accessibility={{
          screenReaderInstructions: { draggable: "Press Enter to open. Press Space to pick up an application. For board cards, use Left and Right Arrow to move between status columns. Press Space to drop or Escape to cancel." },
          announcements: {
            onDragStart: ({ active }) => `Picked up ${active.data.current?.label}.`,
            onDragOver: ({ active, over }) => {
              if (!over || over.id === active.data.current?.status) return undefined;
              return `${active.data.current?.label} is over ${dropTargetLabel(over.id)}.`;
            },
            onDragEnd: ({ active, over }) => {
              const origin = active.data.current?.status as Status | undefined;
              return over && over.id !== origin
                ? `${active.data.current?.label} moved to ${dropTargetLabel(over.id)}.`
                : `${active.data.current?.label} was not moved.`;
            },
            onDragCancel: ({ active }) => {
              const origin = active.data.current?.status as Status | undefined;
              return origin
                ? `Movement canceled. ${active.data.current?.label} remains in ${boardLabel(BOARDS, origin)}.`
                : `Movement canceled. ${active.data.current?.label} was not moved.`;
            },
          },
        }}
        collisionDetection={collisionDetection}
        autoScroll={autoScroll}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
        onDragMove={onDragMove}
        onDragStart={onDragStart}
        sensors={sensors}
      >
        <div
          ref={workspaceRef}
          className={`app-workspace relative grid min-h-0 flex-1 overflow-hidden ${effectiveSidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}
          style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
        >
        <ApplicationSidebar
          boards={BOARDS}
          archivedItems={archivedItems}
          upcomingInterviewCount={upcomingInterviewCount}
          collapsed={effectiveSidebarCollapsed}
          width={sidebarWidth}
          minWidth={MIN_SIDEBAR_WIDTH}
          maxWidth={MAX_SIDEBAR_WIDTH}
          page={page}
          dashboardSection={dashboardSection}
          archivedExpanded={archivedExpanded}
          movingIds={movingIds}
          staleDays={staleDays}
          focusExpandOnCollapseRef={focusExpandOnCollapseRef}
          settingsTriggerRef={settingsTriggerRef}
          onToggleSidebar={toggleSidebar}
          onResizePointerDown={handleSidebarResizeStart}
          onResizeKeyDown={handleSidebarResizeKeyDown}
          onOpenArchive={() => {
            setSidebarCollapsed(false);
            if (!archivedExpanded) toggleArchived();
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleArchived={toggleArchived}
          onOpen={openDetail}
          onRequestDelete={(application, trigger) => requestDelete(application, trigger)}
          onRestore={async (application) => { await moveApplication(application, application.status, true, undefined, false); }}
        />
        <main ref={boardScrollRef} className={`board-scroll scrollbar-styled h-full min-w-0 py-6 ${page === "job-board" ? "overflow-hidden" : "overflow-auto"}`}>
          {/* Keyed by page, so each page fades in when you arrive on it. */}
          <div key={page === "dashboard" ? `dashboard-${dashboardSection}` : page} className={`page-shell motion-page-enter ${page === "job-board" ? "h-full" : ""}`}>
            {page === "job-board" ? (
              <div className="flex h-full min-h-0 flex-col">
                <BoardToolbar
                  filters={boardFilters}
                  headingRef={boardHeadingRef}
                  onChange={setBoardFilters}
                  searchInputRef={boardSearchRef}
                  shownCount={boardApplications.length}
                  totalCount={activeApplications.length}
                  activeCount={activeApplications.filter(isInProgressApplication).length}
                />
                <div className="min-h-0 flex-1">
                  <KanbanBoard
                    applications={boardApplications}
                    boards={boardColumns}
                    emptyText={boardFiltered ? "No matching applications." : undefined}
                    movingIds={movingIds}
                    now={now}
                    onOpen={openDetail}
                    staleDays={staleDays}
                    today={today}
                  />
                </div>
              </div>
            ) : page === "table" ? (
              <ApplicationsTable
                applications={applications}
                boards={BOARDS}
                bulkBusy={bulkBusy}
                initialFilters={tableFilters}
                movingIds={movingIds}
                onBulkArchive={(targets, archived) => bulkMove(targets, { archived })}
                onBulkDelete={requestBulkDelete}
                onBulkStatus={(targets, status) => bulkMove(targets, { status })}
                onOpen={openDetail}
                searchInputRef={tableSearchRef}
                staleDays={staleDays}
                today={today}
              />
            ) : page === "interviews" ? (
              <InterviewsList
                interviews={interviews}
                now={now}
                searchInputRef={interviewSearchRef}
                onOpen={(applicationId) => { const application = applications.find((item) => item.id === applicationId); if (application) openDetail(application); }}
              />
            ) : dashboardSection === "analytics" ? (
              <DashboardAnalytics firstMonth={firstApplicationMonth} refreshKey={dataRevision} today={today} />
            ) : (
              <DashboardOverview
                applications={applications}
                movingIds={movingIds}
                now={now}
                onArchive={(application) => { void moveApplication(application, application.status, true, undefined, true); }}
                onFollowUpDone={(application) => {
                  void saveApplicationChange(application, { kind: "follow-up", followUpDate: null }).then((message) => showToast(message ?? `Follow-up for ${application.company} marked done`));
                }}
                onOpen={openDetail}
                refreshKey={dataRevision}
                today={today}
              />
            )}
          </div>
        </main>

        </div>
        {activeApplication && typeof document !== "undefined"
          ? createPortal(
              <DragOverlay dropAnimation={null} zIndex={70}>
                <KanbanCardOverlay application={activeApplication} />
              </DragOverlay>,
              document.body,
            )
          : null}
      </DndContext>

      <MotionPresence open={isModalOpen && !pendingDuplicate} immediateExit={pendingDuplicate !== null || pendingDelete !== null}>
        <JobModal
          boards={BOARDS}
          error={formError}
          form={form}
          onChangeField={updateField}
          onClose={closeModal}
          onSubmit={submit}
          saving={saving}
          sourceSuggestions={sources}
        />
      </MotionPresence>

      <MotionPresence open={pendingDuplicate !== null} immediateExit>
        {pendingDuplicate && (
        <DuplicateWarningDialog
          fromImport={hasPendingImport}
          boards={BOARDS}
          editing={pendingDuplicate.kind === "details"}
          match={pendingDuplicate.match}
          onAddAnyway={() => void addDuplicateAnyway()}
          onDismiss={() => {
            if (pendingDuplicate.kind === "details") pendingDuplicate.resolve(false);
            else if (hasPendingImport) cancelImport();
            setPendingDuplicate(null);
          }}
          onViewExisting={viewExistingDuplicate}
          saving={saving}
        />
        )}
      </MotionPresence>

      <MotionPresence open={detailApplication !== null && !isModalOpen}>
        {detailApplication && (
          <ApplicationDetailPanel
            application={detailApplication}
            latestRecord={latestRecord?.id === detailApplication.id ? latestRecord : null}
            boards={BOARDS}
            busy={movingIds.has(detailApplication.id)}
            now={now}
            error={error}
            onArchive={() => { void moveApplication(detailApplication, detailApplication.status, true, undefined, !detailApplication.archived); }}
            onClose={() => { setDetailId(null); setError(""); }}
            onChangeStatus={(status) => { void moveApplication(detailApplication, status); }}
            onDelete={(trigger) => requestDelete(detailApplication, trigger)}
            onSave={(change) => saveApplicationChange(detailApplication, change)}
            sourceSuggestions={sources}
            stale={staleById.get(detailApplication.id)}
            today={today}
          />
        )}
      </MotionPresence>

      <MotionPresence open={commandPaletteOpen}>
        <CommandPalette
          applications={applications}
          boards={BOARDS}
          commands={paletteCommands}
          isMac={isMac}
          onClose={() => setCommandPaletteOpen(false)}
          onOpenApplication={openDetail}
        />
      </MotionPresence>

      <MotionPresence open={shortcutsOpen}>
        <ShortcutOverlay
          isMac={isMac}
          onClose={() => setShortcutsOpen(false)}
          returnFocusRef={shortcutTriggerRef}
        />
      </MotionPresence>

      <MotionPresence open={settingsOpen}>
        <SettingsModal
          showToast={showToast}
          isMac={isMac}
          onClose={() => setSettingsOpen(false)}
          onExport={exportApplications}
          onImport={importApplications}
          onDeleteAll={deleteAllApplicationData}
          deleteDisabled={hasPendingImport || undoing || saving || deleting || movingIds.size > 0 || savingInterviewDate}
          importProgress={importProgress}
          returnFocusRef={settingsTriggerRef}
        />
      </MotionPresence>

      <MotionPresence open={pendingDelete !== null}>
        {pendingDelete && (
        <DeleteDialog applications={pendingDelete} deleting={deleting} onCancel={cancelDelete} onConfirm={confirmDelete} returnFocusRef={deleteTriggerRef} />
        )}
      </MotionPresence>

      <MotionPresence open={pendingInterviewDate !== null}>
        {pendingInterviewDate && (
        <InterviewDateDialog
          application={pendingInterviewDate}
          error={interviewDateError}
          onAddDate={() => void saveInterviewDate(false)}
          onChangeDate={setInterviewDateDraft}
          onChangeType={setInterviewTypeDraft}
          type={interviewTypeDraft}
          onClose={() => closeInterviewDatePrompt()}
          onSkip={() => void saveInterviewDate(true)}
          saving={savingInterviewDate}
          value={interviewDateDraft}
        />
        )}
      </MotionPresence>

      {/* Hidden while the Add form is open so it never covers the form's buttons; it returns when the form closes. */}
      <div className={`nook-toast-wrap ${toast && !isModalOpen ? "nook-toast-show" : ""}`} role="status" aria-live="polite" aria-hidden={!toast || isModalOpen} inert={!toast || isModalOpen}>
        {visibleToast && (
          <div
            className="nook-toast"
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) endToastInteraction("focus");
            }}
            onFocusCapture={() => pauseToastDismissTimer("focus")}
            onMouseEnter={() => pauseToastDismissTimer("hover")}
            onMouseLeave={() => endToastInteraction("hover")}
          >
            <span>{visibleToast.message}</span>
            {visibleToast.undo && (
              <button className="nook-toast-action" disabled={undoing} onClick={(event) => void undoLatestChange(event.detail === 0)} type="button">
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
