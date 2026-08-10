import { flattenSchedule, type ScheduleDay } from "@/domain/program";
import { formatEventDay, formatEventTimeRange } from "@/lib/event-time";

export function SessionList({ days, timezone }: { days: ScheduleDay[]; timezone: string }) {
  const sessions = flattenSchedule(days);
  return (
    <div className="flex flex-col gap-4" data-testid="session-list-widget">
      <h2 className="font-heading text-lg font-semibold">Sessions</h2>
      {sessions.map((session) => (
        <article key={session.id} className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-heading font-semibold text-foreground">{session.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatEventDay(session.day, timezone)} · {formatEventTimeRange(
              session.day,
              session.startTime,
              session.endTime,
              timezone,
            )}
            {session.roomName ? ` · ${session.roomName}` : ""}
          </p>
          {session.trackName ? <p className="mt-1 text-xs text-primary">{session.trackName}</p> : null}
          {session.speakers.length ? (
            <p className="mt-2 text-sm">{session.speakers.map((speaker) => speaker.name).join(", ")}</p>
          ) : null}
          {session.description ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{session.description}</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
