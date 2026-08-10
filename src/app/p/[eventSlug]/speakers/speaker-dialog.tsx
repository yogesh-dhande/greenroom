"use client";

import type { GallerySpeaker } from "@/domain/program";
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
import { EmptyState } from "@/components/empty-state";
import { SpeakerProfileLinks } from "./speaker-profile-links";
import { SpeakerHeadshot } from "./speaker-headshot";

/**
 * The speaker detail view behind a gallery card (spec.md "Public program
 * depth"): photo, name, title, company, the full bio, and every talk they're
 * on with its date, time and room. A modal, so closing it drops the attendee
 * back onto the intact grid — same scroll position, same search.
 */
export function SpeakerDialog({
  speaker,
  timezone,
  onClose,
}: {
  /** Null when nothing is open — the dialog owns no selection state itself. */
  speaker: GallerySpeaker | null;
  timezone: string;
  onClose: () => void;
}) {
  const subtitle = speaker
    ? [speaker.title, speaker.company].filter(Boolean).join(" · ")
    : "";

  return (
    <Dialog open={speaker !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-lg">
        {speaker && (
          <>
            <DialogHeader className="flex-row items-center gap-3">
              <SpeakerHeadshot
                name={speaker.name}
                headshotUrl={speaker.headshotUrl}
                className="size-16 text-base"
              />
              <div className="min-w-0">
                <DialogTitle>{speaker.name}</DialogTitle>
                {/* A speaker who never filled in a title or company still
                    gets a complete profile — no empty line, no stray "·". */}
                <DialogDescription>{subtitle || "Speaker"}</DialogDescription>
              </div>
            </DialogHeader>

            {speaker.bio ? (
              <p className="text-sm leading-6 whitespace-pre-line text-muted-foreground">
                {speaker.bio}
              </p>
            ) : (
              <EmptyState variant="inline" title="No biography yet." />
            )}

            {speaker.talks.length > 0 && (
              <section className="flex flex-col gap-2 border-t border-border pt-3">
                <h4 className="text-sm font-medium text-foreground">
                  {speaker.talks.length === 1 ? "Session" : "Sessions"}
                </h4>
                <ul className="flex flex-col gap-2">
                  {speaker.talks.map((talk) => (
                    <li key={talk.sessionId} className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">{talk.title}</span>
                      <span className="text-sm text-muted-foreground">
                        {talk.day && talk.startTime && talk.endTime
                          ? `${formatEventDay(talk.day, timezone)}, ${formatEventTimeRange(
                              talk.day,
                              talk.startTime,
                              talk.endTime,
                              timezone,
                            )}`
                          : "Time to be announced"}
                        {talk.roomName ? ` · ${talk.roomName}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <SpeakerProfileLinks speaker={speaker} className="border-t border-border pt-3" />

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Back to speakers</Button>
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
