import { ApplicationPage } from "@/components/application-page";

export const dynamic = "force-dynamic";

export default function StaleApplicationsPage() {
  return <ApplicationPage page="dashboard" dashboardSection="stale" />;
}
