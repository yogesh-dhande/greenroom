/**
 * "Download all": the shape of the Files library's ZIP export
 * (decisions.md D-073).
 *
 * Naming rules only -- no R2, no fflate, no Cloudflare. The folder layout, the
 * sanitizing and the collision rules are the parts that can be wrong in a way
 * a test can catch, so they live here and the route handler that streams the
 * archive stays a pump over what this returns.
 *
 * A ZIP entry name is a path with `/` separators, so every user-supplied
 * piece (a speaker's name, an uploaded filename) has to be reduced to a
 * single safe segment before it goes in: a name carrying a slash would
 * silently invent a directory level, and one carrying a control character or
 * a Windows-reserved character makes an archive some extractors refuse.
 */
import type { Deliverable } from "@/domain/files";

/**
 * Long enough to keep a real name or filename recognizable, short enough that
 * `<folder>/<file>` stays clear of the path limits extractors run into
 * (Windows' classic 260-character MAX_PATH, most of all).
 */
export const MAX_SEGMENT_LENGTH = 80;

/** Folder for a file whose speaker is no longer resolvable. */
export const UNKNOWN_SPEAKER_FOLDER = "unknown-speaker";

/** Entry name for an upload whose stored filename sanitizes to nothing. */
export const FALLBACK_FILENAME = "file";

// Control characters (C0 plus DEL) are legal in a ZIP name and legal in no
// filesystem worth targeting.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
// Path separators first, then the characters Windows reserves. Replaced with
// a hyphen rather than dropped so "07/12 headshot" does not become "0712".
const SEPARATORS_AND_RESERVED = /[\\/:*?"<>|]/g;
// Leading dots hide a file on Unix; trailing dots and spaces are silently
// dropped by Windows, which turns two distinct names into one on extraction.
const EDGE_DOTS_AND_SPACES = /^[.\s]+|[.\s]+$/g;

/**
 * One path segment, safe to put either side of a `/` in a ZIP entry name.
 *
 * Returns `fallback` when nothing usable survives -- "..", a string of
 * control characters, and the empty string all have to become *some* name,
 * because the alternative is an entry that escapes its folder.
 */
export function sanitizeSegment(raw: string, fallback: string): string {
  return trimTail(cleanSegment(raw).slice(0, MAX_SEGMENT_LENGTH)) || fallback;
}

/** Everything `sanitizeSegment` does except the length cap, so a filename can
 * apply its own extension-aware one. */
function cleanSegment(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(CONTROL_CHARACTERS, "")
    .replace(SEPARATORS_AND_RESERVED, "-")
    .replace(/\s+/g, " ")
    .replace(EDGE_DOTS_AND_SPACES, "");
}

/** Truncation can re-expose a trailing dot or space that was safe mid-name. */
function trimTail(value: string): string {
  return value.replace(/[.\s]+$/, "");
}

/** A filename's extension (with its dot), or "" when it has none worth
 * keeping. Bounded length and no spaces, so "Q3 2026. final report" is read
 * as extensionless rather than as a ".final report" file. */
function extensionOf(filename: string): string {
  const match = /\.[A-Za-z0-9]{1,8}$/.exec(filename);
  // A name that is *only* an extension (".gitignore") has a stem, not a suffix.
  return match && match.index > 0 ? match[0] : "";
}

/**
 * An uploaded file's name, safe as the last segment of a ZIP entry.
 *
 * Truncation preserves the extension: a name cut to 80 characters mid-word is
 * still openable, one cut out of its `.pdf` is a file the recipient has to
 * guess at.
 */
export function sanitizeFilename(raw: string): string {
  const cleaned = cleanSegment(raw);
  if (cleaned.length <= MAX_SEGMENT_LENGTH) return trimTail(cleaned) || FALLBACK_FILENAME;
  const extension = extensionOf(cleaned);
  const stem = trimTail(cleaned.slice(0, MAX_SEGMENT_LENGTH - extension.length));
  return `${stem || FALLBACK_FILENAME}${extension}`;
}

/**
 * `deck.pdf` -> `deck-2.pdf`. The counter goes before the extension so the
 * file still opens in whatever the extension says it is.
 */
export function numberedFilename(filename: string, index: number): string {
  const extension = extensionOf(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  return `${stem}-${index}${extension}`;
}

/**
 * A name no other file in the same folder has yet, counting from `-2`.
 *
 * `taken` is compared case-insensitively and updated in place: ZIPs are
 * extracted onto case-insensitive filesystems as often as not, where
 * `Deck.pdf` and `deck.pdf` are one file and the second silently wins.
 */
export function claimFilename(taken: Set<string>, filename: string): string {
  let candidate = filename;
  let index = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = numberedFilename(filename, index);
    index += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** A speaker as the export names them: whatever the library shows for them,
 * plus the id that disambiguates a shared name. */
export interface ZipSpeaker {
  id: string;
  /** Display name, or the email when there is no name. Empty is allowed --
   * an unresolvable speaker still owns their files. */
  label: string;
}

/**
 * One folder name per speaker id.
 *
 * Two speakers who share a display name (the "John Smith" problem, and every
 * roster of any size has one) both get their user id appended, not just the
 * second one: suffixing only the loser would leave the bare folder looking
 * authoritative, and would rename a speaker's folder between exports
 * depending on who else happened to upload.
 */
export function assignSpeakerFolders(speakers: ZipSpeaker[]): Map<string, string> {
  const baseById = new Map<string, string>();
  const speakersPerBase = new Map<string, number>();
  for (const speaker of speakers) {
    // One speaker owns many files; only their first row defines the folder.
    if (baseById.has(speaker.id)) continue;
    const base = sanitizeSegment(speaker.label, UNKNOWN_SPEAKER_FOLDER);
    baseById.set(speaker.id, base);
    const key = base.toLowerCase();
    speakersPerBase.set(key, (speakersPerBase.get(key) ?? 0) + 1);
  }

  const folders = new Map<string, string>();
  for (const [id, base] of baseById) {
    if ((speakersPerBase.get(base.toLowerCase()) ?? 0) < 2) {
      folders.set(id, base);
      continue;
    }
    // The suffix is what makes the folder unique, so the name yields length
    // to it rather than the other way round.
    const suffix = ` ${sanitizeSegment(id, "id")}`;
    const stem = trimTail(base.slice(0, Math.max(MAX_SEGMENT_LENGTH - suffix.length, 1)));
    folders.set(id, `${stem || UNKNOWN_SPEAKER_FOLDER}${suffix}`);
  }
  return folders;
}

/** One R2 object, and where it lands inside the archive. */
export interface ZipEntry {
  /** `<speaker folder>/<filename>`, unique across the archive. */
  path: string;
  /** The R2 key to stream from. */
  key: string;
}

export interface BuildZipEntriesInput {
  /** The library's rows. Only `current` is exported -- D-073 archives what the
   * event stands on today, not its upload history. */
  deliverables: Pick<Deliverable, "speakerId" | "current">[];
  /** Display name (or email) per speaker id; a missing id is not an error. */
  speakerLabelById: Map<string, string>;
}

/**
 * Every current deliverable, foldered by speaker, ready to stream.
 *
 * A row whose current file was stored as an absolute URL rather than an
 * object key (an import, per `assignmentFileRef`) is dropped: there is no R2
 * object behind it to put in the archive, and a zero-byte placeholder would
 * be worse than its absence.
 */
export function buildZipEntries(input: BuildZipEntriesInput): ZipEntry[] {
  const exportable: { speakerId: string; filename: string; key: string }[] = [];
  for (const deliverable of input.deliverables) {
    const key = deliverable.current.key;
    if (key === null) continue;
    exportable.push({
      speakerId: deliverable.speakerId,
      filename: deliverable.current.filename,
      key,
    });
  }

  const folders = assignSpeakerFolders(
    exportable.map((file) => ({
      id: file.speakerId,
      label: input.speakerLabelById.get(file.speakerId) ?? "",
    })),
  );

  const takenByFolder = new Map<string, Set<string>>();
  const entries: ZipEntry[] = [];
  for (const file of exportable) {
    const folder = folders.get(file.speakerId) ?? UNKNOWN_SPEAKER_FOLDER;
    let taken = takenByFolder.get(folder);
    if (!taken) {
      taken = new Set<string>();
      takenByFolder.set(folder, taken);
    }
    entries.push({
      path: `${folder}/${claimFilename(taken, sanitizeFilename(file.filename))}`,
      key: file.key,
    });
  }
  return entries;
}

/**
 * Extensions whose bytes are already compressed. Re-deflating a JPEG or a PDF
 * buys nothing and spends the Worker's CPU budget, which is the binding
 * constraint on an archive of a whole event's uploads -- those are stored
 * as-is and only text-ish files are deflated.
 */
const ALREADY_COMPRESSED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".pdf",
  ".pptx",
  ".docx",
  ".zip",
]);

/** Whether this entry should be stored rather than deflated. */
export function storeWithoutCompression(filename: string): boolean {
  return ALREADY_COMPRESSED_EXTENSIONS.has(extensionOf(filename).toLowerCase());
}

/** What the browser saves the archive as. */
export function zipArchiveFilename(eventSlug: string): string {
  return `${sanitizeSegment(eventSlug, "event")}-files.zip`;
}

/** Shown where the export is offered and returned by the handler when there
 * is nothing to archive -- the same sentence in both places, so a disabled
 * button and a bookmarked URL tell the organizer the same thing. */
export const NO_FILES_MESSAGE = "No files have been uploaded for this event yet.";
