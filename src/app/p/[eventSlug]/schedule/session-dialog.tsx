"use client";

import {
  speakerAffiliationLabel,
  type ScheduleSessionView,
} from "@/domain/program";
import { formatEventDay, formatEventTimeRange } from "@/lib/event-time";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StarToggle } from "./star-toggle";

/** One label/value row of the session's particulars. */
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-sm text-muted-foreground sm:w-24">
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * The session detail view behind a schedule card (spec.md "Public program
 * depth"): full start–end time, room, track, format, speakers and the whole
 * abstract, with an explicit "Back to schedule" control alongside the usual
 * dialog close. A modal rather than a route because the schedule underneath
 * stays exactly as the attendee left it — same day tab, same search, same
 * filters — the moment they close it.
 */
export function SessionDialog({
  session,
  timezone,
  onClose,
  itinerary,
}: {
  /** Null when nothing is open — the dialog owns no selection state itself. */
  session: ScheduleSessionView | null;
  timezone: string;
  onClose: () => void;
  itinerary?: { isStarred: boolean; onToggle: () => void };
}) {
  return (
    <Dialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-lg">
        {session && (
          <>
            <DialogHeader>
              <DialogTitle>{session.title}</DialogTitle>
              <DialogDescription>
                {session.speakers.length > 0
                  ? session.speakers.map(speakerAffiliationLabel).join(", ")
                  : "Speakers to be announced."}
              </DialogDescription>
            </DialogHeader>

            <dl className="flex flex-col gap-2">
              <DetailRow label="When">
                {formatEventDay(session.day, timezone)}
                {", "}
                {formatEventTimeRange(
                  session.day,
                  session.startTime,
                  session.endTime,
                  timezone,
                )}
              </DetailRow>
              <DetailRow label="Room">
                {session.roomName ?? "To be announced"}
              </DetailRow>
              <DetailRow label="Track">
                {session.trackName ?? "General"}
              </DetailRow>
              <DetailRow label="Format">{session.formatLabel}</DetailRow>
            </dl>

            {session.description && (
              <p className="text-sm leading-6 whitespace-pre-line text-muted-foreground">
                {session.description}
              </p>
            )}

            <DialogFooter>
              {itinerary && (
                <StarToggle
                  starred={itinerary.isStarred}
                  title={session.title}
                  onToggle={itinerary.onToggle}
                  withLabel
                  className="sm:mr-auto"
                />
              )}
              <DialogClose asChild>
                <Button variant="outline">Back to schedule</Button>
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
