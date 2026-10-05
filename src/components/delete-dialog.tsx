"use client";

import { useRef } from "react";
import type { RefObject } from "react";

import { Dialog, DIALOG_BACKDROP_TONE } from "@/components/dialog";
import { StableButtonLabel } from "@/components/stable-button-label";
import type { ApplicationSummary } from "@/types/application";

export function DeleteDialog({ applications, deleting, onCancel, onConfirm, returnFocusRef }: {
  /** One application, or several selected in the table. */
  applications: ApplicationSummary[];
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [application] = applications;
  const several = applications.length > 1;

  return <Dialog backdropClassName={`motion-dialog-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4 ${DIALOG_BACKDROP_TONE}`} className="motion-dialog-panel w-full max-w-md rounded-nook-lg border border-line bg-paper p-6 text-ink shadow-nook-lift outline-none" closeDisabled={deleting} describedBy="delete-description" initialFocusRef={cancelRef} labelledBy="delete-title" onClose={onCancel} returnFocusRef={returnFocusRef} role="alertdialog">
    <h2 className="font-serif text-lg font-semibold" id="delete-title">{several ? `Delete ${applications.length} applications?` : "Delete application?"}</h2>
    <p className="mt-2 text-sm leading-6 text-ink-soft" id="delete-description">
      {several
        ? <>Delete the <span className="font-medium text-ink">{applications.length} selected applications</span>. You can restore them for 10 minutes after deleting them.</>
        : <>Delete the <span className="font-medium text-ink">{application.role}</span> application at <span className="font-medium text-ink">{application.company}</span>. You can restore it for 10 minutes after deleting it.</>}
    </p>
    <div className="mt-6 flex justify-end gap-3">
      <button ref={cancelRef} className="btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={deleting} onClick={onCancel} type="button">Cancel</button>
      <button className="btn-danger-solid" disabled={deleting} onClick={onConfirm} type="button"><StableButtonLabel label="Delete" busyLabel="Deleting…" busy={deleting} /></button>
    </div>
  </Dialog>;
}
