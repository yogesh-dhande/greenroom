/** Route segments under /admin that a real event slug must never collide
 * with (e.g. /admin/new is the "create event" page, not an event). */
export const RESERVED_EVENT_SLUGS = ["new"] as const;

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
