type SearchableApplication = { company: string; role: string };
type SortableApplication = { appliedDate: string; createdAt: string };

export function matchesApplicationSearch(application: SearchableApplication, search: string) {
  const query = search.trim().toLowerCase();
  return `${application.company} ${application.role}`.toLowerCase().includes(query);
}

export function compareApplications(left: SortableApplication, right: SortableApplication) {
  return right.appliedDate.localeCompare(left.appliedDate) || right.createdAt.localeCompare(left.createdAt);
}
