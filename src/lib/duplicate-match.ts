export type DuplicateCandidate = {
  company: string;
  role: string;
};

export type DuplicateComparable = DuplicateCandidate & {
  id: string;
};

export type DuplicateMatch<T extends DuplicateComparable> = {
  application: T;
  kind: "exact" | "close";
};

export function normalizeDuplicateText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function findPossibleDuplicate<T extends DuplicateComparable>(
  candidate: DuplicateCandidate,
  applications: T[],
  excludeId?: string,
): DuplicateMatch<T> | null {
  const company = normalizeDuplicateText(candidate.company);
  const role = normalizeDuplicateText(candidate.role);
  const sameCompany = applications.filter((application) =>
    application.id !== excludeId && normalizeDuplicateText(application.company) === company
  );

  const exact = sameCompany.find((application) => normalizeDuplicateText(application.role) === role);
  if (exact) return { application: exact, kind: "exact" };

  let closest: { application: T; score: number } | null = null;
  for (const application of sameCompany) {
    const score = closeRoleScore(role, normalizeDuplicateText(application.role));
    if (score !== null && (!closest || score > closest.score)) closest = { application, score };
  }

  return closest ? { application: closest.application, kind: "close" } : null;
}

export function closeRoleScore(left: string, right: string) {
  const leftCompact = compactRole(left);
  const rightCompact = compactRole(right);
  if (!leftCompact || !rightCompact) return null;
  if (leftCompact === rightCompact) return 1;

  const [shorter, longer] = leftCompact.length <= rightCompact.length
    ? [leftCompact, rightCompact]
    : [rightCompact, leftCompact];

  // Only recognize short, explicit level suffixes (I/II/III/IV/V or digits)
  // as prefix matches. This avoids treating broader title additions as duplicates.
  const suffix = longer.startsWith(shorter) ? longer.slice(shorter.length) : "";
  if (shorter.length >= 8 && /^(?:[ivx]{1,3}|\d{1,2})$/.test(suffix)) return 0.98;

  if (shorter.length < 8) return null;
  const similarity = 1 - levenshteinDistance(leftCompact, rightCompact) / longer.length;
  return similarity >= 0.92 ? similarity : null;
}

export function compactRole(value: string) {
  return value.match(/[\p{L}\p{N}]+/gu)?.join("") ?? "";
}

function levenshteinDistance(left: string, right: string) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[right.length] ?? 0;
}
