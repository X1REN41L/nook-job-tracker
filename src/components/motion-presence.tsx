"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { motionDurationMs, motionIsCurrentlyOff } from "@/lib/general-preferences";

const PresenceContext = createContext(true);

/** False while a dialog is kept mounted only for its exit animation. */
export function usePresence() {
  return useContext(PresenceContext);
}

/** Keeps a dialog mounted through its short exit; dialogs read `usePresence()` to stop handling focus and keys as soon as they start closing. */
export function MotionPresence({ open, children, immediateExit = false }: {
  open: boolean;
  children: ReactNode;
  immediateExit?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [snapshot, setSnapshot] = useState({ children });
  if (open && snapshot.children !== children) setSnapshot({ children });
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const reduced = motionIsCurrentlyOff();
    const exitDuration = motionDurationMs("--motion-exit", 160);
    const timeout = window.setTimeout(() => setMounted(false), immediateExit || reduced ? 0 : exitDuration);
    return () => window.clearTimeout(timeout);
  }, [open, mounted, immediateExit]);

  if (!open && (!mounted || immediateExit)) return null;
  return <div data-motion-presence={open ? "open" : "closing"} style={{ display: "contents" }}>
    <PresenceContext value={open}>
      {open ? children : snapshot.children}
    </PresenceContext>
  </div>;
}
