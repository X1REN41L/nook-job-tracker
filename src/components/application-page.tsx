import { ApplicationDashboard } from "@/components/application-dashboard";
import { prisma } from "@/lib/prisma";
import type { ApplicationPageName, DashboardSection } from "@/types/navigation";

export async function ApplicationPage({ page, dashboardSection }: { page: ApplicationPageName; dashboardSection?: DashboardSection }) {
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
    />
  );
}
