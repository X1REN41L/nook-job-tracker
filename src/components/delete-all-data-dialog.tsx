"use client";

import { useRef } from "react";
import type { RefObject } from "react";

import { Dialog } from "@/components/dialog";
import { StableButtonLabel } from "@/components/stable-button-label";

export function DeleteAllDataDialog({ deleting, onCancel, onConfirm, returnFocusRef }: {
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  return <Dialog backdropClassName="motion-dialog-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-modal-backdrop/60 p-4 backdrop-blur-sm" className="motion-dialog-panel w-full max-w-md rounded-nook-lg border border-line bg-paper p-6 text-ink shadow-nook-lift outline-none" closeDisabled={deleting} describedBy="delete-all-description" initialFocusRef={cancelRef} labelledBy="delete-all-title" onClose={onCancel} returnFocusRef={returnFocusRef} role="alertdialog">
    <h2 className="font-serif text-lg font-semibold" id="delete-all-title">Delete all data?</h2>
    <p className="mt-2 text-sm leading-6 text-ink-soft" id="delete-all-description">This will permanently delete all applications and their history. This action cannot be undone.</p>
    <div className="mt-6 flex justify-end gap-3">
      <button ref={cancelRef} className="btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={deleting} onClick={onCancel} type="button">Cancel</button>
      <button className="rounded-nook-sm bg-rose px-4 py-2 text-sm font-medium text-cream motion-interactive hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-60" disabled={deleting} onClick={onConfirm} type="button"><StableButtonLabel label="Delete all data" busyLabel="Deleting…" busy={deleting} /></button>
    </div>
  </Dialog>;
}
