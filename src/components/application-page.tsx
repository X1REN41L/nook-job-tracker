import { ApplicationDashboard, type ApplicationPageName, type DashboardSection } from "@/components/application-dashboard";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredUndoSnapshots } from "@/lib/undo-snapshots";

export async function ApplicationPage({ page, dashboardSection }: { page: ApplicationPageName; dashboardSection?: DashboardSection }) {
  await cleanupExpiredUndoSnapshots();
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
