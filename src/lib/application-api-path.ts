// Application IDs can come from imported backups, so they are always encoded as one path segment.
export function applicationApiPath(id: string, action?: "restore" | "undo-status" | "interviews" | "contacts" | "notes" | "status-events", itemId?: string) {
  const path = `/api/applications/${encodeURIComponent(id)}`;
  if (!action) return path;
  return itemId ? `${path}/${action}/${encodeURIComponent(itemId)}` : `${path}/${action}`;
}
