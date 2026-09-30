import Link from "next/link";
import type { CSSProperties } from "react";

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

/** Each card's number starts rolling this long after the card before it. */
const CARD_STAGGER_MS = 60;
/** Within a number, each digit settles this long after the one to its left. */
const DIGIT_STAGGER_MS = 50;
const DIGIT_STRIP = Array.from({ length: 20 }, (_, index) => index % 10);

/**
 * Rolls each digit up into place like an odometer: every column passes through
 * a full 0–9 turn before stopping, so small numbers roll as smoothly as large
 * ones. Other characters (".", "%") fade in. Motion preferences skip the roll.
 */
function RollingNumber({ text, delayMs }: { text: string; delayMs: number }) {
  const characters = [...text];
  return (
    <>
      <span aria-hidden="true" className="odometer">
        {characters.map((character, index) => {
          // Keyed from the right, so the ones column stays the same element when the number changes length.
          const key = characters.length - index;
          const delay = `${delayMs + index * DIGIT_STAGGER_MS}ms`;
          if (!/\d/.test(character)) {
            return <span className="odometer-static" key={key} style={{ animationDelay: delay }}>{character}</span>;
          }
          // The hidden final digit sets the column's natural width, so the settled number is spaced like plain text.
          return (
            <span className="odometer-digit" key={key}>
              <span className="odometer-sizer">{character}</span>
              <span className="odometer-strip" style={{ "--odometer-stop": 10 + Number(character), animationDelay: delay } as CSSProperties}>
                {DIGIT_STRIP.map((digit, row) => <span key={row}>{digit}</span>)}
              </span>
            </span>
          );
        })}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}

/** A dashboard number. With `href`, the whole card links to the matching list of applications. Numbers roll into place when they appear or change. */
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
        {typeof value === "number" ? <RollingNumber delayMs={order * CARD_STAGGER_MS} text={format(value)} /> : value}
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
