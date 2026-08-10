"use client";

import { useMemo, useState } from "react";
import {
  CalendarOffIcon,
  HistoryIcon,
  SparklesIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import type { Room, SessionContentStatus, Track } from "@/db/entities";
import {
  DEFAULT_SESSION_MINUTES,
  firstConflictFreeSlot,
  minutesOfDay,
  timeOfMinutes,
  type SuggestionWindow,
} from "@/domain/scheduling";
import {
  CONTENT_STATUS_HINT,
  CONTENT_STATUS_LABEL,
  SESSION_CONTENT_STATUSES,
  canRestoreAbstract,
  revisionPreview,
} from "@/domain/session-content";
import { formatDay, formatTime } from "@/components/date-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { NO_ROOM_COLUMN, sessionMinutes } from "./board-layout";
import type { PlacementInput, SessionContentInput } from "./actions";
import type { BoardPerson, BoardSession, SessionRevisionView } from "./types";

const DURATION_CHOICES = [15, 20, 30, 45, 60, 75, 90, 120, 180];
const NO_TRACK = "__no_track__";

export interface SessionEditDialogProps {
  session: BoardSession | null;
  days: string[];
  rooms: Room[];
  tracks: Track[];
  /** The whole board: what "Suggest a slot" tests a placement against
   * (decisions.md D-067). */
  sessions: BoardSession[];
  /** The time range a suggestion may search within each day. */
  suggestionWindow: SuggestionWindow;
  /** Every person on a session, by user id — labels the current speakers. */
  people: Record<string, BoardPerson>;
  /** This event's speaker roster — who can be added (decisions.md D-057). */
  roster: BoardPerson[];
  /** Abstract history for this session, newest first (decisions.md D-071).
   * Keyed by session id on the board so opening a dialog costs no fetch. */
  revisions: Record<string, SessionRevisionView[]>;
  defaultDay: string;
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onPlace: (session: BoardSession, placement: PlacementInput) => void;
  onSaveContent: (session: BoardSession, content: SessionContentInput) => void;
  onUpdateSpeakers: (session: BoardSession, speakerIds: string[]) => void;
  /** Puts an earlier abstract back (decisions.md D-071). */
  onRestoreRevision: (session: BoardSession, revisionId: string) => void;
  onUnschedule: (session: BoardSession) => void;
  onDelete: (session: BoardSession) => void;
}

/**
 * The session detail dialog: an organizer's editable copy of a session, open
 * from any card on the board (grid or tray). Three independent edits live
 * here, each saving on its own so fixing one thing never forces validation
 * of another: the session's own content — title, abstract, track
 * (decisions.md D-054(5)) — its speaker list (D-057, immediate like
 * unschedule/delete below rather than a form save, since it's just adding or
 * removing one person at a time), and precise time entry, the escape hatch
 * from pixel arithmetic (spec.md §9). This is also the one place a session
 * can be sent back to the tray or, for a directly-entered session, deleted
 * outright.
 */
export function SessionEditDialog({ session, onOpenChange, ...rest }: SessionEditDialogProps) {
  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Keyed so every session opens with its own values — no effect-based
            form resetting. */}
        {session && (
          <SessionEditForm
            key={session.id}
            session={session}
            onOpenChange={onOpenChange}
            {...rest}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SessionEditForm({
  session,
  days,
  rooms,
  tracks,
  sessions,
  suggestionWindow,
  people,
  roster,
  revisions,
  defaultDay,
  canEdit,
  onOpenChange,
  onPlace,
  onSaveContent,
  onUpdateSpeakers,
  onRestoreRevision,
  onUnschedule,
  onDelete,
}: Omit<SessionEditDialogProps, "session"> & { session: BoardSession }) {
  const [day, setDay] = useState(session.day ?? defaultDay);
  const [roomId, setRoomId] = useState(session.roomId ?? NO_ROOM_COLUMN);
  const [startTime, setStartTime] = useState(session.startTime ?? "09:00");
  const [duration, setDuration] = useState(() =>
    sessionMinutes(session, DEFAULT_SESSION_MINUTES),
  );
  const [error, setError] = useState<string | null>(null);

  const initialTitle = session.title;
  const initialDescription = session.description ?? "";
  const initialTrackId = session.trackId ?? NO_TRACK;
  const initialContentStatus = session.contentStatus;
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [trackId, setTrackId] = useState(initialTrackId);
  const [contentStatus, setContentStatus] = useState<SessionContentStatus>(initialContentStatus);
  const [contentError, setContentError] = useState<string | null>(null);
  const contentDirty =
    title !== initialTitle ||
    description !== initialDescription ||
    trackId !== initialTrackId ||
    contentStatus !== initialContentStatus;

  const history = revisions[session.id] ?? [];

  const [speakerIds, setSpeakerIds] = useState(session.speakerIds);
  const [speakerPickerValue, setSpeakerPickerValue] = useState("");
  const currentSpeakers = speakerIds.flatMap((id) => (people[id] ? [people[id]] : []));
  const availableRoster = roster.filter((person) => !speakerIds.includes(person.id));

  function addSpeaker(userId: string) {
    setSpeakerPickerValue("");
    if (speakerIds.includes(userId)) return;
    const next = [...speakerIds, userId];
    setSpeakerIds(next);
    onUpdateSpeakers(session, next);
  }

  function removeSpeaker(userId: string) {
    const next = speakerIds.filter((id) => id !== userId);
    setSpeakerIds(next);
    onUpdateSpeakers(session, next);
  }

  const dayChoices = useMemo(
    () => [...new Set([...days, session.day, day].filter((d): d is string => Boolean(d)))].sort(),
    [days, session.day, day],
  );
  const durationChoices = useMemo(
    () => [...new Set([...DURATION_CHOICES, duration])].sort((a, b) => a - b),
    [duration],
  );

  // "Suggest a slot" (decisions.md D-067): the earliest day/time/room where
  // this session fits with no room or speaker double-booking, for the length
  // currently selected. It only fills the fields in; the organizer still
  // presses Save time. Null means there is nowhere clean to put it, which the
  // button and the note below it say out loud rather than placing anyway.
  const [suggestionNote, setSuggestionNote] = useState<string | null>(null);
  const suggestion = useMemo(
    () =>
      firstConflictFreeSlot({
        session,
        sessions,
        days: dayChoices,
        roomIds: rooms.map((room) => room.id),
        durationMinutes: duration,
        window: suggestionWindow,
      }),
    [session, sessions, dayChoices, rooms, duration, suggestionWindow],
  );

  function applySuggestion() {
    if (!suggestion) return;
    setDay(suggestion.day);
    setRoomId(suggestion.roomId ?? NO_ROOM_COLUMN);
    setStartTime(suggestion.startTime);
    setError(null);
    const roomName = suggestion.roomId
      ? (rooms.find((room) => room.id === suggestion.roomId)?.name ?? "an unknown room")
      : "no room yet";
    setSuggestionNote(
      `Suggested ${formatDay(suggestion.day)} at ${formatTime(suggestion.startTime)}, ${roomName}. Save to confirm.`,
    );
  }

  function save() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
      setError("Enter a start time as HH:MM");
      return;
    }
    const endMinute = minutesOfDay(startTime) + duration;
    if (endMinute >= 24 * 60) {
      setError("That session would run past midnight — shorten it or move it earlier.");
      return;
    }
    onPlace(session, {
      day,
      roomId: roomId === NO_ROOM_COLUMN ? null : roomId,
      startTime,
      endTime: timeOfMinutes(endMinute),
    });
    onOpenChange(false);
  }

  function saveContent() {
    if (!title.trim()) {
      setContentError("Give the session a title");
      return;
    }
    onSaveContent(session, {
      title,
      description: description.trim() || undefined,
      trackId: trackId === NO_TRACK ? null : trackId,
      contentStatus,
    });
    onOpenChange(false);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6">{session.title}</DialogTitle>
        <DialogDescription>
          {canEdit
            ? "Edit the session's own content, or set the exact day, room, and time. Each saves independently."
            : "Editing and scheduling are limited to event admins."}
        </DialogDescription>
      </DialogHeader>

      {/* Content — title, abstract, track (decisions.md D-054(5)). This
          writes the session record itself, which is what the public program
          reads, rather than forking content onto the submission. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="session-title">Title</Label>
          <Input
            id="session-title"
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="session-description">Description</Label>
          <Textarea
            id="session-description"
            rows={4}
            value={description}
            disabled={!canEdit}
            placeholder="What the session covers — this is what attendees will read."
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="session-track">Track</Label>
          <Select value={trackId} onValueChange={setTrackId} disabled={!canEdit}>
            <SelectTrigger id="session-track" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TRACK}>No track</SelectItem>
              {tracks.map((track) => (
                <SelectItem key={track.id} value={track.id}>
                  {track.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Editorial approval (decisions.md D-072) — separate from the
            scheduling status on the card, and the only thing on this dialog
            that decides whether the public program prints the session. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="session-content-status">Content status</Label>
          <Select
            value={contentStatus}
            onValueChange={(value) => setContentStatus(value as SessionContentStatus)}
            disabled={!canEdit}
          >
            <SelectTrigger id="session-content-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SESSION_CONTENT_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {CONTENT_STATUS_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{CONTENT_STATUS_HINT[contentStatus]}</p>
        </div>

        {contentError && <p className="text-sm text-destructive">{contentError}</p>}

        {canEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            onClick={saveContent}
            disabled={!contentDirty}
          >
            Save details
          </Button>
        )}

        <RevisionHistory
          entries={history}
          // The saved abstract, not the textarea: the restore is applied
          // server-side against the stored session, so that is what decides
          // whether an entry has anything to put back.
          currentAbstract={session.description}
          canEdit={canEdit}
          onRestore={(revisionId) => {
            onRestoreRevision(session, revisionId);
            onOpenChange(false);
          }}
        />
      </div>

      <Separator />

      {/* Speakers (decisions.md D-057) — the roster is the whole event's, so
          adding someone doesn't require them to exist anywhere else first;
          removing down to zero is allowed for a placeholder session. */}
      <div className="flex flex-col gap-2">
        <Label>Speakers</Label>
        {currentSpeakers.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {currentSpeakers.map((speaker) => (
              <Badge key={speaker.id} variant="secondary" className="gap-1 pr-1">
                {speaker.name}
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`Remove ${speaker.name}`}
                    className="rounded-full p-0.5 hover:bg-muted"
                    onClick={() => removeSpeaker(speaker.id)}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No speakers yet.</p>
        )}

        {canEdit && (
          <Select value={speakerPickerValue} onValueChange={addSpeaker}>
            <SelectTrigger className="w-full" aria-label="Add a speaker from the roster">
              <SelectValue placeholder="Add from the event roster" />
            </SelectTrigger>
            <SelectContent>
              {availableRoster.length === 0 ? (
                <SelectItem value="__none__" disabled>
                  {roster.length === 0 ? "No speakers on this event yet" : "Everyone is already added"}
                </SelectItem>
              ) : (
                availableRoster.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name} · {person.email}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}
      </div>

      <Separator />

      {canEdit && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Day, room & time</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="suggest-slot"
              disabled={suggestion === null}
              onClick={applySuggestion}
            >
              <SparklesIcon />
              Suggest a slot
            </Button>
          </div>
          <p
            className="text-xs text-muted-foreground"
            data-testid="suggest-slot-note"
            aria-live="polite"
          >
            {suggestion === null
              ? `No conflict-free ${duration}-minute slot is left on this event. Free something up, shorten the session, or place it by hand below.`
              : (suggestionNote ??
                "Fills in the earliest open time with no room or speaker clash. You still confirm it.")}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="session-day">Day</Label>
          <Select value={day} onValueChange={setDay} disabled={!canEdit}>
            <SelectTrigger id="session-day" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dayChoices.map((d) => (
                <SelectItem key={d} value={d}>
                  {formatDay(d, true)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="session-room">Room</Label>
          <Select value={roomId} onValueChange={setRoomId} disabled={!canEdit}>
            <SelectTrigger id="session-room" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ROOM_COLUMN}>No room yet</SelectItem>
              {rooms.map((room) => (
                <SelectItem key={room.id} value={room.id}>
                  {room.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="session-start">Start time</Label>
          <Input
            id="session-start"
            type="time"
            step={900}
            value={startTime}
            disabled={!canEdit}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="session-duration">Duration</Label>
          <Select
            value={String(duration)}
            onValueChange={(v) => setDuration(Number(v))}
            disabled={!canEdit}
          >
            <SelectTrigger id="session-duration" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {durationChoices.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter className="sm:justify-between">
        <div className="flex gap-2">
          {canEdit && session.day && (
            <Button
              variant="outline"
              onClick={() => {
                onUnschedule(session);
                onOpenChange(false);
              }}
            >
              <CalendarOffIcon />
              Unschedule
            </Button>
          )}
          {canEdit && !session.submissionId && (
            <Button
              variant="destructive"
              onClick={() => {
                onDelete(session);
                onOpenChange(false);
              }}
            >
              <Trash2Icon />
              Delete
            </Button>
          )}
        </div>
        <Button onClick={save} disabled={!canEdit}>
          Save time
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Abstract revision history (decisions.md D-071): who changed the abstract,
 * when, and what it used to say. Compact on purpose — the panel answers "what
 * did this say before?" without turning the dialog into a diff viewer, so each
 * entry shows a truncated prior value that expands in place.
 *
 * Nothing renders at all until there is a history, so a session nobody has
 * re-edited keeps the dialog as short as it was.
 *
 * Each entry can also be put back: Restore writes that version's text onto the
 * session as a fresh edit, so the history keeps growing forwards and the
 * version being replaced stays recoverable.
 */
function RevisionHistory({
  entries,
  currentAbstract,
  canEdit,
  onRestore,
}: {
  entries: SessionRevisionView[];
  currentAbstract: string | null;
  canEdit: boolean;
  onRestore: (revisionId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <HistoryIcon className="size-3.5 text-muted-foreground" aria-hidden />
        Revision history
        <span className="text-muted-foreground">{entries.length}</span>
      </p>
      <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto" data-testid="revision-history">
        {entries.map((entry) => {
          const open = expanded === entry.id;
          const restorable = canRestoreAbstract(currentAbstract, entry.priorValue);
          return (
            <li key={entry.id} className="flex flex-col gap-0.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {entry.authorName} edited the abstract · {entry.at}
                </p>
                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-5 shrink-0 px-1.5 text-[11px]"
                    data-testid="restore-revision"
                    disabled={!restorable}
                    title={
                      restorable
                        ? "Put this version of the abstract back"
                        : "This is already the current abstract"
                    }
                    onClick={() => onRestore(entry.id)}
                  >
                    <Undo2Icon className="size-3" />
                    Restore
                  </Button>
                )}
              </div>
              <button
                type="button"
                aria-expanded={open}
                className="text-left text-[11px] text-foreground underline-offset-4 hover:underline"
                onClick={() => setExpanded(open ? null : entry.id)}
              >
                <span className="text-muted-foreground">Was: </span>
                {open ? (entry.priorValue ?? "(empty)") : revisionPreview(entry.priorValue)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
