"use client";

import { useEffect, useRef } from "react";

import { matchDashboardShortcut, shortcutDestination, startsShortcutSequence } from "@/lib/keyboard-shortcuts";
import type { ApplicationPageName } from "@/types/navigation";
import type { ApplicationSummary } from "@/types/application";

type DashboardShortcutOptions = {
  isMac: boolean;
  page: ApplicationPageName;
  applications: ApplicationSummary[];
  isModalOpen: boolean;
  hasPendingDuplicate: boolean;
  hasPendingDelete: boolean;
  hasPendingInterviewDate: boolean;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
  detailOpen: boolean;
  commandPaletteOpen: boolean;
  dragActive: boolean;
  canUndo: boolean;
  onResumeUndoToastOnTab: () => void;
  onNewJob: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  onFocusSearch: () => boolean;
  onShowShortcuts: () => void;
  onUndo: () => void;
  onToggleSidebar: () => void;
  onNavigate: (path: string) => void;
  onMoveApplicationFocus: (direction: "up" | "down" | "left" | "right") => boolean;
  onSwitchInterviewTab: (tab: "upcoming" | "past") => boolean;
  onArchiveFocused: (application: ApplicationSummary) => void;
  onDeleteFocused: (application: ApplicationSummary, focused: HTMLElement | null) => void;
};

export function useDashboardShortcuts({
  isMac,
  page,
  applications,
  isModalOpen,
  hasPendingDuplicate,
  hasPendingDelete,
  hasPendingInterviewDate,
  shortcutsOpen,
  settingsOpen,
  detailOpen,
  commandPaletteOpen,
  dragActive,
  canUndo,
  onResumeUndoToastOnTab,
  onNewJob,
  onOpenSettings,
  onOpenCommandPalette,
  onFocusSearch,
  onShowShortcuts,
  onUndo,
  onToggleSidebar,
  onNavigate,
  onMoveApplicationFocus,
  onSwitchInterviewTab,
  onArchiveFocused,
  onDeleteFocused,
}: DashboardShortcutOptions) {
  const pendingPrefixRef = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.key === "Tab") onResumeUndoToastOnTab();
      if (event.repeat || event.defaultPrevented) return;
      const pending = pendingPrefixRef.current;
      pendingPrefixRef.current = null;
      const prefix = pending && Date.now() - pending.at <= 1000 ? pending.key : null;
      const shortcut = matchDashboardShortcut(event, isMac, page, prefix);

      // Escape belongs to the dialog stack (use-dialog-stack.ts), which closes only the topmost dialog.
      if (shortcut === "close") return;

      const anotherDialogIsOpen = isModalOpen || hasPendingDuplicate || hasPendingDelete || hasPendingInterviewDate || shortcutsOpen || settingsOpen || detailOpen || commandPaletteOpen;
      if (anotherDialogIsOpen || dragActive) return;
      if (startsShortcutSequence(event, page)) {
        pendingPrefixRef.current = { key: event.key.toLowerCase(), at: Date.now() };
        event.preventDefault();
        return;
      }
      if (!shortcut) return;

      const destination = shortcutDestination(shortcut);
      if (destination) {
        event.preventDefault();
        onNavigate(destination);
        return;
      }
      if (shortcut === "move-focus") {
        const direction = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[event.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"];
        if (onMoveApplicationFocus(direction)) event.preventDefault();
        return;
      }
      if (shortcut === "switch-interview-tab") {
        if (onSwitchInterviewTab(event.key === "ArrowLeft" ? "upcoming" : "past")) event.preventDefault();
        return;
      }

      if (shortcut === "new-job") {
        event.preventDefault();
        onNewJob();
        return;
      }
      if (shortcut === "command-palette") {
        event.preventDefault();
        onOpenCommandPalette();
        return;
      }
      if (shortcut === "open-settings") {
        event.preventDefault();
        onOpenSettings();
        return;
      }
      if (shortcut === "search") {
        if (onFocusSearch()) event.preventDefault();
        return;
      }
      if (shortcut === "show-shortcuts") {
        event.preventDefault();
        onShowShortcuts();
        return;
      }
      if (shortcut === "undo") {
        if (!canUndo) return;
        event.preventDefault();
        onUndo();
        return;
      }
      if (shortcut === "toggle-sidebar") {
        event.preventDefault();
        onToggleSidebar();
        return;
      }

      if (shortcut !== "archive-focused" && shortcut !== "delete-focused") {
        return;
      }

      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const card = focused?.closest<HTMLElement>(".board-columns [data-kanban-card-id]");
      if (card !== focused) return;
      const applicationId = card?.dataset.kanbanCardId;
      const application = applications.find(({ id }) => id === applicationId);
      if (!application) return;
      if (shortcut === "archive-focused") {
        event.preventDefault();
        onArchiveFocused(application);
      } else {
        event.preventDefault();
        onDeleteFocused(application, focused);
      }
    }

    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  });

  // Runs after the listener effect above, so end-to-end tests can wait for shortcuts to be live.
  useEffect(() => {
    document.documentElement.dataset.shortcutsReady = "true";
    return () => { delete document.documentElement.dataset.shortcutsReady; };
  }, []);
}
