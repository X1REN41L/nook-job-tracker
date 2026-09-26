"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { Status } from "@prisma/client";
import { FormEvent, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { ApplicationSidebar } from "@/components/application-sidebar";
import { KanbanBoard, KanbanCardOverlay } from "@/components/kanban-board";
import { DeleteDialog } from "@/components/delete-dialog";
import { DuplicateWarningDialog } from "@/components/duplicate-warning-dialog";
import { InterviewDateDialog } from "@/components/interview-date-dialog";
import { MotionPresence } from "@/components/motion-presence";
import { InterviewsList } from "@/components/interviews-list";
import { DashboardOverview } from "@/components/dashboard-overview";
import { DashboardAnalytics } from "@/components/dashboard-analytics";
import { DashboardStaleApplications } from "@/components/dashboard-stale-applications";
import { JobModal, type JobFormState } from "@/components/job-modal";
import { SettingsModal } from "@/components/settings-modal";
import { ShortcutOverlay } from "@/components/shortcut-overlay";
import { useApplicationBackup } from "@/hooks/use-application-backup";
import { ARCHIVED_DROP_ID, SIDEBAR_EDGE_DROP_ID, useBoardDrag } from "@/hooks/use-board-drag";
import { useDashboardShortcuts } from "@/hooks/use-dashboard-shortcuts";
import { useScrollbarActivity } from "@/hooks/use-scrollbar-activity";
import { useToastUndo, type ToastUndo } from "@/hooks/use-toast-undo";
import { currentLocalDate } from "@/lib/application-date";
import { ALL_APPLICATIONS_CHANGE_EVENT, ALL_APPLICATIONS_STORAGE_KEY, ARCHIVED_CHANGE_EVENT, ARCHIVED_STORAGE_KEY, SIDEBAR_CHANGE_EVENT, SIDEBAR_STORAGE_KEY } from "@/lib/backup-settings";
import { BOARD_STATUSES, boardLabel, useBoards } from "@/lib/board-preferences";
import { applicationInputSchema, interviewDateSchema } from "@/lib/application-schema";
import type { BackupSnapshot } from "@/lib/backup-snapshot";
import { findPossibleDuplicate, type DuplicateMatch } from "@/lib/duplicate-match";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { getDefaultBoard } from "@/lib/general-preferences";
import { getInterviewListItems, getUpcomingInterviewCount } from "@/lib/interviews";
import type { ApplicationRecord } from "@/types/application";

const blankForm = (): JobFormState => ({ company: "", role: "", status: Status.APPLIED, source: "", appliedDate: currentLocalDate(), interviewDate: "", notes: "", jobUrl: "" });
type DragSource = "board" | "sidebar" | "archived";
const SIDEBAR_WIDTH_KEY = "nook-sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 320;
// 254.08px for the first three filter pills + 12px gaps + 36px padding + 1px border.
const MIN_SIDEBAR_WIDTH = 304;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_COLLAPSE_THRESHOLD = 180;
const SIDEBAR_REOPEN_THRESHOLD = 80;
export type ApplicationPageName = "job-board" | "dashboard" | "interviews";
export type DashboardSection = "overview" | "analytics" | "stale";
type PendingDuplicate = {
  candidate: JobFormState;
  editingId: string | null;
  match: DuplicateMatch<ApplicationRecord>;
};

function subscribeToSidebarPreference(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, onStoreChange);
  };
}

function getSidebarPreference() {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
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

function subscribeToArchivedPreference(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(ARCHIVED_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(ARCHIVED_CHANGE_EVENT, onStoreChange);
  };
}

function getArchivedPreference() {
  try {
    return localStorage.getItem(ARCHIVED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function subscribeToAllApplicationsPreference(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(ALL_APPLICATIONS_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(ALL_APPLICATIONS_CHANGE_EVENT, onStoreChange);
  };
}

function getAllApplicationsPreference() {
  try {
    return localStorage.getItem(ALL_APPLICATIONS_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function subscribeToLocalDate(onStoreChange: () => void) {
  const now = new Date();
  const nextLocalMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const timeout = window.setTimeout(onStoreChange, nextLocalMidnight.getTime() - now.getTime());
  return () => window.clearTimeout(timeout);
}

function getServerLocalDate() {
  return "";
}

export function ApplicationDashboard({ initialApplications, page, dashboardSection = "overview" }: { initialApplications: ApplicationRecord[]; page: ApplicationPageName; dashboardSection?: DashboardSection }) {
  const router = useRouter();
  const boardScrollRef = useScrollbarActivity<HTMLDivElement>();
  const { theme, setTheme } = useTheme();
  const boards = useBoards();
  const [applications, setApplications] = useState(initialApplications);
  const [form, setForm] = useState<JobFormState>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ApplicationRecord | null>(null);
  const [pendingInterviewDate, setPendingInterviewDate] = useState<ApplicationRecord | null>(null);
  const [interviewDateDraft, setInterviewDateDraft] = useState("");
  const [interviewDateError, setInterviewDateError] = useState("");
  const [savingInterviewDate, setSavingInterviewDate] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsConfirmationOpen, setSettingsConfirmationOpen] = useState(false);
  const isMac = typeof navigator !== "undefined" && isMacPlatform();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | Status>("all");
  const sidebarCollapsed = useSyncExternalStore(subscribeToSidebarPreference, getSidebarPreference, () => false);
  const sidebarWidth = useSyncExternalStore(subscribeToSidebarPreference, getSidebarWidth, () => DEFAULT_SIDEBAR_WIDTH);
  const archivedExpanded = useSyncExternalStore(subscribeToArchivedPreference, getArchivedPreference, () => false);
  const allApplicationsExpanded = useSyncExternalStore(subscribeToAllApplicationsPreference, getAllApplicationsPreference, () => true);
  const today = useSyncExternalStore(subscribeToLocalDate, currentLocalDate, getServerLocalDate);
  const { toast, deleteRecovery, undoing, showToast, clearApplicationUndo, pauseToastDismissTimer, endToastInteraction, resumeUndoToastOnTab, undoLatestChange } = useToastUndo({ onUndo: restoreLatestChange });
  const lastToastRef = useRef(toast);
  if (toast) lastToastRef.current = toast;
  const visibleToast = toast ?? lastToastRef.current;
  const { importProgress, hasPendingImport, exportApplications, importApplications, resumeImportAllowDuplicate, cancelImport, abandonImport } = useApplicationBackup({
    applications,
    insertApplications,
    theme,
    setTheme,
    onDuplicate: (candidate, match) => setPendingDuplicate({ candidate, editingId: null, match }),
    showToast,
  });
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const reopenModalAfterDelete = useRef(false);
  const sidebarHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const interviewSearchRef = useRef<HTMLInputElement | null>(null);
  const upcomingTabRef = useRef<HTMLButtonElement | null>(null);
  const pastTabRef = useRef<HTMLButtonElement | null>(null);
  const shortcutTriggerRef = useRef<HTMLElement | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const submissionInFlight = useRef(false);
  const dndContextId = useId();
  const { activeId, activeDragSource, sensors, collisionDetection, autoScroll, onDragStart, onDragMove, onDragEnd, onDragCancel } = useBoardDrag({
    sidebarCollapsed,
    setSidebarCollapsed,
    onDrop: handleDrop,
  });
  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
    if (reopenModalAfterDelete.current) setIsModalOpen(true);
    reopenModalAfterDelete.current = false;
  }, []);

  function setSidebarCollapsed(nextCollapsed: boolean) {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextCollapsed));
      window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
    } catch {
      // Leave the current preference unchanged when storage is unavailable.
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed(!sidebarCollapsed);
  }

  function saveSidebarWidth(width: number) {
    const nextWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
      window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
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
    try {
      localStorage.setItem(ARCHIVED_STORAGE_KEY, String(!archivedExpanded));
      window.dispatchEvent(new Event(ARCHIVED_CHANGE_EVENT));
    } catch {
      // Leave the current preference unchanged when storage is unavailable.
    }
  }

  function toggleAllApplications() {
    try {
      localStorage.setItem(ALL_APPLICATIONS_STORAGE_KEY, String(!allApplicationsExpanded));
      window.dispatchEvent(new Event(ALL_APPLICATIONS_CHANGE_EVENT));
    } catch {
      // Leave the current preference unchanged when storage is unavailable.
    }
  }

  async function insertApplications(backup: BackupSnapshot) {
    const response = await fetch("/api/applications/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not import the applications");
    const imported = body.applications as ApplicationRecord[];
    setApplications((current) => [...current, ...imported].sort((a, b) => b.appliedDate.localeCompare(a.appliedDate)));
    return { created: imported, skippedIds: body.skippedIds as string[] };
  }

  async function deleteAllApplicationData() {
    try {
      const response = await fetch("/api/applications/purge", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not delete application data");

      setApplications([]);
      resetForm();
      setIsModalOpen(false);
      setPendingDelete(null);
      reopenModalAfterDelete.current = false;
      deleteTriggerRef.current = null;
      setPendingInterviewDate(null);
      setInterviewDateDraft("");
      setInterviewDateError("");
      setMovingId(null);
      setSearchTerm("");
      setActiveFilter("all");
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
  function resetForm() { setForm(blankForm()); setEditingId(null); setEditingRevision(null); setPendingDuplicate(null); setError(""); }
  function openAddModal() { resetForm(); setForm({ ...blankForm(), status: getDefaultBoard() }); setIsModalOpen(true); }
  function closeModal() { setIsModalOpen(false); resetForm(); }
  function startEdit(application: ApplicationRecord) {
    setPendingDuplicate(null);
    setEditingId(application.id);
    setEditingRevision(application.revision);
    setForm({ company: application.company, role: application.role, status: application.status, source: application.source ?? "", appliedDate: application.appliedDate.slice(0, 10), interviewDate: application.interviewDate?.slice(0, 10) ?? "", notes: application.notes ?? "", jobUrl: application.jobUrl ?? "" });
    setError("");
    setIsModalOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;
    setError("");
    const parsed = applicationInputSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the form and try again."); return; }
    const match = findPossibleDuplicate(form, applications, editingId ?? undefined);
    if (match) {
      setPendingDuplicate({ candidate: { ...form }, editingId, match });
      return;
    }
    await saveApplication({ ...form }, editingId);
  }

  async function saveApplication(candidate: JobFormState, targetEditingId: string | null) {
    if (submissionInFlight.current) return false;
    submissionInFlight.current = true;
    setSaving(true);
    try {
      const expectedRevision = targetEditingId
        ? editingRevision ?? applications.find((item) => item.id === targetEditingId)?.revision
        : undefined;
      if (targetEditingId && expectedRevision === undefined) throw new Error("Could not find the application version to update");
      const response = await fetch(targetEditingId ? `/api/applications/${targetEditingId}` : "/api/applications", {
        method: targetEditingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetEditingId ? { ...candidate, revision: expectedRevision } : candidate),
      });
      const body = await response.json();
      if (response.status === 409 && targetEditingId && body.application) {
        const latest = body.application as ApplicationRecord;
        setApplications((current) => current.map((item) => item.id === latest.id ? latest : item));
        setEditingRevision(latest.revision);
        setError("This application changed while you were editing. The latest saved version is loaded, and your form is still open with your changes. Review them, then save again to apply them.");
        return false;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not save the application");
      const previous = targetEditingId ? applications.find((item) => item.id === targetEditingId) : undefined;
      setApplications((current) => {
        const next = targetEditingId ? current.map((item) => item.id === targetEditingId ? body.application : item) : [body.application, ...current];
        return next.sort((a, b) => b.appliedDate.localeCompare(a.appliedDate));
      });
      showToast(targetEditingId ? `Saved changes to ${body.application.company}` : `Added ${body.application.company}`);
      closeModal();
      if (previous && previous.status !== Status.INTERVIEW && body.application.status === Status.INTERVIEW && !body.application.interviewDate && !body.application.interviewDatePromptDismissed) {
        openInterviewDatePrompt(body.application);
      }
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the application");
      return false;
    } finally {
      submissionInFlight.current = false;
      setSaving(false);
    }
  }

  async function addDuplicateAnyway() {
    if (!pendingDuplicate || submissionInFlight.current) return;
    const pending = pendingDuplicate;
    if (hasPendingImport) {
      setPendingDuplicate(null);
      await resumeImportAllowDuplicate();
      return;
    }
    const saved = await saveApplication(pending.candidate, pending.editingId);
    if (!saved) setPendingDuplicate(null);
  }

  function viewExistingDuplicate() {
    if (!pendingDuplicate || saving) return;
    if (hasPendingImport) {
      abandonImport();
      setPendingDuplicate(null);
      showToast("Import cancelled; no applications were added");
      return;
    }
    const existing = applications.find(({ id }) => id === pendingDuplicate.match.application.id) ?? pendingDuplicate.match.application;
    startEdit(existing);
  }

  function requestDelete(application: ApplicationRecord, trigger: HTMLElement | null, reopenModal: boolean) {
    deleteTriggerRef.current = trigger;
    reopenModalAfterDelete.current = reopenModal;
    setIsModalOpen(false);
    setPendingDelete(application);
  }

  function requestDeleteCurrent() {
    const application = applications.find((item) => item.id === editingId);
    if (!application) return;
    requestDelete(application, sidebarHeadingRef.current, true);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const deletedApplication = pendingDelete;
    setError("");
    setDeleting(true);
    try {
      const response = await fetch(`/api/applications/${deletedApplication.id}?undoable=1`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not delete the application");
      setApplications((current) => current.filter((item) => item.id !== deletedApplication.id));
      if (editingId === deletedApplication.id) resetForm();
      showToast(`Deleted ${deletedApplication.company}`, {
        kind: "delete",
        applicationId: deletedApplication.id,
        token: body.token,
        expiresAt: body.expiresAt,
        company: deletedApplication.company,
      });
      setPendingDelete(null);
      reopenModalAfterDelete.current = false;
      requestAnimationFrame(() => sidebarHeadingRef.current?.focus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the application");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function moveApplication(
    application: ApplicationRecord,
    status: Status,
    offerUndo = true,
    restoration?: Pick<ApplicationRecord, "interviewDate" | "interviewDatePromptDismissed">,
    archived = application.archived,
  ) {
    if ((application.status === status && application.archived === archived) || movingId !== null) return;
    const previousStatus = application.status;
    const previousArchived = application.archived;
    const previousInterviewDate = application.interviewDate;
    const previousInterviewDatePromptDismissed = application.interviewDatePromptDismissed;
    setError("");
    setMovingId(application.id);
    setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status, archived, ...restoration } : item));
    try {
      const response = await fetch(`/api/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(status === previousStatus && archived !== previousArchived
          ? { revision: application.revision, archived }
          : {
              revision: application.revision,
              status,
              ...(archived !== previousArchived && { archived }),
              ...(restoration && {
                interviewDate: restoration.interviewDate?.slice(0, 10) ?? null,
                interviewDatePromptDismissed: restoration.interviewDatePromptDismissed,
              }),
            }),
      });
      const body = await response.json();
      if (response.status === 409 && body.application) {
        const latest = body.application as ApplicationRecord;
        setApplications((current) => current.map((item) => item.id === latest.id ? latest : item));
        setError("This application changed elsewhere. The latest saved version has been loaded; try your action again.");
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not update the application status");
      setApplications((current) => current.map((item) => item.id === application.id ? body.application : item));
      if (offerUndo) {
        const message = previousArchived !== archived
          ? `${archived ? "Archived" : "Restored"} ${application.company}`
          : `${application.company} moved from ${boardLabel(boards, previousStatus)} to ${boardLabel(boards, status)}`;
        showToast(
          message,
          { kind: "status", applicationId: application.id, status: previousStatus, archived: previousArchived, interviewDate: previousInterviewDate, interviewDatePromptDismissed: previousInterviewDatePromptDismissed },
        );
      }
      if (!restoration && previousStatus !== Status.INTERVIEW && status === Status.INTERVIEW && !body.application.interviewDate && !body.application.interviewDatePromptDismissed) {
        openInterviewDatePrompt(body.application);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the application status");
      setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status: previousStatus, archived: previousArchived, interviewDate: previousInterviewDate, interviewDatePromptDismissed: previousInterviewDatePromptDismissed } : item));
      if (!offerUndo) throw caught;
    } finally {
      setMovingId(null);
    }
  }

  function openInterviewDatePrompt(application: ApplicationRecord) {
    setInterviewDateDraft(currentLocalDate());
    setInterviewDateError("");
    setPendingInterviewDate(application);
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
      const response = await fetch(`/api/applications/${pendingInterviewDate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: pendingInterviewDate.revision,
          status: Status.INTERVIEW,
          ...(skip ? { interviewDatePromptDismissed: true } : { interviewDate: interviewDateDraft }),
        }),
      });
      const body = await response.json();
      if (response.status === 409 && body.application) {
        const latest = body.application as ApplicationRecord;
        setApplications((current) => current.map((item) => item.id === latest.id ? latest : item));
        setPendingInterviewDate(latest);
        setInterviewDateError("This application changed elsewhere. The latest version has been loaded; your date is still here. Review it and save again.");
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not update the interview date");
      setApplications((current) => current.map((item) => item.id === pendingInterviewDate.id ? body.application : item));
      setPendingInterviewDate(null);
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

  async function restoreLatestChange(undo: ToastUndo, restoreKeyboardFocus: boolean) {
    setPendingInterviewDate(null);
    if (undo.kind === "status") {
      const application = applications.find(({ id }) => id === undo.applicationId);
      if (!application) return;
      await moveApplication(application, undo.status, false, {
        interviewDate: undo.interviewDate,
        interviewDatePromptDismissed: undo.interviewDatePromptDismissed,
      }, undo.archived);
      if (restoreKeyboardFocus && (BOARD_STATUSES as readonly Status[]).includes(undo.status)) focusKanbanCard(application.id);
      return;
    }

    const response = await fetch(`/api/applications/${undo.applicationId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: undo.token }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not restore the application");
    const restored = body.application as ApplicationRecord;
    setApplications((current) => [restored, ...current].sort((a, b) => b.appliedDate.localeCompare(a.appliedDate)));
    showToast(`Restored ${restored.company}`);
    if (restoreKeyboardFocus && (BOARD_STATUSES as readonly Status[]).includes(restored.status)) focusKanbanCard(restored.id);
  }

  async function handleDrop(event: DragEndEvent) {
    const dragSource = (event.active.data.current?.source as DragSource | undefined) ?? "board";
    const keyboardDrag = event.activatorEvent instanceof KeyboardEvent;
    const applicationId = String(event.active.data.current?.applicationId ?? event.active.id);
    const application = applications.find(({ id }) => id === applicationId);
    const overId = event.over?.id;
    if (!application || overId === undefined) return;
    if (dragSource === "sidebar" && overId !== ARCHIVED_DROP_ID) return;
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

  const sidebarItems = applications
    .filter((item) => !item.archived)
    .filter((item) => activeFilter === "all" || item.status === activeFilter)
    .filter((item) => `${item.company} ${item.role}`.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => b.appliedDate.localeCompare(a.appliedDate));
  const archivedItems = applications
    .filter((item) => item.archived)
    .sort((a, b) => b.appliedDate.localeCompare(a.appliedDate));
  const interviewToday = today || currentLocalDate();
  const interviews = getInterviewListItems(applications);
  const upcomingInterviewCount = getUpcomingInterviewCount(applications, interviewToday);
  const activeApplication = applications.find(({ id }) => id === activeId) ?? null;

  function dropTargetLabel(id: string | number) {
    if (id === ARCHIVED_DROP_ID) return "Archived";
    if (id === SIDEBAR_EDGE_DROP_ID) return "Archive";
    return Object.values(Status).includes(id as Status) ? boardLabel(boards, id as Status) : "another drop target";
  }

  function focusSearch() {
    if (page === "interviews") {
      if (!interviewSearchRef.current) return false;
      interviewSearchRef.current.focus();
      return true;
    }
    if (page !== "job-board") return false;
    if (!searchInputRef.current) return false;
    if (sidebarCollapsed) setSidebarCollapsed(false);
    if (!allApplicationsExpanded) toggleAllApplications();
    requestAnimationFrame(() => requestAnimationFrame(() => searchInputRef.current?.focus()));
    return true;
  }

  function switchInterviewTab(direction: "left" | "right") {
    if (page !== "interviews") return false;
    const target = direction === "left" ? upcomingTabRef.current : pastTabRef.current;
    if (!target) return false;
    target.click();
    target.focus();
    return true;
  }

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
    dragActive: activeId !== null,
    canUndo: Boolean(toast?.undo || deleteRecovery),
    onResumeUndoToastOnTab: resumeUndoToastOnTab,
    onCloseShortcuts: () => setShortcutsOpen(false),
    onCloseSettings: () => { if (!settingsConfirmationOpen) setSettingsOpen(false); },
    onNewJob: openAddModal,
    onOpenSettings: () => setSettingsOpen(true),
    onFocusSearch: focusSearch,
    onShowShortcuts: openShortcuts,
    onUndo: () => { void undoLatestChange(true); },
    onToggleSidebar: toggleSidebar,
    onNavigate: (path) => router.push(path),
    onSwitchInterviewTab: switchInterviewTab,
    onMoveApplicationFocus: moveApplicationFocus,
    onArchiveFocused: (application) => {
      if (application.archived) return;
      void moveApplication(application, application.status, true, undefined, true);
    },
    onDeleteFocused: (application, focused) => requestDelete(application, focused, false),
  });

  return (
    <main className="select-none-ui flex h-screen flex-col overflow-hidden bg-cream text-ink">
      {page === "job-board" && (
        <button aria-label="Add job" className="btn-primary fixed bottom-6 right-6 z-50 flex origin-bottom-right scale-[1.2] items-center gap-2 shadow-lg" onClick={openAddModal} type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span className="hidden sm:inline">Add job</span>
        </button>
      )}

      {error && !isModalOpen && (
        <p className="mx-7 mt-4 rounded-nook border border-rose bg-rose-tint p-3 text-sm text-ink" role="alert">
          {error}
        </p>
      )}

      <DndContext
        id={dndContextId}
        accessibility={{
          screenReaderInstructions: { draggable: "Press Enter to edit. Press Space to pick up an application. For board cards, use Left and Right Arrow to move between status columns. Press Space to drop or Escape to cancel." },
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
                ? `Movement canceled. ${active.data.current?.label} remains in ${boardLabel(boards, origin)}.`
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
          className={`app-workspace relative grid min-h-0 flex-1 overflow-hidden ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}
          style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
        >
        <ApplicationSidebar
          boards={boards}
          sidebarItems={sidebarItems}
          archivedItems={archivedItems}
          totalApplications={applications.length}
          upcomingInterviewCount={upcomingInterviewCount}
          collapsed={sidebarCollapsed}
          width={sidebarWidth}
          page={page}
          dashboardSection={dashboardSection}
          archivedExpanded={archivedExpanded}
          allApplicationsExpanded={allApplicationsExpanded}
          movingId={movingId}
          searchTerm={searchTerm}
          activeFilter={activeFilter}
          headingRef={sidebarHeadingRef}
          searchInputRef={searchInputRef}
          settingsTriggerRef={settingsTriggerRef}
          onSearchTermChange={setSearchTerm}
          onFilterChange={setActiveFilter}
          onToggleSidebar={toggleSidebar}
          onResizePointerDown={handleSidebarResizeStart}
          onResizeKeyDown={handleSidebarResizeKeyDown}
          onOpenArchive={() => {
            setSidebarCollapsed(false);
            if (!archivedExpanded) toggleArchived();
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleArchived={toggleArchived}
          onToggleAllApplications={toggleAllApplications}
          onEdit={startEdit}
          onRequestDelete={(application, trigger) => requestDelete(application, trigger, false)}
          onRestore={(application) => moveApplication(application, application.status, true, undefined, false)}
        />
        <div ref={boardScrollRef} className="board-scroll scrollbar-styled h-full min-w-0 overflow-auto px-4.5 py-6">
          {page === "job-board" ? (
            <KanbanBoard applications={applications} boards={boards} dropDisabled={activeDragSource === "sidebar"} movingId={movingId} onEdit={startEdit} />
          ) : page === "interviews" ? (
            <InterviewsList interviews={interviews} upcomingCount={upcomingInterviewCount} today={interviewToday} searchInputRef={interviewSearchRef} upcomingTabRef={upcomingTabRef} pastTabRef={pastTabRef} />
          ) : (
            dashboardSection === "overview" ? (
              <DashboardOverview today={today} refreshKey={applications} />
            ) : dashboardSection === "analytics" ? (
              <DashboardAnalytics today={today} refreshKey={applications} />
            ) : (
              <DashboardStaleApplications today={today} refreshKey={applications} applications={applications} onEdit={startEdit} />
            )
          )}
        </div>

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
          boards={boards}
          editing={Boolean(editingId)}
          error={error}
          form={form}
          onChangeField={updateField}
          onClose={closeModal}
          onRequestDelete={editingId ? requestDeleteCurrent : undefined}
          onSubmit={submit}
          saving={saving}
        />
      </MotionPresence>

      <MotionPresence open={pendingDuplicate !== null} immediateExit>
        {pendingDuplicate && (
        <DuplicateWarningDialog
          fromImport={hasPendingImport}
          boards={boards}
          editing={pendingDuplicate.editingId !== null}
          match={pendingDuplicate.match}
          onAddAnyway={() => void addDuplicateAnyway()}
          onDismiss={() => {
            if (hasPendingImport) cancelImport();
            setPendingDuplicate(null);
          }}
          onViewExisting={viewExistingDuplicate}
          saving={saving}
        />
        )}
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
          isMac={isMac}
          onClose={() => setSettingsOpen(false)}
          onExport={exportApplications}
          onImport={importApplications}
          onDeleteAll={deleteAllApplicationData}
          onConfirmationChange={setSettingsConfirmationOpen}
          deleteDisabled={hasPendingImport || undoing || saving || deleting || movingId !== null || savingInterviewDate}
          importProgress={importProgress}
          returnFocusRef={settingsTriggerRef}
          suspendFocusTrap={pendingDuplicate !== null}
        />
      </MotionPresence>

      <MotionPresence open={pendingDelete !== null}>
        {pendingDelete && (
        <DeleteDialog application={pendingDelete} deleting={deleting} onCancel={cancelDelete} onConfirm={confirmDelete} returnFocusRef={deleteTriggerRef} />
        )}
      </MotionPresence>

      <MotionPresence open={pendingInterviewDate !== null}>
        {pendingInterviewDate && (
        <InterviewDateDialog
          application={pendingInterviewDate}
          error={interviewDateError}
          onAddDate={() => void saveInterviewDate(false)}
          onChangeDate={setInterviewDateDraft}
          onClose={() => setPendingInterviewDate(null)}
          onSkip={() => void saveInterviewDate(true)}
          saving={savingInterviewDate}
          value={interviewDateDraft}
        />
        )}
      </MotionPresence>

      <div className={`nook-toast-wrap ${toast ? "nook-toast-show" : ""}`} role="status" aria-live="polite" aria-hidden={!toast} inert={!toast}>
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
    </main>
  );
}
