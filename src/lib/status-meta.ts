import { Status } from "@prisma/client";

export const STATUS_META: Record<
  Status,
  { label: string; dot: string; badge: string; empty: string }
> = {
  APPLIED: {
    label: "Applied",
    dot: "bg-gold",
    badge: "bg-gold-tint text-ink",
    empty: "Nothing here yet. Add an application to start tracking it.",
  },
  ONLINE_ASSESSMENT: {
    label: "Online assessment",
    dot: "bg-sage",
    badge: "bg-sage-tint text-ink",
    empty: "Drag an application here once an assessment lands.",
  },
  INTERVIEW: {
    label: "Interview",
    dot: "bg-forest",
    badge: "bg-forest-tint text-ink",
    empty: "Drag an application here once you've booked a call.",
  },
  OFFER: {
    label: "Offer",
    dot: "bg-clay",
    badge: "bg-clay-tint text-ink",
    empty: "Fingers crossed — offers will land here.",
  },
  REJECTED: {
    label: "Rejected",
    dot: "bg-rose",
    badge: "bg-rose-tint text-ink",
    empty: "None yet — long may that continue.",
  },
};

export function statusLabel(status: Status) {
  return STATUS_META[status].label;
}
