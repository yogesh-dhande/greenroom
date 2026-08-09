/**
 * File-upload rules and key naming for the R2 bucket (spec.md §2 —
 * bio/headshot/supporting-file fields; the `FILES` binding in wrangler.jsonc).
 *
 * Pure helpers only: no R2 or Cloudflare imports, so the same rules can be
 * enforced in the browser before an upload starts and on the server before
 * anything is written. The bucket itself is reached through
 * `getFilesBucket()` in src/lib/db.ts.
 *
 * Keys are opaque to the rest of the app: what gets stored on a submission is
 * the key, and `/files/<key>` is the URL that serves it back
 * (src/app/files/[...key]/route.ts).
 */

/** Big enough for a print-quality headshot or a slide deck, small enough that
 * a stalled upload on conference wifi isn't a five-minute wait. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const MAX_UPLOAD_LABEL = "10 MB";

/** What a CFP form legitimately collects: images and documents. */
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

/** `accept` attribute for the file input, derived from the same list. */
export const UPLOAD_ACCEPT_ATTRIBUTE = ALLOWED_UPLOAD_TYPES.join(",");

/**
 * The subset a picture-only field accepts — a speaker's headshot (spec.md §6),
 * which is rendered as an `<img>` on the public gallery, so a PDF or a .docx
 * there is never a useful answer even though the general upload rules allow
 * them elsewhere.
 */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export const IMAGE_ACCEPT_ATTRIBUTE = ALLOWED_IMAGE_TYPES.join(",");

export function isImageUploadType(type: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

/** Every key the app writes lives under this prefix, so the public file route
 * can refuse to serve anything else in the bucket (e.g. the incremental
 * cache, which shares the binding). */
export const UPLOAD_PREFIX = "uploads";

export type UploadProblem = "too-large" | "unsupported-type" | "empty";

export function checkUpload(file: { size: number; type: string }): UploadProblem | null {
  if (file.size === 0) return "empty";
  if (file.size > MAX_UPLOAD_BYTES) return "too-large";
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) return "unsupported-type";
  return null;
}

export function uploadProblemMessage(problem: UploadProblem): string {
  switch (problem) {
    case "empty":
      return "That file looks empty — try another one.";
    case "too-large":
      return `That file is over ${MAX_UPLOAD_LABEL}. Try a smaller version.`;
    case "unsupported-type":
      return "That file type isn't supported. Use an image, PDF, or document.";
  }
}

/** Filename reduced to something safe to put in a key and a URL, extension
 * preserved so the download has a sensible name. */
export function safeFilename(filename: string): string {
  const cleaned = filename
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(-80) || "file";
}

/**
 * A collision-proof key: `uploads/<scope>/<random>-<filename>`. The random
 * segment (not the filename) is what makes it unique, so two speakers both
 * uploading `headshot.jpg` never overwrite each other.
 */
export function uploadKey(scope: string, filename: string): string {
  const safeScope = safeFilename(scope) || "misc";
  const unique = crypto.randomUUID().split("-")[0];
  return `${UPLOAD_PREFIX}/${safeScope}/${unique}-${safeFilename(filename)}`;
}

/** True for keys the public file route is allowed to serve. */
export function isServableKey(key: string): boolean {
  if (!key.startsWith(`${UPLOAD_PREFIX}/`)) return false;
  // No traversal, no absolute paths, no empty segments.
  return !key.includes("..") && !key.includes("//") && !key.startsWith("/");
}

/** The URL that serves a stored key back to a browser. */
export function fileUrl(key: string): string {
  return `/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Inverse of `fileUrl`, for values that were stored as a URL rather than a
 * bare key (a speaker's `headshotUrl`, for instance). */
export function keyFromFileUrl(value: string): string | null {
  if (!value.startsWith("/files/")) return null;
  const key = value
    .slice("/files/".length)
    .split("/")
    .map(decodeURIComponent)
    .join("/");
  return isServableKey(key) ? key : null;
}

/** Best-effort display name for a stored key. */
export function filenameFromKey(key: string): string {
  const last = key.split("/").pop() ?? key;
  // Strip the random uniqueness segment we added in `uploadKey`.
  return last.replace(/^[0-9a-f]{8}-/, "");
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);

/** Whether a stored key is one of the image types a browser can render
 * directly — the file control uses this to swap the filename link's icon for
 * an actual thumbnail (a headshot upload, most often). Keys carry no content
 * type, so this is an extension guess, same as the browser's own `accept`
 * negotiation was. */
export function isImageKey(key: string): boolean {
  const ext = filenameFromKey(key).split(".").pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}
