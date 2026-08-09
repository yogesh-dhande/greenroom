import type { GallerySpeaker } from "@/domain/program";
import { EmptyState } from "@/components/empty-state";
import { SpeakerHeadshot } from "./speaker-headshot";

/**
 * The public speaker gallery grid (spec.md "Important / strongly desired").
 * Shared by the chrome'd `/p/[eventSlug]/speakers` page and the chrome-less
 * `/embed/[eventSlug]/speakers` page — this component owns the layout, the
 * page around it owns the header/nav.
 */
export function SpeakerGallery({ speakers }: { speakers: GallerySpeaker[] }) {
  if (speakers.length === 0) {
    return (
      <EmptyState
        title="Speakers coming soon"
        description="The lineup will appear here as talks are confirmed."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {speakers.map((speaker) => (
        <article
          key={speaker.id}
          className="flex flex-col gap-3 rounded-xl bg-card p-5 text-card-foreground ring-1 ring-foreground/10"
        >
          <div className="flex items-center gap-3">
            <SpeakerHeadshot name={speaker.name} headshotUrl={speaker.headshotUrl} />
            <div className="min-w-0">
              <h3 className="truncate font-heading text-base font-semibold text-foreground">
                {speaker.name}
              </h3>
              {(speaker.title || speaker.company) && (
                <p className="truncate text-sm text-muted-foreground">
                  {[speaker.title, speaker.company].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </div>

          {speaker.bio && (
            <p className="line-clamp-4 text-sm leading-6 text-muted-foreground">{speaker.bio}</p>
          )}

          {speaker.talks.length > 0 && (
            <ul className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
              {speaker.talks.map((talk) => (
                <li
                  key={talk.sessionId}
                  className="text-sm font-medium text-foreground before:mr-1.5 before:text-primary before:content-['—']"
                >
                  {talk.title}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}
