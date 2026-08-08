import { redirect } from "next/navigation";
import { homePathForRole, requireUser } from "@/lib/session";

// Kept at /dashboard because it's the magic-link `callbackURL` (see
// src/app/login/login-form.tsx) — this route just routes each role home.
export default async function DashboardPage() {
  const user = await requireUser();
  redirect(homePathForRole(user.role));
}
