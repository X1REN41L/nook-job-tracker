import Link from "next/link";

type HistoryCoverage = {
  completeApplications: number;
  totalApplications: number;
  isComplete: boolean;
};

export function formatDashboardPercentage(value: number) {
  return `${Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value) : "0"}%`;
}

/** A dashboard number. With `href`, the whole card links to the matching list of applications. */
export function DashboardMetricCard({ label, value, detail, coverage, explanation, href }: {
  label: string;
  value: string | number;
  detail: string;
  coverage?: HistoryCoverage;
  explanation?: string;
  href?: string;
}) {
  const content = (
    <>
      <p className="min-h-10 text-sm font-medium leading-5 text-ink-soft" title={explanation}>{label}</p>
      <p className="mt-2 font-serif text-2xl font-semibold leading-tight text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-soft">{detail}</p>
      {coverage && !coverage.isComplete && (
        <p className="mt-2 text-xs leading-4 text-ink-soft">
          History available for {coverage.completeApplications} of {coverage.totalApplications}
        </p>
      )}
    </>
  );
  const className = "flex min-h-36 min-w-0 flex-col rounded-nook border border-line bg-paper p-4";
  return href ? (
    <Link className={`${className} motion-interactive hover:border-forest hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest`} href={href}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}
