import { notFound, permanentRedirect } from "next/navigation";
import { getRepos } from "@/lib/db";

/**
 * Alias for the public program. `/events/<slug>` is the shape people and
 * agents guess first — the 2026-08-18 evaluator asked for `/events` twelve
 * times and `/events/<slug>` three more, all 404s — while the real page lives
 * at `/p/<slug>`.
 *
 * Same treatment as the `/e/<slug>` legacy alias next door: resolve the slug
 * here so a bad link lands on the ordinary 404, then redirect, which keeps the
 * D-056 publish gate defined in exactly one place.
 */
export default async function EventsAliasPage({
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
