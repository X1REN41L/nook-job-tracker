export function StableButtonLabel({ label, busyLabel, busy }: {
  label: string;
  busyLabel: string;
  busy: boolean;
}) {
  return <span className="inline-grid">
    <span aria-hidden="true" className="invisible col-start-1 row-start-1">{label}</span>
    <span aria-hidden="true" className="invisible col-start-1 row-start-1">{busyLabel}</span>
    <span className="col-start-1 row-start-1 text-center">{busy ? busyLabel : label}</span>
  </span>;
}
