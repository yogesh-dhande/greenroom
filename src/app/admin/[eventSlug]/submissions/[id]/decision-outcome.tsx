import Link from "next/link";
import type { SubmissionStatus } from "@/db/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** The statuses a recorded decision leaves behind: the note to speakers
 * belongs to one of these and to nothing else. Spelled out here rather than
 * imported from the decision bar: that module is a client component, and a
 * server component reading a value out of one gets a client reference back
 * instead of the value. */
const DECIDED_STATUSES = new Set<SubmissionStatus>(["approved", "maybe", "denied"]);

/**
 * What the decision already did (spec.md section 5): the session it created, the
 * onboarding tasks it assigned, the note that went to the speakers.
 *
 * Split out of the decision controls in wave W25: the controls sit in the
 * sticky bar at the foot of the page, where a bar is the wrong place for
 * outcome prose and deep links. Nothing to say before a decision, so the card
 * doesn't render at all until there is.
 */
export function DecisionOutcome({
  eventSlug,
  status,
  note,
  session,
  taskCount,
  speakerCount,
}: {
  eventSlug: string;
  status: SubmissionStatus;
  note: string | null;
  session: { id: string; scheduled: boolean; cancelled: boolean } | null;
  taskCount: number;
  speakerCount: number;
}) {
  const showNote = DECIDED_STATUSES.has(status) && Boolean(note);
  if (!showNote && !session && taskCount === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What this decision did</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {showNote && (
          <p className="text-sm whitespace-pre-line text-muted-foreground">
            <span className="font-medium text-foreground">Note to speakers: </span>
            {note}
          </p>
        )}

        {session && (
          <p className="text-sm text-muted-foreground" data-testid="decision-session">
            {session.cancelled ? (
              "The session made from this talk has been cancelled."
            ) : (
              <>
                <Link
                  href={`/admin/${eventSlug}/agenda`}
                  className="text-primary underline underline-offset-4"
                >
                  Session created
                </Link>
                {session.scheduled
                  ? " and placed on the agenda."
                  : " — not yet placed on the agenda."}{" "}
                {/* The session row is the record the public program reads —
                    a typo'd title or abstract gets fixed there, not by
                    forking content onto this submission (decisions.md
                    D-054(5)). Deep-links into the agenda board's own edit
                    dialog for this session. */}
                <Link
                  href={`/admin/${eventSlug}/agenda?session=${session.id}`}
                  className="text-primary underline underline-offset-4"
                  data-testid="edit-session-link"
                >
                  Edit title, abstract &amp; track
                </Link>
                .
              </>
            )}
          </p>
        )}

        {taskCount > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="decision-tasks">
            {taskCount} onboarding task{taskCount === 1 ? "" : "s"} assigned across {speakerCount}{" "}
            speaker{speakerCount === 1 ? "" : "s"}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
