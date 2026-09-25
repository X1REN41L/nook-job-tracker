import { redirect } from "next/navigation";

export default function UnmatchedRoutePage() {
  redirect("/dashboard");
}
