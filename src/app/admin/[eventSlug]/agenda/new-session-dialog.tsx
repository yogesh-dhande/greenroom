"use client";

import { useState, useTransition } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Track } from "@/db/entities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { createDirectSession } from "./actions";
import { ActionTimeoutError, withActionTimeout } from "../speakers/action-timeout";
import type { BoardPerson } from "./types";

const NO_TRACK = "__no_track__";

interface PendingSpeaker {
  key: string;
  name: string;
  email: string;
  /** Existing directory user, or a person being created with this session. */
  userId?: string;
}

/**
 * Direct session entry (spec.md §5): a sponsor talk, keynote, or any
 * guaranteed speaker that never went through the CFP. Speakers can be picked
 * from the existing directory or typed in — a new name + email creates the
 * user and the session_speakers link through the repository layer.
 */
export function NewSessionDialog({
  eventSlug,
  tracks,
  directory,
}: {
  eventSlug: string;
  tracks: Track[];
  directory: BoardPerson[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [trackId, setTrackId] = useState(NO_TRACK);
  const [speakers, setSpeakers] = useState<PendingSpeaker[]>([]);
  const [pickerValue, setPickerValue] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setTitle("");
    setDescription("");
    setTrackId(NO_TRACK);
    setSpeakers([]);
    setPickerValue("");
    setNewName("");
    setNewEmail("");
    setError(null);
  }

  function addExisting(userId: string) {
    const person = directory.find((p) => p.id === userId);
    if (!person) return;
    setPickerValue("");
    if (speakers.some((s) => s.userId === person.id || s.email === person.email)) return;
    setSpeakers((current) => [
      ...current,
      { key: person.id, name: person.name, email: person.email, userId: person.id },
    ]);
  }

  function addNewPerson() {
    const name = newName.trim();
    const email = newEmail.trim().toLowerCase();
    if (!name || !email) {
      setError("A new speaker needs both a name and an email address");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address");
      return;
    }
    if (speakers.some((s) => s.email === email)) {
      setError("That speaker is already on this session");
      return;
    }
    setError(null);
    setSpeakers((current) => [...current, { key: `new:${email}`, name, email }]);
    setNewName("");
    setNewEmail("");
  }

  function submit() {
    if (!title.trim()) {
      setError("Give the session a title");
      return;
    }
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await withActionTimeout(
          createDirectSession(eventSlug, {
            title,
            description,
            trackId: trackId === NO_TRACK ? null : trackId,
            existingSpeakerIds: speakers.flatMap((s) => (s.userId ? [s.userId] : [])),
            newSpeakers: speakers.flatMap((s) =>
              s.userId ? [] : [{ name: s.name, email: s.email }],
            ),
          }),
        );
      } catch (error) {
        if (error instanceof ActionTimeoutError) {
          const message =
            "The server didn't respond. Check the unscheduled tray before trying again - the session may have been created.";
          setError(message);
          toast.error(message);
          return;
        }
        throw error;
      }
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Session added to the unscheduled tray");
      setOpen(false);
      reset();
    });
  }

  const available = directory.filter((p) => !speakers.some((s) => s.userId === p.id));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          New session
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            For speakers who don&apos;t come through the call for speakers — sponsors,
            keynotes, invited talks. It lands in the unscheduled tray, ready to place.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-session-title">Title</Label>
            <Input
              id="new-session-title"
              value={title}
              placeholder="Platinum sponsor keynote"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-session-description">Description</Label>
            <Textarea
              id="new-session-description"
              value={description}
              rows={3}
              placeholder="What the session covers — this is what attendees will read."
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-session-track">Track</Label>
            <Select value={trackId} onValueChange={setTrackId}>
              <SelectTrigger id="new-session-track" className="w-full">
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

          <Separator />

          <div className="flex flex-col gap-2">
            <Label>Speakers</Label>
            {speakers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {speakers.map((speaker) => (
                  <Badge key={speaker.key} variant="secondary" className="gap-1 pr-1">
                    {speaker.name}
                    {!speaker.userId && <span className="text-muted-foreground">(new)</span>}
                    <button
                      type="button"
                      aria-label={`Remove ${speaker.name}`}
                      className="rounded-full p-0.5 hover:bg-muted"
                      onClick={() =>
                        setSpeakers((current) => current.filter((s) => s.key !== speaker.key))
                      }
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <Select value={pickerValue} onValueChange={addExisting}>
              <SelectTrigger className="w-full" aria-label="Add an existing speaker">
                <SelectValue placeholder="Add someone already in Greenroom" />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    Everyone is already added
                  </SelectItem>
                ) : (
                  available.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name} · {person.email}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="new-speaker-name" className="text-xs text-muted-foreground">
                  New speaker name
                </Label>
                <Input
                  id="new-speaker-name"
                  value={newName}
                  placeholder="Jordan Reyes"
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="new-speaker-email" className="text-xs text-muted-foreground">
                  Email
                </Label>
                <Input
                  id="new-speaker-email"
                  type="email"
                  value={newEmail}
                  placeholder="jordan@sponsor.com"
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <Button type="button" variant="outline" onClick={addNewPerson}>
                Add
              </Button>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Creating…" : "Create session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
