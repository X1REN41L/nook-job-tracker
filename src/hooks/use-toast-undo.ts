"use client";

import { Status } from "@prisma/client";
import { useEffect, useRef, useState } from "react";


const TOAST_DURATION_MS = 2400;
const UNDO_TOAST_DURATION_MS = 5000;

export type ToastUndo =
  | { kind: "delete"; applicationId: string; token: string }
  | { kind: "status"; applicationId: string; status: Status; archived: boolean; interviewDate: string | null; interviewDatePromptDismissed: boolean };

type ToastState = {
  message: string;
  undo?: ToastUndo;
};

export function useToastUndo({ onUndo }: { onUndo: (undo: ToastUndo, restoreKeyboardFocus: boolean) => Promise<void> }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTiming = useRef({ remaining: 0, startedAt: 0 });
  const toastInteraction = useRef({ focused: false, hovered: false });
  const undoInFlight = useRef(false);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  function dismissToast() {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    toastTiming.current = { remaining: 0, startedAt: 0 };
    toastInteraction.current = { focused: false, hovered: false };
    setToast(null);
  }

  function resumeToastDismissTimer() {
    if (!toast || toastInteraction.current.focused || toastInteraction.current.hovered) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTiming.current.startedAt = performance.now();
    toastTimer.current = setTimeout(
      () => {
        toastTimer.current = null;
        toastTiming.current = { remaining: 0, startedAt: 0 };
        setToast(null);
      },
      toastTiming.current.remaining,
    );
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
    resumeToastDismissTimer();
  }

  function resumeUndoToastOnTab() {
    if (toast?.undo && !toastTimer.current) resumeToastDismissTimer();
  }

  function showToast(message: string, undo?: ToastState["undo"]) {
    setToast({ message, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastInteraction.current = { focused: false, hovered: false };
    toastTiming.current = {
      remaining: undo ? UNDO_TOAST_DURATION_MS : TOAST_DURATION_MS,
      startedAt: performance.now(),
    };
    toastTimer.current = setTimeout(
      () => {
        toastTimer.current = null;
        toastTiming.current = { remaining: 0, startedAt: 0 };
        setToast(null);
      },
      toastTiming.current.remaining,
    );
  }

  async function undoLatestChange(restoreKeyboardFocus = false) {
    const undo = toast?.undo;
    if (!undo || undoInFlight.current) return;
    undoInFlight.current = true;
    dismissToast();
    try {
      await onUndo(undo, restoreKeyboardFocus);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Could not restore the application", undo);
    } finally {
      undoInFlight.current = false;
    }
  }

  return { toast, showToast, pauseToastDismissTimer, endToastInteraction, resumeUndoToastOnTab, undoLatestChange };
}
