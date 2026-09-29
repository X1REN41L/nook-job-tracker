import { ApplicationPage } from "@/components/application-page";

export const dynamic = "force-dynamic";

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  return <ApplicationPage page="dashboard" expandAttention={(await props.searchParams).attention === "all"} />;
}
