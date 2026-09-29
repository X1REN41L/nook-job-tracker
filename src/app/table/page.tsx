import { ApplicationPage } from "@/components/application-page";
import { parseApplicationFilters } from "@/lib/application-list";

export const dynamic = "force-dynamic";

export default async function TablePage(props: PageProps<"/table">) {
  return <ApplicationPage page="table" tableFilters={parseApplicationFilters(await props.searchParams)} />;
}
