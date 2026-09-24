"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { Status } from "@prisma/client";
import { FormEvent, useCallback, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";

import { ApplicationSidebar } from "@/components/application-sidebar";
import { KanbanBoard, KanbanCardOverlay } from "@/components/kanban-board";
import { DeleteDialog } from "@/components/delete-dialog";
import { DuplicateWarningDialog } from "@/components/duplicate-warning-dialog";
import { InterviewDateDialog } from "@/components/interview-date-dialog";
import { JobModal, type JobFormState } from "@/components/job-modal";
import { SettingsModal } from "@/components/settings-modal";
import { ShortcutOverlay } from "@/components/shortcut-overlay";
import { useApplicationBackup } from "@/hooks/use-application-backup";
import { ARCHIVED_DROP_ID, SIDEBAR_EDGE_DROP_ID, useBoardDrag } from "@/hooks/use-board-drag";
import { useDashboardShortcuts } from "@/hooks/use-dashboard-shortcuts";
import { useToastUndo, type ToastUndo } from "@/hooks/use-toast-undo";
import { currentLocalDate } from "@/lib/application-date";
import { ARCHIVED_CHANGE_EVENT, ARCHIVED_STORAGE_KEY, SIDEBAR_CHANGE_EVENT, SIDEBAR_STORAGE_KEY } from "@/lib/backup-settings";
import { BOARD_STATUSES, boardLabel, useBoards } from "@/lib/board-preferences";
import { applicationInputSchema, interviewDateSchema } from "@/lib/application-schema";
import type { BackupSnapshot } from "@/lib/backup-snapshot";
import { findPossibleDuplicate, type DuplicateMatch } from "@/lib/duplicate-match";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { getDefaultBoard } from "@/lib/general-preferences";
import type { ApplicationRecord } from "@/types/application";

const blankForm = (): JobFormState => ({ company: "", role: "", status: Status.APPLIED, source: "", appliedDate: currentLocalDate(), interviewDate: "", notes: "", jobUrl: "" });
type DragSource = "board" | "sidebar" | "archived";
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

export function ApplicationDashboard({ initialApplications }: { initialApplications: ApplicationRecord[] }) {
  const { theme, setTheme } = useTheme();
  const boards = useBoards();
  const [applications, setApplications] = useState(initialApplications);
  const [form, setForm] = useState<JobFormState>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
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
  const isMac = typeof navigator !== "undefined" && isMacPlatform();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | Status>("all");
  const sidebarCollapsed = useSyncExternalStore(subscribeToSidebarPreference, getSidebarPreference, () => false);
  const archivedExpanded = useSyncExternalStore(subscribeToArchivedPreference, getArchivedPreference, () => false);
  const { toast, showToast, pauseToastDismissTimer, endToastInteraction, resumeUndoToastOnTab, undoLatestChange } = useToastUndo({ onUndo: restoreLatestChange });
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
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

  function toggleArchived() {
    try {
      localStorage.setItem(ARCHIVED_STORAGE_KEY, String(!archivedExpanded));
      window.dispatchEvent(new Event(ARCHIVED_CHANGE_EVENT));
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

  function updateField<K extends keyof JobFormState>(field: K, value: JobFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  function resetForm() { setForm(blankForm()); setEditingId(null); setPendingDuplicate(null); setError(""); }
  function openAddModal() { resetForm(); setForm({ ...blankForm(), status: getDefaultBoard() }); setIsModalOpen(true); }
  function closeModal() { setIsModalOpen(false); resetForm(); }
  function startEdit(application: ApplicationRecord) {
    setPendingDuplicate(null);
    setEditingId(application.id);
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
      const response = await fetch(targetEditingId ? `/api/applications/${targetEditingId}` : "/api/applications", {
        method: targetEditingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candidate),
      });
      const body = await response.json();
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
      const response = await fetch(`/api/applications/${deletedApplication.id}?undoable=1`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not delete the application");
      setApplications((current) => current.filter((item) => item.id !== deletedApplication.id));
      if (editingId === deletedApplication.id) resetForm();
      showToast(`Deleted ${deletedApplication.company}`, { kind: "delete", applicationId: deletedApplication.id, token: body.token });
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
          ? { archived }
          : {
              status,
              ...(archived !== previousArchived && { archived }),
              ...(restoration && {
                interviewDate: restoration.interviewDate?.slice(0, 10) ?? null,
                interviewDatePromptDismissed: restoration.interviewDatePromptDismissed,
              }),
            }),
      });
      const body = await response.json();
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
          status: Status.INTERVIEW,
          ...(skip ? { interviewDatePromptDismissed: true } : { interviewDate: interviewDateDraft }),
        }),
      });
      const body = await response.json();
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
    if (overId === ARCHIVED_DROP_ID) {
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
  const activeApplication = applications.find(({ id }) => id === activeId) ?? null;

  function dropTargetLabel(id: string | number) {
    if (id === ARCHIVED_DROP_ID) return "Archived";
    if (id === SIDEBAR_EDGE_DROP_ID) return "the sidebar edge";
    return Object.values(Status).includes(id as Status) ? boardLabel(boards, id as Status) : "another drop target";
  }

  function focusSearch() {
    if (sidebarCollapsed) setSidebarCollapsed(false);
    requestAnimationFrame(() => requestAnimationFrame(() => searchInputRef.current?.focus()));
  }

  function openShortcuts() {
    shortcutTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShortcutsOpen(true);
  }

  useDashboardShortcuts({
    isMac,
    applications,
    isModalOpen,
    hasPendingDuplicate: pendingDuplicate !== null,
    hasPendingDelete: pendingDelete !== null,
    hasPendingInterviewDate: pendingInterviewDate !== null,
    shortcutsOpen,
    settingsOpen,
    dragActive: activeId !== null,
    canUndo: Boolean(toast?.undo),
    onResumeUndoToastOnTab: resumeUndoToastOnTab,
    onCloseShortcuts: () => setShortcutsOpen(false),
    onCloseSettings: () => setSettingsOpen(false),
    onNewJob: openAddModal,
    onOpenSettings: () => setSettingsOpen(true),
    onFocusSearch: focusSearch,
    onShowShortcuts: openShortcuts,
    onUndo: () => { void undoLatestChange(true); },
    onToggleSidebar: toggleSidebar,
    onArchiveFocused: (application) => {
      if (application.archived) return;
      void moveApplication(application, application.status, true, undefined, true);
    },
    onDeleteFocused: (application, focused) => requestDelete(application, focused, false),
  });

  return (
    <main className="select-none-ui flex h-screen flex-col overflow-hidden bg-cream text-ink transition-colors">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-paper px-7 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-forest to-forest-deep font-serif text-[15px] leading-none text-cream">
            N
          </span>
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="shrink-0 font-serif text-xl font-semibold leading-none tracking-tight">Nook</h1>
            <span className="hidden truncate text-sm leading-tight text-ink-soft sm:block">your job search, kept tidy</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            ref={settingsTriggerRef}
            aria-label="Settings"
            className="icon-btn bg-cream text-ink hover:border-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest active:bg-cream-2"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            type="button"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.5 2.3h3l.5 2.3c.5.2 1 .5 1.5.9l2.2-.8 2.1 2.1-.8 2.2c.4.5.7 1 .9 1.5l2.3.5v3l-2.3.5c-.2.5-.5 1-.9 1.5l.8 2.2-2.1 2.1-2.2-.8c-.5.4-1 .7-1.5.9l-.5 2.3h-3l-.5-2.3c-.5-.2-1-.5-1.5-.9l-2.2.8-2.1-2.1.8-2.2c-.4-.5-.7-1-.9-1.5l-2.3-.5v-3l2.3-.5c.2-.5.5-1 .9-1.5l-.8-2.2 2.1-2.1 2.2.8c.5-.4 1-.7 1.5-.9l.5-2.3Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <button aria-label="Add job" className="btn-primary flex items-center gap-2" onClick={openAddModal} type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="hidden sm:inline">Add job</span>
          </button>
        </div>
      </header>

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
          className={`app-workspace relative grid min-h-0 flex-1 overflow-hidden ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}
        >
        <div className="board-scroll h-full min-w-0 overflow-auto px-4.5 py-6">
          <KanbanBoard applications={applications} boards={boards} dropDisabled={activeDragSource === "sidebar"} movingId={movingId} onEdit={startEdit} />
        </div>

        <ApplicationSidebar
          boards={boards}
          sidebarItems={sidebarItems}
          archivedItems={archivedItems}
          totalApplications={applications.length}
          collapsed={sidebarCollapsed}
          archivedExpanded={archivedExpanded}
          movingId={movingId}
          searchTerm={searchTerm}
          activeFilter={activeFilter}
          headingRef={sidebarHeadingRef}
          searchInputRef={searchInputRef}
          onSearchTermChange={setSearchTerm}
          onFilterChange={setActiveFilter}
          onToggleSidebar={toggleSidebar}
          onToggleArchived={toggleArchived}
          onEdit={startEdit}
          onRequestDelete={(application, trigger) => requestDelete(application, trigger, false)}
          onRestore={(application) => moveApplication(application, application.status, true, undefined, false)}
        />
        </div>
        {activeApplication && typeof document !== "undefined"
          ? createPortal(
              <DragOverlay zIndex={70}>
                <KanbanCardOverlay application={activeApplication} />
              </DragOverlay>,
              document.body,
            )
          : null}
      </DndContext>

      {isModalOpen && !pendingDuplicate && (
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
      )}

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

      {shortcutsOpen && (
        <ShortcutOverlay
          isMac={isMac}
          onClose={() => setShortcutsOpen(false)}
          returnFocusRef={shortcutTriggerRef}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          isMac={isMac}
          onClose={() => setSettingsOpen(false)}
          onExport={exportApplications}
          onImport={importApplications}
          importProgress={importProgress}
          returnFocusRef={settingsTriggerRef}
          suspendFocusTrap={pendingDuplicate !== null}
        />
      )}

      {pendingDelete && (
        <DeleteDialog application={pendingDelete} deleting={deleting} onCancel={cancelDelete} onConfirm={confirmDelete} returnFocusRef={deleteTriggerRef} />
      )}

      {pendingInterviewDate && (
        <InterviewDateDialog
          application={pendingInterviewDate}
          error={interviewDateError}
          onAddDate={() => void saveInterviewDate(false)}
          onChangeDate={setInterviewDateDraft}
          onSkip={() => void saveInterviewDate(true)}
          saving={savingInterviewDate}
          value={interviewDateDraft}
        />
      )}

      <div className={`nook-toast-wrap ${toast ? "nook-toast-show" : ""}`} role="status" aria-live="polite">
        {toast && (
          <div
            className="nook-toast"
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) endToastInteraction("focus");
            }}
            onFocusCapture={() => pauseToastDismissTimer("focus")}
            onMouseEnter={() => pauseToastDismissTimer("hover")}
            onMouseLeave={() => endToastInteraction("hover")}
          >
            <span>{toast.message}</span>
            {toast.undo && (
              <button className="nook-toast-action" onClick={(event) => void undoLatestChange(event.detail === 0)} type="button">
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
