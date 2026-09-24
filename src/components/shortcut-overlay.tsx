"use client";

import { useRef } from "react";
import type { RefObject } from "react";

import { ShortcutList } from "@/components/shortcut-list";
import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap";

export function ShortcutOverlay({ isMac, onClose, returnFocusRef }: {
  isMac: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useDialogFocusTrap(dialogRef, closeRef, returnFocusRef);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/40 p-4 pt-[14vh] backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} aria-labelledby="shortcut-dialog-title" aria-modal="true" className="w-full max-w-md rounded-nook-lg border border-line bg-paper p-5 text-ink shadow-nook-lift outline-none" role="dialog" tabIndex={-1}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-serif text-xl font-semibold" id="shortcut-dialog-title">Keyboard shortcuts</h2>
          </div>
          <button ref={closeRef} aria-label="Close" className="icon-btn shrink-0" onClick={onClose} type="button">
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <ShortcutList className="mt-5" isMac={isMac} />
      </section>
    </div>
  );
}
