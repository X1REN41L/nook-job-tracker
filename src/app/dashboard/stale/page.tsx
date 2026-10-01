import { redirect } from "next/navigation";

import { applicationTableHref } from "@/lib/application-list";

// Stale Applications is now the Needs attention filter on the table.
export default function StaleApplicationsPage() {
  redirect(applicationTableHref({ status: "attention" }));
}
