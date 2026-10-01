/** A stored link that is safe to open: http or https only. Anything else is simply not linked. */
export function safeLink(value: string | null) {
  const candidate = value?.trim();
  try {
    if (candidate && ["http:", "https:"].includes(new URL(candidate).protocol)) return candidate;
  } catch {
    // Stored links are validated; an unparseable one is left unlinked.
  }
  return undefined;
}
