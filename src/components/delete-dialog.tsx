"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap";
import type { ApplicationRecord } from "@/types/application";

export function DeleteDialog({ application, deleting, onCancel, onConfirm, returnFocusRef }: {
  application: ApplicationRecord;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const deletingRef = useRef(deleting);

  useEffect(() => {
    deletingRef.current = deleting;
  }, [deleting]);

  useDialogFocusTrap(dialogRef, cancelRef, returnFocusRef);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deletingRef.current) {
        event.preventDefault();
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) onCancel(); }}>
    <section ref={dialogRef} aria-describedby="delete-description" aria-labelledby="delete-title" aria-modal="true" className="w-full max-w-md rounded-nook-lg border border-line bg-paper p-6 text-ink shadow-nook-lift outline-none" role="alertdialog" tabIndex={-1}>
      <h2 className="font-serif text-lg font-semibold" id="delete-title">Delete application?</h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft" id="delete-description">Delete the <span className="font-medium text-ink">{application.role}</span> application at <span className="font-medium text-ink">{application.company}</span>. You can restore it for 10 minutes after deleting it.</p>
      <div className="mt-6 flex justify-end gap-3">
        <button ref={cancelRef} className="btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={deleting} onClick={onCancel} type="button">Cancel</button>
        <button className="rounded-nook-sm bg-rose px-4 py-2 text-sm font-medium text-cream transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-60" disabled={deleting} onClick={onConfirm} type="button">{deleting ? "Deleting…" : "Delete"}</button>
      </div>
    </section>
  </div>;
}
