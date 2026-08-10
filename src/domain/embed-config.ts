import {
  ANY_FACET,
  filterScheduleDays,
  type GallerySpeaker,
  type ScheduleDay,
} from "@/domain/program";

export const EMBED_WIDGETS = ["sessions", "speakers", "agenda", "itinerary", "gallery"] as const;
export type EmbedWidget = (typeof EMBED_WIDGETS)[number];

export const EMBED_FORMATS = ["script", "iframe", "json", "xml", "ical"] as const;
export type EmbedFormat = (typeof EMBED_FORMATS)[number];

export interface EmbedConfig {
  widget: EmbedWidget;
  track: string | null;
  showDescription: boolean;
  showAffiliation: boolean;
  showBio: boolean;
  showHeadshot: boolean;
  showLinks: boolean;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  customCss: string;
}

export const DEFAULT_EMBED_CONFIG: EmbedConfig = {
  widget: "agenda",
  track: null,
  showDescription: true,
  showAffiliation: true,
  showBio: true,
  showHeadshot: true,
  showLinks: true,
  primaryColor: "#2563eb",
  backgroundColor: "#ffffff",
  textColor: "#111827",
  customCss: "",
};

type SearchReader = Pick<URLSearchParams, "get">;

export type EmbedSearchParams = Record<string, string | string[] | undefined>;

export function embedSearchParams(values: EmbedSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(name, item);
    } else if (value !== undefined) {
      params.set(name, value);
    }
  }
  return params;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && allowed.includes(value as T) ? (value as T) : fallback;
}

function color(value: string | null, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function shown(params: SearchReader, name: string): boolean {
  return params.get(name) !== "0";
}

export function parseEmbedConfig(params: SearchReader): EmbedConfig {
  const track = params.get("track")?.trim().slice(0, 120) || null;
  return {
    widget: oneOf(params.get("widget"), EMBED_WIDGETS, DEFAULT_EMBED_CONFIG.widget),
    track,
    showDescription: shown(params, "description"),
    showAffiliation: shown(params, "affiliation"),
    showBio: shown(params, "bio"),
    showHeadshot: shown(params, "headshot"),
    showLinks: shown(params, "links"),
    primaryColor: color(params.get("primary"), DEFAULT_EMBED_CONFIG.primaryColor),
    backgroundColor: color(params.get("background"), DEFAULT_EMBED_CONFIG.backgroundColor),
    textColor: color(params.get("text"), DEFAULT_EMBED_CONFIG.textColor),
    // CSS is rendered inside a <style> element. React escapes text children,
    // but removing an attempted closing tag here keeps the value safe even if
    // that rendering detail changes or another consumer writes it directly.
    customCss: (params.get("css") ?? "").replace(/<\/style/gi, "").slice(0, 1000),
  };
}

export function embedConfigQuery(config: EmbedConfig): string {
  const params = new URLSearchParams();
  params.set("widget", config.widget);
  if (config.track) params.set("track", config.track);
  if (!config.showDescription) params.set("description", "0");
  if (!config.showAffiliation) params.set("affiliation", "0");
  if (!config.showBio) params.set("bio", "0");
  if (!config.showHeadshot) params.set("headshot", "0");
  if (!config.showLinks) params.set("links", "0");
  if (config.primaryColor !== DEFAULT_EMBED_CONFIG.primaryColor) params.set("primary", config.primaryColor);
  if (config.backgroundColor !== DEFAULT_EMBED_CONFIG.backgroundColor) params.set("background", config.backgroundColor);
  if (config.textColor !== DEFAULT_EMBED_CONFIG.textColor) params.set("text", config.textColor);
  if (config.customCss.trim()) params.set("css", config.customCss.trim());
  return params.toString();
}

export function embedFamily(widget: EmbedWidget): "schedule" | "speakers" {
  return widget === "speakers" || widget === "gallery" ? "speakers" : "schedule";
}

export function embedSurfacePath(eventSlug: string, config: EmbedConfig): string {
  const query = embedConfigQuery(config);
  return `/embed/${eventSlug}/${embedFamily(config.widget)}${query ? `?${query}` : ""}`;
}

export function embedFeedPath(
  eventSlug: string,
  format: Extract<EmbedFormat, "json" | "xml" | "ical">,
  config: EmbedConfig,
): string {
  const extension = format === "ical" ? "ics" : format;
  const query = embedConfigQuery(config);
  return `/p/${eventSlug}/feed.${extension}${query ? `?${query}` : ""}`;
}

export function embedOutput(
  origin: string,
  eventSlug: string,
  format: EmbedFormat,
  config: EmbedConfig,
): string {
  if (format === "json" || format === "xml" || format === "ical") {
    return `${origin}${embedFeedPath(eventSlug, format, config)}`;
  }
  const path = embedSurfacePath(eventSlug, config);
  if (format === "iframe") {
    return `<iframe src="${origin}${path}" title="Event program" width="100%" height="720" style="border:0;" loading="lazy"></iframe>`;
  }
  return `<script src="${origin}/embed.js" data-path="${path.replaceAll("&", "&amp;")}" async></script>`;
}

export function applyEmbedScheduleConfig(days: ScheduleDay[], config: EmbedConfig): ScheduleDay[] {
  const filtered = config.track
    ? filterScheduleDays(days, { track: config.track })
    : filterScheduleDays(days, { track: ANY_FACET });
  return filtered.map((day) => ({
    ...day,
    slots: day.slots.map((slot) => ({
      ...slot,
      sessions: slot.sessions.map((session) => ({
        ...session,
        description: config.showDescription ? session.description : null,
        speakers: session.speakers.map((speaker) => ({
          ...speaker,
          title: config.showAffiliation ? speaker.title : null,
          company: config.showAffiliation ? speaker.company : null,
        })),
      })),
    })),
  }));
}

export function applyEmbedGalleryConfig(
  speakers: GallerySpeaker[],
  config: EmbedConfig,
): GallerySpeaker[] {
  return speakers
    .filter((speaker) => !config.track || speaker.talks.some((talk) => talk.trackName === config.track))
    .map((speaker) => ({
      ...speaker,
      title: config.showAffiliation ? speaker.title : null,
      company: config.showAffiliation ? speaker.company : null,
      bio: config.showBio ? speaker.bio : null,
      headshotUrl: config.showHeadshot ? speaker.headshotUrl : null,
      websiteUrl: config.showLinks ? speaker.websiteUrl : null,
      linkedinUrl: config.showLinks ? speaker.linkedinUrl : null,
      twitterUrl: config.showLinks ? speaker.twitterUrl : null,
    }));
}
