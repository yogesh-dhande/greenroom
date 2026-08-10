/**
 * Route segments under /admin that a real event slug must never collide with.
 *
 * `new` is the "create event" page. `directory`, `pipeline` and `crm` are the
 * org-level speaker CRM's pages (decisions.md D-077) — organization-wide
 * surfaces that live beside the events rather than inside one, so an event
 * that claimed one of those slugs would shadow it.
 */
export const RESERVED_EVENT_SLUGS = ["new", "directory", "pipeline", "crm"] as const;

/**
 * Whether a slug is taken by a route rather than available to an event.
 *
 * Case- and whitespace-insensitive even though `SLUG_PATTERN` already forces
 * lowercase: this is the check that has to hold, and it must not depend on the
 * caller having validated the shape first.
 */
export function isReservedEventSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return (RESERVED_EVENT_SLUGS as readonly string[]).includes(normalized);
}

/** Slug shape accepted for an event: lowercase letters, numbers, hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Turns free text into a URL-safe slug: lowercase, hyphen-separated,
 * alphanumerics only. Used to suggest an event slug from its name. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents (combining diacritics)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
