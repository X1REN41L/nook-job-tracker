"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motionIsCurrentlyOff } from "@/lib/general-preferences";

/** Keeps a dialog mounted through its short exit so its focus trap restores focus afterwards. */
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
    const exitDuration = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--motion-exit")) || 160;
    const timeout = window.setTimeout(() => setMounted(false), immediateExit || reduced ? 0 : exitDuration);
    return () => window.clearTimeout(timeout);
  }, [open, mounted, immediateExit]);

  if (!open && (!mounted || immediateExit)) return null;
  return <div data-motion-presence={open ? "open" : "closing"} style={{ display: "contents" }}>
    {open ? children : snapshot.children}
  </div>;
}
