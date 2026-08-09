import type { ScheduleDay } from "@/domain/program";
import { formatEventDay, formatEventTimeRange } from "@/lib/event-time";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * The public schedule (spec.md "Important / strongly desired"): day tabs,
 * each holding time-ordered slots with room + track shown, times rendered in
 * the event's own timezone (questions.md Q6 working assumption — no
 * viewer-local conversion). Shared by the chrome'd `/p/[eventSlug]/schedule`
 * page and the chrome-less `/embed/[eventSlug]/schedule` page.
 */
export function ScheduleView({ days, timezone }: { days: ScheduleDay[]; timezone: string }) {
  if (days.length === 0) {
    return (
      <EmptyState
        title="Schedule coming soon"
        description="Sessions will appear here once they're placed on the agenda."
      />
    );
  }

  return (
    <Tabs defaultValue={days[0].day} className="gap-6">
      <TabsList variant="line" className="w-full justify-start overflow-x-auto">
        {days.map((day) => (
          <TabsTrigger key={day.day} value={day.day}>
            {formatEventDay(day.day, timezone).replace(/^\w+, /, "")}
          </TabsTrigger>
        ))}
      </TabsList>

      {days.map((day) => (
        <TabsContent key={day.day} value={day.day} className="flex flex-col gap-6">
          {day.slots.map((slot) => (
            <section
              key={`${slot.startTime}-${slot.endTime}`}
              className="flex flex-col gap-2 sm:flex-row sm:gap-6"
            >
              <div className="shrink-0 font-mono text-sm whitespace-nowrap text-muted-foreground sm:w-44 sm:pt-4">
                {formatEventTimeRange(day.day, slot.startTime, slot.endTime, timezone)}
              </div>
              <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
                {slot.sessions.map((session) => (
                  <article
                    key={session.id}
                    className="flex flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {session.trackName && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full bg-muted-foreground"
                            style={session.trackColor ? { backgroundColor: session.trackColor } : undefined}
                          />
                          {session.trackName}
                        </span>
                      )}
                      {session.roomName && (
                        <Badge variant="outline" className="text-muted-foreground">
                          {session.roomName}
                        </Badge>
                      )}
                    </div>
                    <h3 className="font-heading text-base font-semibold text-foreground">
                      {session.title}
                    </h3>
                    {session.speakerNames.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {session.speakerNames.join(", ")}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </TabsContent>
      ))}
    </Tabs>
  );
}
