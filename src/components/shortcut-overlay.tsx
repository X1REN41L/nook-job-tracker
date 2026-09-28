"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { ShortcutList } from "@/components/shortcut-list";
import { Dialog } from "@/components/dialog";
import { MODAL_HEADER_CLASS, MODAL_SHELL_CLASS } from "@/components/settings-modal-shell";

export function ShortcutOverlay({ isMac, onClose, returnFocusRef }: {
  isMac: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [showBottomFade, setShowBottomFade] = useState(false);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const updateFade = () => setShowBottomFade(list.scrollTop + list.clientHeight < list.scrollHeight - 1);
    const observer = new ResizeObserver(updateFade);
    observer.observe(list);
    updateFade();
    return () => observer.disconnect();
  }, []);

  return (
    <Dialog backdropClassName="motion-dialog-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-modal-backdrop/40 p-4 backdrop-blur-[2px]" className={MODAL_SHELL_CLASS} initialFocusRef={closeRef} labelledBy="shortcut-dialog-title" onClose={onClose} returnFocusRef={returnFocusRef}>
      <div className={MODAL_HEADER_CLASS}>
        <div>
          <h2 className="font-serif text-xl font-semibold" id="shortcut-dialog-title">Keyboard Shortcuts</h2>
        </div>
        <button ref={closeRef} aria-label="Close" className="icon-btn shrink-0" onClick={onClose} type="button">
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="scrollbar-styled h-full overflow-y-auto px-6 pb-7 pt-5" onScroll={() => {
          const list = listRef.current;
          if (list) setShowBottomFade(list.scrollTop + list.clientHeight < list.scrollHeight - 1);
        }} ref={listRef}>
          <ShortcutList isMac={isMac} />
        </div>
        {showBottomFade && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-paper to-transparent" />}
      </div>
    </Dialog>
  );
}
