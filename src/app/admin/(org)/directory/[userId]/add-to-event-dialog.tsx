"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PickerSearch } from "@/components/people-picker/people-picker";
import { filterByQuery, isLongList } from "@/components/people-picker/selection";
import { addContactToEvent } from "../actions";
import type { EventOption } from "../types";

/**
 * "Add to event" from a contact profile *or* a pipeline card (spec.md
 * "Org-level speaker CRM": an event picker attaches the contact to that
 * event's roster with profile data carried over without re-entry). One
 * component and one server action for both entry points — the pipeline card
 * page imports this rather than growing a second picker.
 *
 * Events they're already connected to stay in the list but can't be picked —
 * hiding them would leave an organizer wondering whether the picker was
 * broken or the contact was already there. Nothing is copied by the write:
 * identity is global by email (decisions.md D-051), so the roster reads the
 * same record this profile shows.
 *
 * Most orgs run a handful of events, so the select stands on its own; an org
 * with a back catalogue past the shared threshold gets the same search box
 * over the options that the other pickers use.
 */
export function AddToEventDialog({
  userId,
  events,
}: {
  userId: string;
  events: EventOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [eventId, setEventId] = useState("");
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  const selectable = events.filter((event) => !event.connected);

  const searchable = isLongList(events.length);
  const shown = useMemo(() => {
    if (!searchable) return events;
    const matched = filterByQuery(events, query, (event) => [event.name, event.dates]);
    // The picked event survives whatever gets typed afterwards, so the
    // trigger can't go blank over a value the form still holds.
    const chosen = events.find((event) => event.id === eventId);
    return chosen && !matched.some((event) => event.id === eventId)
      ? [chosen, ...matched]
      : matched;
  }, [events, query, searchable, eventId]);

  function submit() {
    if (!eventId) return;
    startTransition(async () => {
      const result = await addContactToEvent({ userId, event: eventId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.message, {
        action: {
          label: "Open roster",
          onClick: () => router.push(`/admin/${result.data.eventSlug}/speakers`),
        },
      });
      setOpen(false);
      setEventId("");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEventId("");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Add to event</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to event</DialogTitle>
          <DialogDescription>
            Puts this contact on the event&apos;s speaker roster. Their profile carries over — name,
            title, company, bio and headshot — with no re-entry, because it&apos;s the same record.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-to-event">Event</Label>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              There are no events yet — create one first.
            </p>
          ) : (
            <>
              {searchable ? (
                <PickerSearch
                  value={query}
                  onValueChange={setQuery}
                  label="Search events"
                  placeholder="Event name or dates"
                />
              ) : null}
              <Select value={eventId} onValueChange={setEventId}>
                <SelectTrigger id="add-to-event" className="w-full">
                  <SelectValue placeholder="Pick an event" />
                </SelectTrigger>
                <SelectContent>
                  {shown.map((event) => (
                    <SelectItem key={event.id} value={event.id} disabled={event.connected}>
                      {event.name} · {event.dates}
                      {event.connected ? " — already on roster" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {searchable && query.trim() ? (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  Showing {shown.length} of {events.length} events
                </p>
              ) : null}
            </>
          )}
          {events.length > 0 && selectable.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              They&apos;re already on every event you run.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" disabled={isPending || !eventId} onClick={submit}>
            {isPending ? "Adding…" : "Add to event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
