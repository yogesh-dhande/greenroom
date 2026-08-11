"use client";

import { useMemo, useState } from "react";
import { CalendarPlusIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import {
  ANY_FACET,
  countScheduleSessions,
  filterScheduleDays,
  flattenSchedule,
  itinerarySessions,
  scheduleFacetOptions,
  speakerAffiliationLabel,
  type ScheduleDay,
  type ScheduleSessionView,
} from "@/domain/program";
import { formatEventDay, formatEventTimeRange } from "@/lib/event-time";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SessionDialog } from "./session-dialog";
import { StarToggle } from "./star-toggle";
import { useItinerary } from "./use-itinerary";

/**
 * The public schedule (spec.md "Important / strongly desired" + "Public
 * program depth", decisions.md D-031): day tabs holding time-ordered slots,
 * plus keyword search across titles *and* speaker names, Track/Room/Format
 * facets, a click-through detail view, and a personal itinerary. Times render
 * in the event's own timezone (questions.md Q6 working assumption — no
 * viewer-local conversion).
 *
 * A client component filtering an already-rendered list rather than a server
 * round-trip per keystroke: a conference programme is a few dozen rows, the
 * whole day set is already on the page, and this keeps `/p/[eventSlug]` and
 * its `/embed` twin statically cacheable with no query parameters to vary on.
 *
 * Shared by the chrome'd `/p/[eventSlug]/schedule` page and the chrome-less
 * `/embed/[eventSlug]/schedule` page; the embed opts out of the itinerary
 * (`itinerary={false}`) — a starred list belongs to the attendee's own visit,
 * not to a third-party page that iframes the programme.
 */
export function ScheduleView({
  days,
  timezone,
  eventSlug,
  itinerary = false,
}: {
  days: ScheduleDay[];
  timezone: string;
  eventSlug: string;
  itinerary?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState(ANY_FACET);
  const [room, setRoom] = useState(ANY_FACET);
  const [format, setFormat] = useState(ANY_FACET);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);

  const { starred, isStarred, toggle } = useItinerary(eventSlug);

  const facets = useMemo(() => scheduleFacetOptions(days), [days]);
  const filteredDays = useMemo(
    () => filterScheduleDays(days, { query, track, room, format }),
    [days, query, track, room, format],
  );

  const total = useMemo(() => countScheduleSessions(days), [days]);
  const shown = countScheduleSessions(filteredDays);
  const isFiltered =
    query.trim() !== "" || [track, room, format].some((f) => f !== ANY_FACET);

  const mine = useMemo(() => itinerarySessions(days, starred), [days, starred]);
  const openSession =
    flattenSchedule(days).find((session) => session.id === openSessionId) ??
    null;

  if (days.length === 0) {
    return (
      <EmptyState
        title="Schedule coming soon"
        description="Sessions will appear here once they're placed on the agenda."
      />
    );
  }

  const dayValues = filteredDays.map((day) => day.day);
  // The active day tab can disappear from under the attendee when a search
  // narrows the programme to other days, so fall back to the first day that
  // still has results. "none" keeps Radix from auto-selecting anything while
  // nothing matches.
  const activeTab =
    tab && (tab === MINE || dayValues.includes(tab))
      ? tab
      : (dayValues[0] ?? "none");

  function clearFilters() {
    setQuery("");
    setTrack(ANY_FACET);
    setRoom(ANY_FACET);
    setFormat(ANY_FACET);
  }

  const icsHref = `/p/${eventSlug}/itinerary.ics?s=${encodeURIComponent(mine.map((s) => s.id).join(","))}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(changeEvent) => setQuery(changeEvent.target.value)}
            aria-label="Search sessions by title or speaker"
            placeholder="Search sessions or speakers"
            className="pl-8"
          />
        </div>

        <Facet
          label="Filter by track"
          allLabel="All tracks"
          value={track}
          options={facets.tracks}
          onChange={setTrack}
        />
        <Facet
          label="Filter by room"
          allLabel="All rooms"
          value={room}
          options={facets.rooms}
          onChange={setRoom}
        />
        <Facet
          label="Filter by format"
          allLabel="All formats"
          value={format}
          options={facets.formats}
          onChange={setFormat}
          showSingleOption
        />

        {isFiltered && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}

        <p
          className="ml-auto text-sm text-muted-foreground"
          aria-live="polite"
          data-testid="session-count"
        >
          {shown === total
            ? `${total} ${total === 1 ? "session" : "sessions"}`
            : `${shown} of ${total} sessions`}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setTab} className="gap-6">
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto"
        >
          {filteredDays.map((day) => (
            <TabsTrigger key={day.day} value={day.day}>
              {formatEventDay(day.day, timezone).replace(/^\w+, /, "")}
            </TabsTrigger>
          ))}
          {itinerary && (
            <TabsTrigger value={MINE}>My schedule ({mine.length})</TabsTrigger>
          )}
        </TabsList>

        {filteredDays.map((day) => (
          <TabsContent
            key={day.day}
            value={day.day}
            className="flex flex-col gap-6"
          >
            {day.slots.map((slot) => (
              <section
                key={`${slot.startTime}-${slot.endTime}`}
                className="flex flex-col gap-2 sm:flex-row sm:gap-6"
              >
                <div className="shrink-0 font-mono text-sm whitespace-nowrap text-muted-foreground sm:w-44 sm:pt-4">
                  {formatEventTimeRange(
                    day.day,
                    slot.startTime,
                    slot.endTime,
                    timezone,
                  )}
                </div>
                <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
                  {slot.sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      onOpen={() => setOpenSessionId(session.id)}
                      itinerary={
                        itinerary
                          ? {
                              isStarred: isStarred(session.id),
                              onToggle: () => toggle(session.id),
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </TabsContent>
        ))}

        {itinerary && (
          <TabsContent value={MINE} className="flex flex-col gap-4">
            {mine.length === 0 ? (
              <EmptyState
                title="Nothing starred yet"
                description="Star a session on any day and it will show up here, ready to export to your calendar."
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="itinerary-count"
                  >
                    {mine.length} starred{" "}
                    {mine.length === 1 ? "session" : "sessions"}
                  </p>
                  {/* A real download URL, not a client-built blob: the file
                      is written by src/app/p/[eventSlug]/itinerary.ics, so
                      iCalendar generation stays in src/lib/ics.ts (D-003)
                      and the server-only `ics` package stays out of this
                      bundle. The toast is the only feedback a plain download
                      link gives — the browser's own download UI is easy to
                      miss. */}
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                  >
                    <a
                      href={icsHref}
                      download
                      onClick={() =>
                        toast.success(
                          "Calendar file downloading — add it to your calendar app",
                        )
                      }
                    >
                      <CalendarPlusIcon aria-hidden />
                      Add to calendar (.ics)
                    </a>
                  </Button>
                </div>
                <ol
                  className="flex flex-col gap-3"
                  data-testid="itinerary-list"
                >
                  {mine.map((session) => (
                    <li key={session.id}>
                      <SessionCard
                        session={session}
                        showDay
                        timezone={timezone}
                        onOpen={() => setOpenSessionId(session.id)}
                        itinerary={{
                          isStarred: isStarred(session.id),
                          onToggle: () => toggle(session.id),
                        }}
                      />
                    </li>
                  ))}
                </ol>
              </>
            )}
          </TabsContent>
        )}
      </Tabs>

      {activeTab === "none" && (
        <EmptyState
          title="No sessions match"
          description="Try a different search term, or clear the filters to see the whole programme."
          action={
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}

      <SessionDialog
        session={openSession}
        timezone={timezone}
        onClose={() => setOpenSessionId(null)}
        itinerary={
          itinerary && openSession
            ? {
                isStarred: isStarred(openSession.id),
                onToggle: () => toggle(openSession.id),
              }
            : undefined
        }
      />
    </div>
  );
}

/** Tab value for the personal itinerary — a day is always "YYYY-MM-DD". */
const MINE = "my-schedule";

function Facet({
  label,
  allLabel,
  value,
  options,
  onChange,
  showSingleOption = false,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  showSingleOption?: boolean;
}) {
  // A track or room with nothing to choose between is noise. Format remains
  // useful with one option: it names the session shape available in a small
  // programme and keeps the promised Track/Room/Format controls consistent.
  if (options.length < (showSingleOption ? 1 : 2)) return null;
  return (
    // Native <select>, not shadcn's Radix-backed one: on this public,
    // embeddable surface a listbox with a focus trap and a portal is a
    // pointer trap for assistive tech (eval finding — clicks on options
    // timed out with the trigger aria-hidden while open). A native control
    // has no such state and is lighter in the embed besides.
    <NativeSelect
      aria-label={label}
      className="w-44"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value={ANY_FACET}>{allLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * One session on the grid. The title carries the click target and an overlay
 * pseudo-element stretches it across the whole card, so a pointer anywhere on
 * the card opens the detail view while the accessible name stays the talk's
 * title (rather than a card-shaped button with no name). The star sits above
 * that overlay.
 */
function SessionCard({
  session,
  onOpen,
  itinerary,
  showDay = false,
  timezone,
}: {
  session: ScheduleSessionView;
  onOpen: () => void;
  itinerary?: { isStarred: boolean; onToggle: () => void };
  showDay?: boolean;
  timezone?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="relative flex h-full flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow focus-within:ring-2 focus-within:ring-ring hover:ring-foreground/20">
      <div className="flex flex-wrap items-center gap-2 pr-8">
        {session.trackName && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-muted-foreground"
              style={
                session.trackColor
                  ? { backgroundColor: session.trackColor }
                  : undefined
              }
            />
            {session.trackName}
          </span>
        )}
        {/* A room that isn't assigned yet is said out loud, matching the
            detail dialog's "To be announced" and the gallery's "time to be
            announced" — the card used to just drop the badge, so an attendee
            couldn't tell an unassigned room from one nobody printed. */}
        <Badge variant="outline" className="text-muted-foreground">
          {session.roomName ?? "Room to be announced"}
        </Badge>
        {/* Surfaces what "Filter by format" is filtering on — previously
            only visible inside the session detail dialog (eval finding). */}
        <Badge variant="outline" className="text-muted-foreground">
          {session.formatLabel}
        </Badge>
      </div>

      {showDay && timezone && (
        <p className="font-mono text-xs text-muted-foreground">
          {formatEventDay(session.day, timezone).replace(/^\w+, /, "")} ·{" "}
          {formatEventTimeRange(
            session.day,
            session.startTime,
            session.endTime,
            timezone,
          )}
        </p>
      )}

      <h3 className="font-heading text-base font-semibold text-foreground">
        <button
          type="button"
          onClick={onOpen}
          className="text-left outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
        >
          {session.title}
        </button>
      </h3>

      {session.description && (
        <div className="flex flex-col gap-1">
          <p
            className={
              expanded
                ? "text-sm text-muted-foreground"
                : "line-clamp-2 text-sm text-muted-foreground"
            }
          >
            {session.description}
          </p>
          <button
            type="button"
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              setExpanded((current) => !current);
            }}
            className="relative z-10 w-fit text-xs font-medium text-foreground/70 outline-none hover:text-foreground hover:underline focus-visible:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      )}

      {session.speakers.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {session.speakers.map(speakerAffiliationLabel).join(", ")}
        </p>
      )}

      {itinerary && (
        <div className="absolute top-3 right-3 z-10">
          <StarToggle
            starred={itinerary.isStarred}
            title={session.title}
            onToggle={itinerary.onToggle}
          />
        </div>
      )}
    </article>
  );
}
