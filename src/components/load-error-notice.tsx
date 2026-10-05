import { StableButtonLabel } from "@/components/stable-button-label";

/** A failed dashboard request, with a Retry button that stays disabled while the retry runs. */
export function LoadErrorNotice({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-nook-sm border border-rose bg-rose-tint px-4 py-3 text-sm text-ink" role="alert">
      <p>{message}</p>
      <button className="btn-ghost px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={retrying} onClick={onRetry} type="button">
        <StableButtonLabel label="Retry" busyLabel="Retrying…" busy={retrying} />
      </button>
    </div>
  );
}
