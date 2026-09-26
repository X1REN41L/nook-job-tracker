import { ApplicationPage } from "@/components/application-page";

export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  return <ApplicationPage page="dashboard" dashboardSection="analytics" />;
}
