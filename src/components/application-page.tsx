import { ApplicationDashboard } from "@/components/application-dashboard";
import { prisma } from "@/lib/prisma";
import type { ApplicationFilters } from "@/lib/application-list";
import type { ApplicationPageName, DashboardSection } from "@/types/navigation";

export async function ApplicationPage({ page, dashboardSection, tableFilters, expandAttention }: {
  page: ApplicationPageName;
  dashboardSection?: DashboardSection;
  tableFilters?: ApplicationFilters;
  expandAttention?: boolean;
}) {
  const applications = await prisma.application.findMany({
    orderBy: [{ appliedDate: "desc" }, { createdAt: "desc" }],
  });

  return (
    <ApplicationDashboard
      initialApplications={applications.map((application) => ({
        ...application,
        appliedDate: application.appliedDate.toISOString(),
        interviewDate: application.interviewDate?.toISOString() ?? null,
        lastUpdated: application.lastUpdated.toISOString(),
        createdAt: application.createdAt.toISOString(),
      }))}
      page={page}
      dashboardSection={dashboardSection}
      tableFilters={tableFilters}
      expandAttention={expandAttention}
    />
  );
}
