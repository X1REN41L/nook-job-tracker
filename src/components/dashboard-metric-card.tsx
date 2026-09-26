type HistoryCoverage = {
  completeApplications: number;
  totalApplications: number;
  isComplete: boolean;
};

export function formatDashboardPercentage(value: number) {
  return `${Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value) : "0"}%`;
}

export function DashboardMetricCard({ label, value, detail, coverage }: {
  label: string;
  value: string | number;
  detail: string;
  coverage?: HistoryCoverage;
}) {
  return (
    <div className="flex min-h-36 min-w-0 flex-col rounded-nook border border-line bg-paper p-4">
      <h2 className="min-h-10 text-sm font-medium leading-5 text-ink-soft">{label}</h2>
      <p className="mt-2 font-serif text-2xl font-semibold leading-tight text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-soft">{detail}</p>
      {coverage && !coverage.isComplete && (
        <p className="mt-2 text-xs leading-4 text-ink-soft">
          History available for {coverage.completeApplications} of {coverage.totalApplications}
        </p>
      )}
    </div>
  );
}
