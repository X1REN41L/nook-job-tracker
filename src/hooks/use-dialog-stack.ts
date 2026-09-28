"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

type DialogEntry = {
  dialog: HTMLElement;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape: () => void;
};

const FOCUSABLE_SELECTOR = "button:not([disabled]), [href], input:not([disabled]):not([tabindex='-1']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// Open dialogs, bottom to top. Only the topmost one traps focus and handles Escape;
// the ones below it are suspended until it closes.
const stack: DialogEntry[] = [];

function focusableControls(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function focusTarget({ dialog, initialFocusRef }: DialogEntry) {
  return initialFocusRef?.current ?? focusableControls(dialog)[0] ?? dialog;
}

// dnd-kit marks the dragged activator with aria-pressed; its sensors cancel the drag on Escape.
function dragInProgress() {
  return document.querySelector("[aria-roledescription='draggable'][aria-pressed='true']") !== null;
}

function trapTab(event: KeyboardEvent) {
  const top = stack.at(-1);
  if (!top || event.key !== "Tab") return;
  const controls = focusableControls(top.dialog);
  event.preventDefault();
  if (!controls.length) { top.dialog.focus(); return; }
  const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
  const nextIndex = event.shiftKey
    ? currentIndex <= 0 ? controls.length - 1 : currentIndex - 1
    : currentIndex < 0 || currentIndex === controls.length - 1 ? 0 : currentIndex + 1;
  controls[nextIndex]?.focus();
}

function closeTopOnEscape(event: KeyboardEvent) {
  const top = stack.at(-1);
  if (!top || event.key !== "Escape" || event.defaultPrevented || dragInProgress()) return;
  event.preventDefault();
  top.onEscape();
}

function keepFocusInside(event: FocusEvent) {
  const top = stack.at(-1);
  if (!top || top.dialog.contains(event.target as Node)) return;
  focusTarget(top).focus();
}

function pushDialog(entry: DialogEntry) {
  if (!stack.length) {
    document.addEventListener("keydown", trapTab, true);
    document.addEventListener("keydown", closeTopOnEscape);
    document.addEventListener("focusin", keepFocusInside);
  }
  stack.push(entry);
}

function removeDialog(entry: DialogEntry) {
  const index = stack.indexOf(entry);
  if (index >= 0) stack.splice(index, 1);
  if (!stack.length) {
    document.removeEventListener("keydown", trapTab, true);
    document.removeEventListener("keydown", closeTopOnEscape);
    document.removeEventListener("focusin", keepFocusInside);
  }
  return index === stack.length;
}

/**
 * Registers an open dialog on the shared dialog stack while `active` is true: focuses its initial
 * control, traps Tab and focus while it is topmost, routes Escape to it, and returns focus to the
 * trigger as soon as it stops being active (when its exit starts, not when it unmounts).
 */
export function useDialogStack({ dialogRef, initialFocusRef, returnFocusRef, active, onEscape }: {
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  active: boolean;
  onEscape: () => void;
}) {
  const onEscapeRef = useRef(onEscape);
  useLayoutEffect(() => {
    onEscapeRef.current = onEscape;
  });

  // A passive effect, not a layout effect: React DOM restores the pre-commit focus after its mutation
  // phase, which would undo a focus return made from a layout cleanup while the dialog is still mounted.
  // All passive cleanups in a commit still run before any passive setup, so a closing dialog returns
  // focus before a dialog opened in the same commit captures its own return target.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!active || !dialog) return;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnFocusTo = returnFocusRef?.current ?? activeElement;
    const entry: DialogEntry = { dialog, initialFocusRef, onEscape: () => onEscapeRef.current() };
    pushDialog(entry);
    focusTarget(entry).focus();

    return () => {
      const wasTopmost = removeDialog(entry);
      const focused = document.activeElement;
      const focusWasInside = !focused || focused === document.body || dialog.contains(focused);
      if (wasTopmost && focusWasInside && returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [active, dialogRef, initialFocusRef, returnFocusRef]);
}
