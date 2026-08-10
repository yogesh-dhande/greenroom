import type { ProgramFeed } from "@/domain/program";

function xml(value: string | null | boolean): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function element(name: string, value: string | null | boolean): string {
  return `<${name}>${xml(value)}</${name}>`;
}

/** Stable, dependency-free public XML representation of the JSON program feed. */
export function buildProgramXml(feed: ProgramFeed): string {
  const sessions = feed.sessions
    .map(
      (session) =>
        `<session>${element("title", session.title)}${element("description", session.description)}` +
        `${element("day", session.day)}${element("startTime", session.startTime)}` +
        `${element("endTime", session.endTime)}${element("room", session.roomName)}` +
        `${element("track", session.trackName)}<speakers>${session.speakers
          .map(
            (speaker) =>
              `<speaker>${element("name", speaker.name)}${element("title", speaker.title)}` +
              `${element("company", speaker.company)}</speaker>`,
          )
          .join("")}</speakers></session>`,
    )
    .join("");
  const speakers = feed.speakers
    .map(
      (speaker) =>
        `<speaker>${element("name", speaker.name)}${element("title", speaker.title)}` +
        `${element("company", speaker.company)}${element("bio", speaker.bio)}` +
        `${element("headshotUrl", speaker.headshotUrl)}</speaker>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><program>${element("name", feed.event.name)}` +
    `${element("timezone", feed.event.timezone)}${element("programPublished", feed.programPublished)}` +
    `<sessions>${sessions}</sessions><speakers>${speakers}</speakers></program>`;
}
