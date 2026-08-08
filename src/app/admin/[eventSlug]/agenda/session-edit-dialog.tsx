"use client";

import { useMemo, useState } from "react";
import { CalendarOffIcon, Trash2Icon } from "lucide-react";
import type { Room } from "@/db/entities";
import {
  DEFAULT_SESSION_MINUTES,
  minutesOfDay,
  timeOfMinutes,
} from "@/domain/scheduling";
import { formatDay } from "@/components/date-format";
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
import { NO_ROOM_COLUMN, sessionMinutes } from "./board-layout";
import type { PlacementInput } from "./actions";
import type { BoardSession } from "./types";

const DURATION_CHOICES = [15, 20, 30, 45, 60, 75, 90, 120, 180];

export interface SessionEditDialogProps {
  session: BoardSession | null;
  days: string[];
  rooms: Room[];
  defaultDay: string;
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onPlace: (session: BoardSession, placement: PlacementInput) => void;
  onUnschedule: (session: BoardSession) => void;
  onDelete: (session: BoardSession) => void;
}

/**
 * Precise time entry for a session — the escape hatch from pixel arithmetic
 * (spec.md §9). Also the one place a session can be sent back to the tray or,
 * for a directly-entered session, deleted outright.
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
  defaultDay,
  canEdit,
  onOpenChange,
  onPlace,
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

  const dayChoices = useMemo(
    () => [...new Set([...days, session.day, day].filter((d): d is string => Boolean(d)))].sort(),
    [days, session.day, day],
  );
  const durationChoices = useMemo(
    () => [...new Set([...DURATION_CHOICES, duration])].sort((a, b) => a - b),
    [duration],
  );

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

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6">{session.title}</DialogTitle>
        <DialogDescription>
          {canEdit
            ? "Set the exact day, room, and time. Changes save immediately."
            : "Scheduling changes are limited to event admins."}
        </DialogDescription>
      </DialogHeader>

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
