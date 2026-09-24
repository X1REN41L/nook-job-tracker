import { ApplicationDashboard } from "@/components/application-dashboard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const applications = await prisma.application.findMany({
    orderBy: [{ appliedDate: "desc" }, { createdAt: "desc" }],
  });
  return <ApplicationDashboard initialApplications={applications.map((application) => ({
    ...application,
    appliedDate: application.appliedDate.toISOString(),
    interviewDate: application.interviewDate?.toISOString() ?? null,
    lastUpdated: application.lastUpdated.toISOString(),
    createdAt: application.createdAt.toISOString(),
  }))} />;
}
