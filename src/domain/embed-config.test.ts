import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMBED_CONFIG,
  applyEmbedGalleryConfig,
  applyEmbedScheduleConfig,
  embedFeedPath,
  embedOutput,
  embedSurfacePath,
  parseEmbedConfig,
} from "@/domain/embed-config";
import type { GallerySpeaker, ScheduleDay } from "@/domain/program";

function params(value: string): URLSearchParams {
  return new URLSearchParams(value);
}

describe("embed configuration", () => {
  it("parses bounded, valid URL configuration and rejects malformed colors", () => {
    const config = parseEmbedConfig(
      params("widget=gallery&track=Platform&bio=0&primary=%23ff0000&background=red&css=.card%7Bdisplay:none%7D"),
    );
    expect(config).toMatchObject({
      widget: "gallery",
      track: "Platform",
      showBio: false,
      primaryColor: "#ff0000",
      backgroundColor: DEFAULT_EMBED_CONFIG.backgroundColor,
      customCss: ".card{display:none}",
    });
  });

  it("bounds custom CSS and cannot close its style element", () => {
    const config = parseEmbedConfig(params(`css=${encodeURIComponent(`a{color:red}</style>${"x".repeat(1100)}`)}`));
    expect(config.customCss).not.toMatch(/<\/style/i);
    expect(config.customCss.length).toBe(1000);
  });

  it("builds all distribution formats from the same stateless configuration", () => {
    const config = { ...DEFAULT_EMBED_CONFIG, widget: "sessions" as const, track: "AI & Agents" };
    expect(embedSurfacePath("summit", config)).toContain("/embed/summit/schedule?");
    expect(embedFeedPath("summit", "xml", config)).toContain("/p/summit/feed.xml?");
    expect(embedOutput("https://greenroom.test", "summit", "script", config)).toContain(
      'data-path="/embed/summit/schedule?',
    );
    expect(embedOutput("https://greenroom.test", "summit", "iframe", config)).toContain("<iframe");
    expect(embedOutput("https://greenroom.test", "summit", "ical", config)).toContain("feed.ics");
  });

  it("gives the speaker gallery its own discoverable embed route", () => {
    const config = { ...DEFAULT_EMBED_CONFIG, widget: "gallery" as const };
    expect(embedSurfacePath("summit", config)).toBe("/embed/summit/gallery?widget=gallery");
  });
});

describe("configured program data", () => {
  const days: ScheduleDay[] = [
    {
      day: "2026-05-01",
      slots: [
        {
          startTime: "10:00",
          endTime: "10:30",
          sessions: [
            {
              id: "s1",
              title: "Agents",
              description: "Secret abstract",
              day: "2026-05-01",
              startTime: "10:00",
              endTime: "10:30",
              roomName: "Main",
              trackName: "AI",
              trackColor: null,
              formatLabel: "30-minute talk",
              speakers: [{ name: "Priya", title: "Engineer", company: "Northwind" }],
            },
            {
              id: "s2",
              title: "Web",
              description: "Browser talk",
              day: "2026-05-01",
              startTime: "10:00",
              endTime: "10:30",
              roomName: "Side",
              trackName: "Web",
              trackColor: null,
              formatLabel: "30-minute talk",
              speakers: [],
            },
          ],
        },
      ],
    },
  ];

  it("applies track and card-field choices before any HTML/feed consumer sees data", () => {
    const configured = applyEmbedScheduleConfig(days, {
      ...DEFAULT_EMBED_CONFIG,
      track: "AI",
      showDescription: false,
      showAffiliation: false,
    });
    expect(configured[0].slots[0].sessions).toHaveLength(1);
    expect(configured[0].slots[0].sessions[0]).toMatchObject({
      title: "Agents",
      description: null,
      speakers: [{ name: "Priya", title: null, company: null }],
    });
  });

  it("filters speakers by talk track and removes optional profile fields", () => {
    const speakers: GallerySpeaker[] = [
      {
        id: "u1",
        name: "Priya",
        title: "Engineer",
        company: "Northwind",
        bio: "Biography",
        headshotUrl: "/headshot.png",
        websiteUrl: "https://example.com",
        linkedinUrl: null,
        twitterUrl: null,
        talks: [
          {
            sessionId: "s1",
            title: "Agents",
            day: null,
            startTime: null,
            endTime: null,
            roomName: null,
            trackName: "AI",
          },
        ],
      },
    ];
    const configured = applyEmbedGalleryConfig(speakers, {
      ...DEFAULT_EMBED_CONFIG,
      track: "AI",
      showBio: false,
      showHeadshot: false,
      showLinks: false,
    });
    expect(configured[0]).toMatchObject({ bio: null, headshotUrl: null, websiteUrl: null });
    expect(applyEmbedGalleryConfig(speakers, { ...DEFAULT_EMBED_CONFIG, track: "Web" })).toEqual([]);
  });
});
