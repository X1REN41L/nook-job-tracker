"use client";

import { Status } from "@prisma/client";
import { useCallback, useEffect, useRef, useState } from "react";

const TOAST_DURATION_MS = 2400;
const UNDO_TOAST_DURATION_MS = 5000;

export type ToastUndo =
  | { kind: "delete"; applicationId: string; token: string; expiresAt: string; company: string }
  | { kind: "status"; applicationId: string; status: Status; archived: boolean; interviewDate: string | null; interviewDatePromptDismissed: boolean };

export type DeleteRecovery = Extract<ToastUndo, { kind: "delete" }>;

type ToastState = {
  message: string;
  undo?: ToastUndo;
};

export function useToastUndo({ onUndo }: { onUndo: (undo: ToastUndo, restoreKeyboardFocus: boolean) => Promise<void> }) {
  const [toast, setToastState] = useState<ToastState | null>(null);
  const [deleteRecovery, setDeleteRecoveryState] = useState<DeleteRecovery | null>(null);
  const [undoing, setUndoing] = useState(false);
  const toastRef = useRef<ToastState | null>(null);
  const deleteRecoveryRef = useRef<DeleteRecovery | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTiming = useRef({ remaining: 0, startedAt: 0 });
  const toastInteraction = useRef({ focused: false, hovered: false, hidden: false });
  const undoInFlight = useRef(false);

  const scheduleToastDismissTimer = useCallback(() => {
    if (
      !toastRef.current ||
      toastTimer.current ||
      toastInteraction.current.focused ||
      toastInteraction.current.hovered ||
      toastInteraction.current.hidden
    ) return;

    toastTiming.current.startedAt = performance.now();
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      toastTiming.current = { remaining: 0, startedAt: 0 };
      toastRef.current = null;
      setToastState(null);
    }, toastTiming.current.remaining);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    toastTiming.current = { remaining: 0, startedAt: 0 };
    toastInteraction.current = {
      focused: false,
      hovered: false,
      hidden: document.visibilityState === "hidden",
    };
    toastRef.current = null;
    setToastState(null);
  }, []);

  const clearDeleteRecovery = useCallback((token: string) => {
    if (deleteRecoveryRef.current?.token !== token) return;
    deleteRecoveryRef.current = null;
    setDeleteRecoveryState(null);
    if (toastRef.current?.undo?.kind === "delete" && toastRef.current.undo.token === token) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = null;
      toastTiming.current = { remaining: 0, startedAt: 0 };
      toastRef.current = null;
      setToastState(null);
    }
  }, []);

  const expireDeleteRecovery = useCallback((token: string) => {
    const recovery = deleteRecoveryRef.current;
    if (!recovery || recovery.token !== token || Date.parse(recovery.expiresAt) > Date.now()) return;
    clearDeleteRecovery(token);
  }, [clearDeleteRecovery]);

  useEffect(() => {
    if (!deleteRecovery) return;
    const expiresAt = Date.parse(deleteRecovery.expiresAt);
    const expire = () => expireDeleteRecovery(deleteRecovery.token);
    const timer = setTimeout(expire, Math.max(0, expiresAt - Date.now()));
    document.addEventListener("visibilitychange", expire);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", expire);
    };
  }, [clearDeleteRecovery, deleteRecovery, expireDeleteRecovery]);

  useEffect(() => {
    function handleVisibilityChange() {
      const isHidden = document.visibilityState === "hidden";
      toastInteraction.current.hidden = isHidden;
      if (isHidden) {
        if (toastTimer.current) {
          clearTimeout(toastTimer.current);
          toastTiming.current.remaining = Math.max(
            0,
            toastTiming.current.remaining - (performance.now() - toastTiming.current.startedAt),
          );
          toastTimer.current = null;
        }
        return;
      }

      const recovery = deleteRecoveryRef.current;
      if (recovery) expireDeleteRecovery(recovery.token);
      scheduleToastDismissTimer();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [expireDeleteRecovery, scheduleToastDismissTimer]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  function resumeToastDismissTimer() {
    scheduleToastDismissTimer();
  }

  function pauseToastDismissTimer(interaction: "focus" | "hover") {
    toastInteraction.current[interaction === "focus" ? "focused" : "hovered"] = true;
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
      toastTiming.current.remaining = Math.max(
        0,
        toastTiming.current.remaining - (performance.now() - toastTiming.current.startedAt),
      );
    }
    toastTimer.current = null;
  }

  function endToastInteraction(interaction: "focus" | "hover") {
    toastInteraction.current[interaction === "focus" ? "focused" : "hovered"] = false;
    scheduleToastDismissTimer();
  }

  function resumeUndoToastOnTab() {
    if (toastRef.current?.undo && !toastTimer.current) resumeToastDismissTimer();
  }

  function showToast(message: string, undo?: ToastState["undo"]) {
    const nextToast = { message, undo };
    toastRef.current = nextToast;
    setToastState(nextToast);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastInteraction.current = {
      focused: false,
      hovered: false,
      hidden: document.visibilityState === "hidden",
    };
    toastTiming.current = {
      remaining: undo ? UNDO_TOAST_DURATION_MS : TOAST_DURATION_MS,
      startedAt: 0,
    };

    if (undo?.kind === "delete" && Number.isFinite(Date.parse(undo.expiresAt)) && Date.parse(undo.expiresAt) > Date.now()) {
      deleteRecoveryRef.current = undo;
      setDeleteRecoveryState(undo);
    }
    scheduleToastDismissTimer();
  }

  async function performUndo(undo: ToastUndo | undefined, restoreKeyboardFocus: boolean) {
    if (!undo || undoInFlight.current) return;
    if (undo.kind === "delete" && Date.parse(undo.expiresAt) <= Date.now()) {
      expireDeleteRecovery(undo.token);
      showToast("The recovery window has expired");
      return;
    }

    undoInFlight.current = true;
    setUndoing(true);
    dismissToast();
    try {
      await onUndo(undo, restoreKeyboardFocus);
      if (undo.kind === "delete") clearDeleteRecovery(undo.token);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not restore the application";
      const expired = undo.kind === "delete" && (
        Date.parse(undo.expiresAt) <= Date.now() || /expired|already used/i.test(message)
      );
      if (expired && undo.kind === "delete") {
        clearDeleteRecovery(undo.token);
        showToast(message);
      } else {
        showToast(message, undo);
      }
    } finally {
      undoInFlight.current = false;
      setUndoing(false);
    }
  }

  function undoLatestChange(restoreKeyboardFocus = false) {
    const undo = toastRef.current?.undo ?? deleteRecoveryRef.current ?? undefined;
    return performUndo(undo, restoreKeyboardFocus);
  }

  function undoDeleteRecovery(restoreKeyboardFocus = false) {
    return performUndo(deleteRecoveryRef.current ?? undefined, restoreKeyboardFocus);
  }

  function clearApplicationUndo() {
    dismissToast();
    deleteRecoveryRef.current = null;
    setDeleteRecoveryState(null);
  }

  return {
    toast,
    deleteRecovery,
    undoing,
    showToast,
    pauseToastDismissTimer,
    endToastInteraction,
    resumeUndoToastOnTab,
    undoLatestChange,
    undoDeleteRecovery,
    clearApplicationUndo,
  };
}
