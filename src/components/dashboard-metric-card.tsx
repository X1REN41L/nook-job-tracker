"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { motionDurationMs, motionIsCurrentlyOff } from "@/lib/general-preferences";
import { revealDelay } from "@/lib/motion-mode";

type HistoryCoverage = {
  completeApplications: number;
  totalApplications: number;
  isComplete: boolean;
};

export function formatDashboardPercentage(value: number) {
  return `${Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value) : "0"}%`;
}

export function formatDashboardCount(value: number) {
  return String(Math.round(value));
}

/** Each card rises this long after the card before it. */
const CARD_STAGGER_MS = 60;
/** A card's number starts counting this long after its card, so the card lands first. */
const NUMBER_DELAY_MS = 80;

/**
 * A number that counts up from zero as it rises into its card, warming from soft
 * to full ink as it lands. A value that changes in place counts from the old
 * value to the new one. Motion preferences show the value at once.
 */
function MetricNumber({ value, format, delayMs }: { value: number; format: (value: number) => string; delayMs: number }) {
  const [mountedAt] = useState(() => performance.now());
  const [shown, setShown] = useState(() => (motionIsCurrentlyOff() ? value : 0));
  const countedFrom = useRef(shown);

  useEffect(() => {
    let frame = 0;
    if (motionIsCurrentlyOff()) {
      frame = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(frame);
    }
    const from = countedFrom.current;
    const duration = motionDurationMs("--motion-count", 1400);
    // Only the first count waits for the card; later changes count at once.
    const delay = Math.max(0, delayMs - (performance.now() - mountedAt));
    let startedAt: number | null = null;
    const tick = (now: number) => {
      startedAt ??= now + delay;
      const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
      // A gentle ease-out (--motion-count-ease), so the count slows into its value without stalling on the last digit.
      const current = from + (value - from) * (1 - (1 - progress) ** 3);
      countedFrom.current = current;
      setShown(progress === 1 ? value : current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, delayMs, mountedAt]);

  const text = shown === value ? format(value) : format(Math.round(shown));
  return (
    <>
      <span aria-hidden="true" className="motion-number tabular-nums" style={{ animationDelay: `${delayMs}ms` }}>{text}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

/** A dashboard number. With `href`, the whole card links to the matching list of applications. Numbers count up into place when they appear or change. */
export function DashboardMetricCard({ label, value, format = formatDashboardCount, order = 0, detail, coverage, explanation, href }: {
  label: string;
  value: number | string;
  format?: (value: number) => string;
  /** The card's position in its row, for the left-to-right stagger. */
  order?: number;
  detail?: string;
  coverage?: HistoryCoverage;
  explanation?: string;
  href?: string;
}) {
  const content = (
    <>
      <p className="min-h-10 text-sm font-medium leading-5 text-ink-soft" title={explanation}>{label}</p>
      <p className="mt-2 font-serif text-2xl font-semibold leading-tight text-ink">
        {typeof value === "number" ? <MetricNumber delayMs={order * CARD_STAGGER_MS + NUMBER_DELAY_MS} format={format} value={value} /> : value}
      </p>
      {detail && <p className="mt-1 text-xs text-ink-soft">{detail}</p>}
      {coverage && !coverage.isComplete && (
        <p className="mt-2 text-xs leading-4 text-ink-soft">
          History available for {coverage.completeApplications} of {coverage.totalApplications}
        </p>
      )}
    </>
  );
  const className = "motion-reveal flex min-h-36 min-w-0 flex-col rounded-nook border border-line bg-paper p-4";
  const style = revealDelay(order, { step: CARD_STAGGER_MS });
  return href ? (
    <Link style={style} className={`${className} motion-interactive hover:border-forest hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest`} href={href}>
      {content}
    </Link>
  ) : (
    <div className={className} style={style}>{content}</div>
  );
}
