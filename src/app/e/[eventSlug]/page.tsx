import { notFound, permanentRedirect } from "next/navigation";
import { getRepos } from "@/lib/db";

/**
 * Legacy alias for the public program. `/e/<slug>` was the first-wave public
 * page; the real program now lives at `/p/<slug>` (landing, speakers,
 * schedule, feeds), but `/e/<slug>` is the URL src/domain/comms.ts puts in
 * every speaker email, so already-delivered links have to keep working.
 *
 * Redirecting rather than rendering also means the D-056 publish gate is
 * enforced in exactly one place — whatever `/p/<slug>` decides to show.
 * The slug is resolved here first so a bad link still lands on the public
 * 404 instead of bouncing to one.
 */
export default async function LegacyPublicEventPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  permanentRedirect(`/p/${event.slug}`);
}
