import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

/**
 * Stub authenticated dashboard. Real implementation branches by role
 * (spec.md Roles): organizers get the onboarding/agenda/evaluation views,
 * reviewers get their assigned submissions, speakers get their portal
 * (profile, tasks, submissions).
 */
export default async function DashboardPage() {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Dashboard
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Signed in as {session.user.email}.
      </p>
      <div className="mt-8 rounded-md border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-500">
        Role-specific views (onboarding status, submissions, agenda) land
        here — see src/domain/ for the underlying services.
      </div>
    </div>
  );
}
