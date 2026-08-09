import { GlobeIcon, LinkIcon } from "lucide-react";
import type { GallerySpeaker } from "@/domain/program";
import { profileLinks, type ProfileLink } from "@/domain/profile";
import { cn } from "@/lib/utils";

/** Lucide dropped its brand glyphs, so the website link gets the literal icon
 * and the social ones share the generic link mark — the label carries the
 * meaning either way. */
const LINK_ICON: Record<ProfileLink["kind"], typeof GlobeIcon> = {
  website: GlobeIcon,
  linkedin: LinkIcon,
  twitter: LinkIcon,
};

/**
 * Speaker-maintained profile links (spec.md §6), rendered on the gallery card
 * and again in the speaker detail view. Renders nothing when the speaker has
 * no links, which is the common case.
 */
export function SpeakerProfileLinks({
  speaker,
  className,
}: {
  speaker: Pick<GallerySpeaker, "name" | "websiteUrl" | "linkedinUrl" | "twitterUrl">;
  className?: string;
}) {
  const links = profileLinks(speaker);
  if (links.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {links.map((link) => {
        const Icon = LINK_ICON[link.kind];
        return (
          <li key={link.kind} className="relative z-10">
            <a
              href={link.url}
              target="_blank"
              // `nofollow` because these are visitor-supplied links on a
              // public page, not editorial endorsements.
              rel="noreferrer noopener nofollow"
              // Several cards repeat the same label, so the accessible name
              // carries whose link it is.
              aria-label={`${speaker.name} — ${link.label}`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              {link.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
