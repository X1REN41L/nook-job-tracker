import { ApplicationDashboard } from "@/components/application-dashboard";
import { prisma } from "@/lib/prisma";
import { applicationSummaryQuery, serializeApplicationSummary } from "@/lib/application-record";
import type { ApplicationFilters } from "@/lib/application-list";
import type { ApplicationPageName, DashboardSection } from "@/types/navigation";

export async function ApplicationPage({ page, dashboardSection, tableFilters }: {
  page: ApplicationPageName;
  dashboardSection?: DashboardSection;
  tableFilters?: ApplicationFilters;
}) {
  const applications = await prisma.application.findMany({
    ...applicationSummaryQuery,
    orderBy: [{ appliedDate: "desc" }, { createdAt: "desc" }],
  });

  return (
    <ApplicationDashboard
      initialApplications={applications.map(serializeApplicationSummary)}
      page={page}
      dashboardSection={dashboardSection}
      tableFilters={tableFilters}
    />
  );
}
