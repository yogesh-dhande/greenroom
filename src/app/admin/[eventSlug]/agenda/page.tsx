import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDay, formatTime } from "@/components/date-format";
import type { Session } from "@/db/entities";

function groupByDay(sessions: Session[]): Map<string, Session[]> {
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!session.day) continue;
    const list = groups.get(session.day) ?? [];
    list.push(session);
    groups.set(session.day, list);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export default async function AgendaPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const sessions = await repos.sessions.listByEvent(event.id);
  const scheduled = sessions.filter((s) => s.day);
  const unscheduled = sessions.filter((s) => !s.day);
  const byDay = groupByDay(scheduled);

  return (
    <div>
      <PageHeader
        title="Agenda"
        description="Day-by-day schedule with room assignments and conflict checks."
      />

      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="Sessions appear here once talks are accepted or added directly, and the drag-and-drop scheduler lands in a later wave."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {[...byDay.entries()].map(([day, daySessions]) => (
            <Card key={day}>
              <CardHeader>
                <CardTitle>{formatDay(day, true)}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {daySessions
                  .slice()
                  .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""))
                  .map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-foreground">
                        {session.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {session.startTime ? formatTime(session.startTime) : "Time TBD"}
                        {session.endTime ? ` – ${formatTime(session.endTime)}` : ""}
                      </span>
                    </div>
                  ))}
              </CardContent>
            </Card>
          ))}

          {unscheduled.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Unscheduled</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {unscheduled.map((session) => (
                  <div
                    key={session.id}
                    className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-foreground"
                  >
                    {session.title}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
