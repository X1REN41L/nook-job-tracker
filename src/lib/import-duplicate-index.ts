import { closeRoleScore, compactRole, normalizeDuplicateText, type DuplicateComparable, type DuplicateMatch } from "@/lib/duplicate-match";

type IndexedRole<T> = { application: T; compact: string; grams: number; order: number };

function gramCounts(value: string) {
  const counts = new Map<string, number>();
  for (let index = 0; index <= value.length - 3; index += 1) {
    const gram = value.slice(index, index + 3);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

export class ImportDuplicateIndex<T extends DuplicateComparable> {
  private exact = new Map<string, IndexedRole<T>>();
  private compact = new Map<string, IndexedRole<T>>();
  private prefix = new Map<string, IndexedRole<T>[]>();
  private postings = new Map<string, Array<{ entry: IndexedRole<T>; count: number }>>();
  private count = 0;

  add(application: T) {
    const normalized = normalizeDuplicateText(application.role);
    const compact = compactRole(normalized);
    const counts = gramCounts(compact);
    const entry = { application, compact, grams: Math.max(0, compact.length - 2), order: this.count++ };
    if (!this.exact.has(normalized)) this.exact.set(normalized, entry);
    if (!this.compact.has(compact)) this.compact.set(compact, entry);
    for (let suffixLength = 1; suffixLength <= 3 && suffixLength < compact.length; suffixLength += 1) {
      const key = compact.slice(0, -suffixLength);
      const list = this.prefix.get(key) ?? [];
      list.push(entry);
      this.prefix.set(key, list);
    }
    for (const [gram, count] of counts) {
      const list = this.postings.get(gram) ?? [];
      list.push({ entry, count });
      this.postings.set(gram, list);
    }
  }

  find(role: string): DuplicateMatch<T> | null {
    const normalized = normalizeDuplicateText(role);
    const exact = this.exact.get(normalized);
    if (exact) return { application: exact.application, kind: "exact" };
    const compact = compactRole(normalized);
    const candidates = new Set<IndexedRole<T>>();
    const compactMatch = this.compact.get(compact);
    if (compactMatch) candidates.add(compactMatch);
    for (const entry of this.prefix.get(compact) ?? []) candidates.add(entry);
    for (let suffixLength = 1; suffixLength <= 3 && suffixLength < compact.length; suffixLength += 1) {
      const shorter = this.compact.get(compact.slice(0, -suffixLength));
      if (shorter) candidates.add(shorter);
    }
    if (compact.length >= 8) {
      const overlaps = new Map<IndexedRole<T>, number>();
      for (const [gram, count] of gramCounts(compact)) {
        for (const posting of this.postings.get(gram) ?? []) {
          overlaps.set(posting.entry, (overlaps.get(posting.entry) ?? 0) + Math.min(count, posting.count));
        }
      }
      for (const [entry, overlap] of overlaps) {
        const longer = Math.max(compact.length, entry.compact.length);
        const maxDistance = Math.floor(longer * 0.08);
        if (overlap >= Math.min(compact.length - 2, entry.grams) - 3 * maxDistance) candidates.add(entry);
      }
    }
    let closest: { entry: IndexedRole<T>; score: number } | null = null;
    for (const entry of candidates) {
      const score = closeRoleScore(compact, entry.compact);
      if (score !== null && (!closest || score > closest.score || (score === closest.score && entry.order < closest.entry.order))) closest = { entry, score };
    }
    return closest ? { application: closest.entry.application, kind: "close" } : null;
  }
}
