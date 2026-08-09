/**
 * Speaker profile editing (spec.md §6 — a speaker "edits their own profile
 * (name, title, company, bio, social/web links) and headshot, which feed the
 * admin roster and public gallery").
 *
 * Pure TypeScript: no datastore imports, no I/O. The editor at
 * /portal/profile renders these fields through the shared schema-driven form
 * (src/components/schema-form), and its server action re-runs
 * `parseProfileInput` on whatever arrives before anything reaches
 * `UsersRepo.update` — the browser's copy of the rules is a convenience, this
 * is the enforcement.
 */
import type { FormField } from "@/db/entities";
import { fileUrl, keyFromFileUrl, MAX_UPLOAD_LABEL } from "@/lib/uploads";

/**
 * Field ids for the synthetic form schema the editor renders. They're
 * deliberately *not* the entity keys for the link fields: the ids double as
 * DOM ids, and snake_case matches how every other form field in the app is
 * named (src/db/entities.ts RESERVED_FIELD_IDS).
 */
export const PROFILE_FIELD_IDS = {
  name: "name",
  title: "title",
  company: "company",
  bio: "bio",
  headshot: "headshot",
  websiteUrl: "website_url",
  linkedinUrl: "linkedin_url",
  twitterUrl: "twitter_url",
} as const;

/**
 * Caps on what a speaker can store. Generous enough that nobody legitimately
 * hits them, tight enough that the public gallery card can't be used as a
 * billboard (or a place to park a megabyte of text).
 */
export const PROFILE_LIMITS = {
  name: 120,
  title: 160,
  company: 160,
  bio: 2000,
  url: 500,
} as const;

/**
 * The editor's questions, expressed in the same JSON field schema the CFP and
 * onboarding forms use (decisions.md D-009) so /portal/profile reuses the one
 * schema-driven renderer instead of hand-rolling a second form: same controls,
 * same validation wiring, same upload handling.
 *
 * Synthetic rather than stored — a profile isn't an organizer-editable form,
 * so these fields live in code, not in a `forms` row.
 */
export const PROFILE_FORM_FIELDS: FormField[] = [
  {
    id: PROFILE_FIELD_IDS.name,
    type: "text",
    label: "Your name",
    helpText: "How you're credited on the program and the public speaker gallery.",
    required: true,
  },
  {
    id: PROFILE_FIELD_IDS.title,
    type: "text",
    label: "Job title",
  },
  {
    id: PROFILE_FIELD_IDS.company,
    type: "text",
    label: "Company or organization",
  },
  {
    id: PROFILE_FIELD_IDS.bio,
    type: "textarea",
    label: "Speaker bio",
    helpText: "A short third-person bio we can print in the program and show on your gallery card.",
  },
  {
    id: PROFILE_FIELD_IDS.headshot,
    type: "file",
    label: "Headshot",
    helpText: `Square, at least 800×800 — JPEG, PNG, WebP, GIF, or AVIF, up to ${MAX_UPLOAD_LABEL}.`,
  },
  {
    id: PROFILE_FIELD_IDS.websiteUrl,
    type: "url",
    label: "Website",
    helpText: "A full link, starting with https://",
  },
  {
    id: PROFILE_FIELD_IDS.linkedinUrl,
    type: "url",
    label: "LinkedIn",
  },
  {
    id: PROFILE_FIELD_IDS.twitterUrl,
    type: "url",
    label: "X (Twitter)",
  },
];

/** The subset of `User` a speaker owns — exactly what the action patches. */
export interface ProfilePatch {
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshotUrl: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
}

/** What the editor prefills its inputs with, derived from the stored user. */
export interface ProfileFormValues {
  name: string;
  title: string;
  company: string;
  bio: string;
  /** The upload *key*, not the URL — that's what the file control holds. */
  headshot: string;
  website_url: string;
  linkedin_url: string;
  twitter_url: string;
}

export interface ProfileSource {
  name: string | null;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshotUrl: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
}

export type ProfileParseResult =
  | { ok: true; patch: ProfilePatch }
  | { ok: false; errors: Record<string, string> };

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Trimmed text, or null — an emptied box means "I don't have one", not "". */
function orNull(value: unknown): string | null {
  return asText(value) || null;
}

/**
 * A link a browser can actually follow. Stricter than "looks like a URL":
 * `javascript:` and `data:` are rejected outright, because these values are
 * rendered as `href`s on a public page.
 */
function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname !== "";
}

/**
 * Default values for the editor's form. The headshot comes back as the upload
 * key so the file control can render and clear it; a headshot stored as an
 * external URL (seed/demo data) has no key, so the box starts empty and
 * `parseProfileInput` keeps the stored value rather than treating the empty
 * box as a removal.
 */
export function profileFormValues(user: ProfileSource): ProfileFormValues {
  return {
    name: user.name ?? "",
    title: user.title ?? "",
    company: user.company ?? "",
    bio: user.bio ?? "",
    headshot: (user.headshotUrl && keyFromFileUrl(user.headshotUrl)) || "",
    website_url: user.websiteUrl ?? "",
    linkedin_url: user.linkedinUrl ?? "",
    twitter_url: user.twitterUrl ?? "",
  };
}

/**
 * Validates and normalizes a submitted profile into a repo patch.
 *
 * Name is the only required field — a speaker with no bio yet is a normal
 * state, an anonymous card on the public gallery is not. Every other text
 * field normalizes empty to `null`, and each link must parse as an http(s)
 * URL. Errors are keyed by form field id so the renderer can put each message
 * under its own input.
 */
export function parseProfileInput(
  values: Record<string, unknown>,
  current: { headshotUrl: string | null },
): ProfileParseResult {
  const errors: Record<string, string> = {};

  const name = asText(values[PROFILE_FIELD_IDS.name]);
  if (!name) errors[PROFILE_FIELD_IDS.name] = "Your name is required";
  else if (name.length > PROFILE_LIMITS.name) {
    errors[PROFILE_FIELD_IDS.name] = `Keep this under ${PROFILE_LIMITS.name} characters`;
  }

  const title = orNull(values[PROFILE_FIELD_IDS.title]);
  if (title && title.length > PROFILE_LIMITS.title) {
    errors[PROFILE_FIELD_IDS.title] = `Keep this under ${PROFILE_LIMITS.title} characters`;
  }

  const company = orNull(values[PROFILE_FIELD_IDS.company]);
  if (company && company.length > PROFILE_LIMITS.company) {
    errors[PROFILE_FIELD_IDS.company] = `Keep this under ${PROFILE_LIMITS.company} characters`;
  }

  const bio = orNull(values[PROFILE_FIELD_IDS.bio]);
  if (bio && bio.length > PROFILE_LIMITS.bio) {
    errors[PROFILE_FIELD_IDS.bio] =
      `That's over ${PROFILE_LIMITS.bio} characters — trim it a little`;
  }

  const links: Record<string, string | null> = {};
  for (const fieldId of [
    PROFILE_FIELD_IDS.websiteUrl,
    PROFILE_FIELD_IDS.linkedinUrl,
    PROFILE_FIELD_IDS.twitterUrl,
  ]) {
    const link = orNull(values[fieldId]);
    links[fieldId] = link;
    if (!link) continue;
    if (link.length > PROFILE_LIMITS.url) {
      errors[fieldId] = `Keep this under ${PROFILE_LIMITS.url} characters`;
    } else if (!isHttpUrl(link)) {
      errors[fieldId] = "Enter a full link, starting with https://";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    patch: {
      name,
      title,
      company,
      bio,
      headshotUrl: nextHeadshotUrl(values[PROFILE_FIELD_IDS.headshot], current.headshotUrl),
      websiteUrl: links[PROFILE_FIELD_IDS.websiteUrl],
      linkedinUrl: links[PROFILE_FIELD_IDS.linkedinUrl],
      twitterUrl: links[PROFILE_FIELD_IDS.twitterUrl],
    },
  };
}

/**
 * The headshot the save should end up with.
 *
 * A non-empty value is an upload key (the file control uploads on pick and
 * holds the returned key), so it becomes the URL that serves it back. An
 * empty box means "remove it" — *unless* the stored headshot was never
 * representable as a key in the first place (an externally hosted URL), in
 * which case the empty box says nothing about the speaker's intent and the
 * stored value is left alone.
 */
export function nextHeadshotUrl(value: unknown, currentHeadshotUrl: string | null): string | null {
  const key = asText(value);
  if (key) return fileUrl(key);
  if (currentHeadshotUrl && keyFromFileUrl(currentHeadshotUrl) === null) return currentHeadshotUrl;
  return null;
}

/** Link types the public gallery card renders, in display order. */
export interface ProfileLink {
  kind: "website" | "linkedin" | "twitter";
  label: string;
  url: string;
}

/**
 * The speaker's links, ready to render — empty ones dropped, and anything
 * that isn't an http(s) URL dropped too, so a value that predates this
 * validation (or arrived from an import) can never become a live `href` on a
 * public page.
 */
export function profileLinks(source: {
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
}): ProfileLink[] {
  const candidates: ProfileLink[] = [
    { kind: "website", label: "Website", url: asText(source.websiteUrl) },
    { kind: "linkedin", label: "LinkedIn", url: asText(source.linkedinUrl) },
    { kind: "twitter", label: "X", url: asText(source.twitterUrl) },
  ];
  return candidates.filter((link) => isHttpUrl(link.url));
}
