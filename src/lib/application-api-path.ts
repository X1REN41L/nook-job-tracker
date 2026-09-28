// Application IDs can come from imported backups, so they are always encoded as one path segment.
export function applicationApiPath(id: string, action?: "restore") {
  const path = `/api/applications/${encodeURIComponent(id)}`;
  return action ? `${path}/${action}` : path;
}
