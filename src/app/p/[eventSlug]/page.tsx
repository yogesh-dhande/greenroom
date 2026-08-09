import Link from "next/link";
import { getOpenForms, getPublicEvent } from "./data";
import { ProgramComingSoon } from "./program-coming-soon";
import { programVisible } from "@/domain/program-visibility";
import { formatDayRange } from "@/lib/event-time";
import { Button } from "@/components/ui/button";

/**
 * The public event landing page (spec.md "Important / strongly desired") —
 * deliberately minimal: identity, dates, and the two links that matter
 * (speakers, schedule), plus any call for speakers a visitor could still
 * submit to.
 *
 * Until the program is published (decisions.md D-056) the two program links
 * give way to a coming-soon note. The call for speakers stays: its own
 * open/close window is what decides whether it's shown, and a CFP normally
 * runs long before there is any schedule to announce.
 */
export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const [event, openForms] = await Promise.all([
    getPublicEvent(eventSlug),
    getOpenForms(eventSlug),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {event.name}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {formatDayRange(event.startDate, event.endDate, event.timezone)}
          {event.location ? ` · ${event.location}` : ""}
        </p>
        {event.description && (
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            {event.description}
          </p>
        )}
      </div>

      {programVisible(event) ? (
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/p/${eventSlug}/speakers`}>View speakers</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/p/${eventSlug}/schedule`}>View schedule</Link>
          </Button>
        </div>
      ) : (
        <ProgramComingSoon eventName={event.name} />
      )}

      {openForms.length > 0 && (
        <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 className="font-heading text-base font-semibold text-foreground">
            Want to speak?
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {openForms.map((form) => (
              <li key={form.id}>
                <Link
                  href={`/submit/${form.slug}`}
                  className="text-sm font-medium text-primary underline underline-offset-4"
                >
                  {form.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
