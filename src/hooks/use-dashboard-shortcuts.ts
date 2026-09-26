"use client";

import { useEffect, useRef } from "react";

import { matchDashboardShortcut, startsShortcutSequence } from "@/lib/keyboard-shortcuts";
import type { ApplicationPageName } from "@/components/application-dashboard";
import type { ApplicationRecord } from "@/types/application";

type DashboardShortcutOptions = {
  isMac: boolean;
  page: ApplicationPageName;
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
  onFocusSearch: () => boolean;
  onShowShortcuts: () => void;
  onUndo: () => void;
  onToggleSidebar: () => void;
  onNavigate: (path: string) => void;
  onSwitchInterviewTab: (direction: "left" | "right") => boolean;
  onMoveApplicationFocus: (direction: "up" | "down" | "left" | "right") => boolean;
  onArchiveFocused: (application: ApplicationRecord) => void;
  onDeleteFocused: (application: ApplicationRecord, focused: HTMLElement | null) => void;
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
  onNavigate,
  onSwitchInterviewTab,
  onMoveApplicationFocus,
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
      if (startsShortcutSequence(event)) {
        pendingPrefixRef.current = { key: event.key.toLowerCase(), at: Date.now() };
        event.preventDefault();
        return;
      }
      if (!shortcut) return;

      if (shortcut === "go-dashboard" || shortcut === "go-job-board" || shortcut === "go-interviews") {
        event.preventDefault();
        onNavigate(shortcut === "go-dashboard" ? "/dashboard" : shortcut === "go-job-board" ? "/jobs" : "/interviews");
        return;
      }
      if (shortcut === "interview-tab-left" || shortcut === "interview-tab-right") {
        if (onSwitchInterviewTab(shortcut === "interview-tab-left" ? "left" : "right")) event.preventDefault();
        return;
      }
      if (shortcut === "focus-application-up" || shortcut === "focus-application-down" || shortcut === "focus-column-left" || shortcut === "focus-column-right") {
        const direction = shortcut === "focus-application-up" ? "up" : shortcut === "focus-application-down" ? "down" : shortcut === "focus-column-left" ? "left" : "right";
        if (onMoveApplicationFocus(direction)) event.preventDefault();
        return;
      }

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
        const unhandled: never = shortcut;
        return unhandled;
      }

      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const applicationId = focused?.closest<HTMLElement>("[data-application-id]")?.dataset.applicationId;
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
}
