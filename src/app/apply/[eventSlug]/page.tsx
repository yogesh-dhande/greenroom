import { notFound, redirect } from "next/navigation";
import { formWindowState } from "@/domain/forms";
import { getRepos } from "@/lib/db";

/**
 * Alias for an event's call for speakers. `/apply/<event-slug>` was guessed by
 * the 2026-08-18 evaluator; the real submission page is `/submit/<form-slug>`,
 * keyed by *form* slug because one event can run several calls at once.
 *
 * So this resolves the event and then decides:
 *  - exactly one call open  -> straight to it, which is what the guesser meant
 *  - none, or more than one -> the public landing page, which already lists
 *    whatever is open and explains when nothing is
 *
 * A temporary redirect, not permanent: which call is open changes over time, so
 * this destination must not be cached by a browser.
 */
export default async function ApplyAliasPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const published = await repos.forms.listPublishedByEvent(event.id);
  const open = published.filter((form) => formWindowState(form) === "open");
  if (open.length === 1) redirect(`/submit/${open[0].slug}`);

  redirect(`/p/${event.slug}`);
}
