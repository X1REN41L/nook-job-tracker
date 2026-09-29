import { redirect } from "next/navigation";

// Stale Applications is now the full Needs Attention list on Overview.
export default function StaleApplicationsPage() {
  redirect("/dashboard?attention=all");
}
