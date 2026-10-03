import { ApplicationDashboard } from "@/components/application-dashboard";
import { loadApplicationSummaries } from "@/lib/application-record";
import { compareApplications } from "@/lib/application-list";
import type { ApplicationFilters } from "@/lib/application-list";
import type { ApplicationPageName, DashboardSection } from "@/types/navigation";

export async function ApplicationPage({ page, dashboardSection, tableFilters }: {
  page: ApplicationPageName;
  dashboardSection?: DashboardSection;
  tableFilters?: ApplicationFilters;
}) {
  const applications = (await loadApplicationSummaries()).sort(compareApplications);

  return (
    <ApplicationDashboard
      initialApplications={applications}
      page={page}
      dashboardSection={dashboardSection}
      tableFilters={tableFilters}
    />
  );
}
