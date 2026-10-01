import { ApplicationDashboard } from "@/components/application-dashboard";
import { prisma } from "@/lib/prisma";
import { applicationInclude, serializeApplication } from "@/lib/application-record";
import type { ApplicationFilters } from "@/lib/application-list";
import type { ApplicationPageName, DashboardSection } from "@/types/navigation";

export async function ApplicationPage({ page, dashboardSection, tableFilters }: {
  page: ApplicationPageName;
  dashboardSection?: DashboardSection;
  tableFilters?: ApplicationFilters;
}) {
  const applications = await prisma.application.findMany({
    include: applicationInclude,
    orderBy: [{ appliedDate: "desc" }, { createdAt: "desc" }],
  });

  return (
    <ApplicationDashboard
      initialApplications={applications.map(serializeApplication)}
      page={page}
      dashboardSection={dashboardSection}
      tableFilters={tableFilters}
    />
  );
}
