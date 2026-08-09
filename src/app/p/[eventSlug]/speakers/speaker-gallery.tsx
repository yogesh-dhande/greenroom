"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { filterSpeakers, type GallerySpeaker } from "@/domain/program";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { SpeakerDialog } from "./speaker-dialog";
import { SpeakerHeadshot } from "./speaker-headshot";
import { SpeakerProfileLinks } from "./speaker-profile-links";

/**
 * The public speaker gallery / directory (spec.md "Important / strongly
 * desired" + "Public program depth", decisions.md D-031): an alphabetical
 * grid of cards, a name search over it, and a click-through detail view with
 * the speaker's full bio and every talk they're on.
 *
 * A client component filtering an already-rendered list — the lineup is a few
 * dozen people and is already on the page, so searching it needs no server
 * round-trip and the page itself stays statically cacheable. Ordering
 * (surname, see `buildGallery`) is settled server-side so both surfaces agree.
 *
 * Shared by the chrome'd `/p/[eventSlug]/speakers` page and the chrome-less
 * `/embed/[eventSlug]/speakers` page — this component owns the layout, the
 * page around it owns the header/nav.
 */
export function SpeakerGallery({
  speakers,
  timezone,
}: {
  speakers: GallerySpeaker[];
  timezone: string;
}) {
  const [query, setQuery] = useState("");
  const [openSpeakerId, setOpenSpeakerId] = useState<string | null>(null);

  const shown = useMemo(
    () => filterSpeakers(speakers, query),
    [speakers, query],
  );
  const openSpeaker =
    speakers.find((speaker) => speaker.id === openSpeakerId) ?? null;

  if (speakers.length === 0) {
    return (
      <EmptyState
        title="Speakers coming soon"
        description="The lineup will appear here as talks are confirmed."
      />
    );
  }

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
            aria-label="Search speakers by name"
            placeholder="Search speakers"
            className="pl-8"
          />
        </div>
        <p
          className="ml-auto text-sm text-muted-foreground"
          aria-live="polite"
          data-testid="speaker-count"
        >
          {shown.length === speakers.length
            ? `${speakers.length} speakers`
            : `${shown.length} of ${speakers.length} speakers`}
        </p>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title="No speakers match"
          description="Try a different name, or clear the search to see the whole lineup."
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((speaker) => (
            <SpeakerCard
              key={speaker.id}
              speaker={speaker}
              onOpen={() => setOpenSpeakerId(speaker.id)}
            />
          ))}
        </div>
      )}

      <SpeakerDialog
        speaker={openSpeaker}
        timezone={timezone}
        onClose={() => setOpenSpeakerId(null)}
      />
    </div>
  );
}

/**
 * One card in the grid. As on the schedule, the name carries the click target
 * and an overlay pseudo-element stretches it over the whole card, so clicking
 * anywhere opens the profile while the accessible name stays the speaker's —
 * the profile links sit above the overlay and keep working as links.
 */
function SpeakerCard({
  speaker,
  onOpen,
}: {
  speaker: GallerySpeaker;
  onOpen: () => void;
}) {
  return (
    <article className="relative flex flex-col gap-3 rounded-xl bg-card p-5 text-card-foreground ring-1 ring-foreground/10 transition-shadow focus-within:ring-2 focus-within:ring-ring hover:ring-foreground/20">
      <div className="flex items-center gap-3">
        <SpeakerHeadshot
          name={speaker.name}
          headshotUrl={speaker.headshotUrl}
        />
        <div className="min-w-0">
          <h3 className="truncate font-heading text-base font-semibold text-foreground">
            <button
              type="button"
              onClick={onOpen}
              className="max-w-full truncate text-left outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
            >
              {speaker.name}
            </button>
          </h3>
          {/* A speaker with neither a title nor a company keeps a clean card
              rather than an empty line or a stray separator. */}
          {(speaker.title || speaker.company) && (
            <p className="truncate text-sm text-muted-foreground">
              {[speaker.title, speaker.company].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>

      {speaker.bio && (
        <p className="line-clamp-4 text-sm leading-6 text-muted-foreground">
          {speaker.bio}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-3">
        {speaker.talks.length > 0 && (
          <ul className="flex flex-col gap-1 border-t border-border pt-3">
            {speaker.talks.map((talk) => (
              <li
                key={talk.sessionId}
                className="text-sm font-medium text-foreground before:mr-1.5 before:text-primary before:content-['—']"
              >
                {talk.title}
                {/* Mirrors the speaker detail modal's "Time to be announced"
                    (speaker-dialog.tsx) so the grid never disagrees with the
                    schedule about a talk that isn't placed yet. */}
                {!(talk.day && talk.startTime && talk.endTime) && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · time to be announced
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <SpeakerProfileLinks
          speaker={speaker}
          className="border-t border-border pt-3"
        />
      </div>
    </article>
  );
}
