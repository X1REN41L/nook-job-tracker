"use client";

import { useEffect } from "react";

import { matchDashboardShortcut } from "@/lib/keyboard-shortcuts";
import type { ApplicationRecord } from "@/types/application";

type DashboardShortcutOptions = {
  isMac: boolean;
  applications: ApplicationRecord[];
  isModalOpen: boolean;
  hasPendingDuplicate: boolean;
  hasPendingDelete: boolean;
  hasPendingInterviewDate: boolean;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
  dragActive: boolean;
  canUndo: boolean;
  onResumeUndoToastOnTab: () => void;
  onCloseShortcuts: () => void;
  onCloseSettings: () => void;
  onNewJob: () => void;
  onOpenSettings: () => void;
  onFocusSearch: () => void;
  onShowShortcuts: () => void;
  onUndo: () => void;
  onToggleSidebar: () => void;
  onArchiveFocused: (application: ApplicationRecord) => void;
  onDeleteFocused: (application: ApplicationRecord, focused: HTMLElement | null) => void;
};

export function useDashboardShortcuts({
  isMac,
  applications,
  isModalOpen,
  hasPendingDuplicate,
  hasPendingDelete,
  hasPendingInterviewDate,
  shortcutsOpen,
  settingsOpen,
  dragActive,
  canUndo,
  onResumeUndoToastOnTab,
  onCloseShortcuts,
  onCloseSettings,
  onNewJob,
  onOpenSettings,
  onFocusSearch,
  onShowShortcuts,
  onUndo,
  onToggleSidebar,
  onArchiveFocused,
  onDeleteFocused,
}: DashboardShortcutOptions) {
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.key === "Tab") onResumeUndoToastOnTab();
      if (event.repeat) return;
      const shortcut = matchDashboardShortcut(event, isMac);
      if (!shortcut) return;

      if (shortcut === "close") {
        if (shortcutsOpen) {
          event.preventDefault();
          onCloseShortcuts();
        } else if (settingsOpen) {
          event.preventDefault();
          onCloseSettings();
        }
        return;
      }

      const anotherDialogIsOpen = isModalOpen || hasPendingDuplicate || hasPendingDelete || hasPendingInterviewDate || shortcutsOpen || settingsOpen;
      if (anotherDialogIsOpen || dragActive) return;

      if (shortcut === "new-job") {
        event.preventDefault();
        onNewJob();
        return;
      }
      if (shortcut === "open-settings") {
        event.preventDefault();
        onOpenSettings();
        return;
      }
      if (shortcut === "focus-search") {
        event.preventDefault();
        onFocusSearch();
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

      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const applicationId = focused?.closest<HTMLElement>("[data-application-id]")?.dataset.applicationId;
      const application = applications.find(({ id }) => id === applicationId);
      if (!application) return;
      if (shortcut === "archive-focused") {
        event.preventDefault();
        onArchiveFocused(application);
      } else if (shortcut === "delete-focused") {
        event.preventDefault();
        onDeleteFocused(application, focused);
      }
    }

    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  });
}
