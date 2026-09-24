"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

export function useDialogFocusTrap(
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
  returnFocusRef: RefObject<HTMLElement | null>,
  suspended = false,
) {
  const suspendedRef = useRef(suspended);
  useLayoutEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const returnFocusTo = returnFocusRef.current;
    document.body.style.overflow = "hidden";
    initialFocusRef.current?.focus();

    function focusableControls() {
      if (!dialogRef.current) return [];
      return Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]):not([tabindex='-1']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (suspendedRef.current || event.key !== "Tab" || !dialogRef.current) return;
      const controls = focusableControls();
      if (!controls.length) { event.preventDefault(); dialogRef.current.focus(); return; }

      const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? currentIndex <= 0 ? controls.length - 1 : currentIndex - 1
        : currentIndex < 0 || currentIndex === controls.length - 1 ? 0 : currentIndex + 1;
      event.preventDefault();
      controls[nextIndex]?.focus();
    }

    function keepFocusInside(event: FocusEvent) {
      if (suspendedRef.current || !dialogRef.current || dialogRef.current.contains(event.target as Node)) return;
      (initialFocusRef.current ?? focusableControls()[0] ?? dialogRef.current).focus();
    }

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", keepFocusInside);
      document.body.style.overflow = previousOverflow;
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [dialogRef, initialFocusRef, returnFocusRef]);
}
