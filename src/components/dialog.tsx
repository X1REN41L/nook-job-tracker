"use client";

import { useRef, type ReactNode, type RefObject } from "react";

import { usePresence } from "@/components/motion-presence";
import { useDialogStack } from "@/hooks/use-dialog-stack";

/** Backdrop tone every dialog shares; each dialog adds its own z-index, layout, and padding. */
export const DIALOG_BACKDROP_TONE = "bg-modal-backdrop/40 backdrop-blur-[2px]";

/** Modal dialog shell: backdrop, labelled panel, and the shared dialog-stack focus and Escape handling. */
export function Dialog({
  role = "dialog",
  labelledBy,
  describedBy,
  busy,
  backdropClassName,
  className,
  initialFocusRef,
  returnFocusRef,
  onClose,
  closeDisabled = false,
  closeOnBackdrop = true,
  children,
}: {
  role?: "dialog" | "alertdialog";
  labelledBy: string;
  describedBy?: string;
  busy?: boolean;
  backdropClassName: string;
  className: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  closeDisabled?: boolean;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const active = usePresence();
  useDialogStack({
    dialogRef,
    initialFocusRef,
    returnFocusRef,
    active,
    onEscape: () => { if (!closeDisabled) onClose(); },
  });

  return (
    <div
      className={backdropClassName}
      onMouseDown={(event) => {
        if (closeOnBackdrop && active && event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <section ref={dialogRef} aria-busy={busy} aria-describedby={describedBy} aria-labelledby={labelledBy} aria-modal="true" className={className} role={role} tabIndex={-1}>
        {children}
      </section>
    </div>
  );
}
