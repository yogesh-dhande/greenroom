/**
 * Deliverables: what a speaker has uploaded, in what order, and what people
 * have said about it (spec.md §6, decisions.md D-054).
 *
 * Pure logic in the same shape as src/domain/onboarding.ts — entity values in,
 * plain values out — so the speaker's portal task card and the organizer's
 * Files library agree on which upload is current, which are superseded, and
 * how a thread reads, without either page owning the rules.
 */
import type { FileComment, FileVersion, Form, TaskAssignment } from "@/db/entities";
import type { AssignmentView } from "@/domain/onboarding";
import { fileUrl, filenameFromKey, keyFromFileUrl, type UploadKind } from "@/lib/uploads";

/** One uploaded file, wherever it was read from. */
export interface FileRef {
  /** Stored object key; null for a file saved as an absolute URL. */
  key: string | null;
  url: string;
  filename: string;
  uploadedAt: Date;
  /** Null for an upload that predates the versions table. */
  uploadedBy: string | null;
}

export interface FileHistory {
  /** The file the assignment currently stands on, null if nothing is in yet. */
  current: FileRef | null;
  /** Superseded uploads, newest first. */
  older: FileRef[];
  versionCount: number;
}

function versionRef(version: FileVersion): FileRef {
  return {
    key: version.fileKey,
    url: version.url,
    filename: version.filename,
    uploadedAt: version.createdAt,
    uploadedBy: version.uploadedBy,
  };
}

/** The file an assignment holds directly, named from its key where it has
 * one (an absolute URL from an import falls back to its last segment). */
export function assignmentFileRef(
  assignment: Pick<TaskAssignment, "fileUrl" | "completedAt" | "updatedAt">,
): FileRef | null {
  if (!assignment.fileUrl) return null;
  const key = keyFromFileUrl(assignment.fileUrl);
  return {
    key,
    url: assignment.fileUrl,
    filename: key ? filenameFromKey(key) : (assignment.fileUrl.split("/").pop() || "File"),
    uploadedAt: assignment.completedAt ?? assignment.updatedAt,
    uploadedBy: null,
  };
}

/**
 * Newest upload first. Ties are broken by id so the same list never reorders
 * between renders — `createdAt` has second resolution, so two uploads a
 * moment apart can share one timestamp.
 */
export function sortVersionsNewestFirst(versions: FileVersion[]): FileVersion[] {
  return [...versions].sort((a, b) => {
    const byTime = b.createdAt.getTime() - a.createdAt.getTime();
    return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
  });
}

/**
 * Put the version named by the owning record first, then keep the remaining
 * history newest-first. `createdAt` has only second resolution, while the
 * assignment/profile URL is updated to the exact successful upload, so that
 * pointer is the authoritative answer when two versions share a timestamp.
 */
function versionsWithCurrentFirst(
  versions: FileVersion[],
  currentUrl: string | null | undefined,
): FileVersion[] {
  const ordered = sortVersionsNewestFirst(versions);
  if (!currentUrl) return ordered;
  const currentIndex = ordered.findIndex((version) => version.url === currentUrl);
  if (currentIndex <= 0) return ordered;
  return [ordered[currentIndex], ...ordered.slice(0, currentIndex), ...ordered.slice(currentIndex + 1)];
}

/**
 * The current file and everything it replaced.
 *
 * An assignment completed before the versions table existed has no rows, and
 * nothing backfills them (D-054): its own `fileUrl` is version 1 until the
 * next upload arrives, which records both.
 */
export function buildFileHistory(
  assignment: Pick<TaskAssignment, "fileUrl" | "completedAt" | "updatedAt">,
  versions: FileVersion[],
): FileHistory {
  if (versions.length === 0) {
    const current = assignmentFileRef(assignment);
    return { current, older: [], versionCount: current ? 1 : 0 };
  }

  const [newest, ...older] = versionsWithCurrentFirst(versions, assignment.fileUrl);
  return {
    current: versionRef(newest),
    older: older.map(versionRef),
    versionCount: versions.length,
  };
}

/** One file in the organizer's library, and the history behind it. */
export interface Deliverable {
  /** Stable public-to-the-admin identifier used by the selectable ZIP form.
   * It contains domain ids only, never an R2 object key. */
  selectionId: string;
  /**
   * The assignment this file answered, or null for a `profile` file — a
   * headshot belongs to the speaker, not to a task. Everything keyed off an
   * assignment (comment threads, above all) is unavailable for those.
   */
  assignmentId: string | null;
  taskId: string | null;
  taskTitle: string;
  speakerId: string;
  /** What to call this file in a list: the task, plus the question when the
   * file came from a form answer. */
  label: string;
  current: FileRef;
  older: FileRef[];
  versionCount: number;
  /**
   * A file answered inside a `form` task. Comments still hang off the
   * assignment, but the answer is replaced by re-submitting the form, so it
   * carries no version list of its own.
   */
  fromFormAnswer: boolean;
  /** Where the file came from — an onboarding task, or the speaker's own
   * profile (spec.md §6: headshots are library files too). */
  source: "assignment" | "profile";
}

/** How a tracked profile file is named in the library and on a speaker's
 * record. Only headshots are stored this way today, and the suffix says
 * which surface the file came from rather than which task. */
export const PROFILE_FILE_LABEL = "Headshot — profile";

export interface CollectDeliverablesInput {
  views: AssignmentView[];
  /** Forms behind `form` tasks, for the labels of their file questions. */
  formsById: Map<string, Form>;
  versionsByAssignment: Map<string, FileVersion[]>;
  /**
   * Profile-scoped versions by the speaker they belong to (`ownerUserId`),
   * newest or not — this sorts them itself. Absent on surfaces that only
   * report on tasks.
   */
  profileVersionsBySpeaker?: Map<string, FileVersion[]>;
  /** The profile's own current headshot pointer, used to break same-second
   * version ties just as an assignment's `fileUrl` does. */
  profileCurrentUrlBySpeaker?: Map<string, string | null>;
}

/**
 * Every file an assignment set holds, from both places a task can store one:
 * a `file_request` assignment keeps the served URL on the assignment itself,
 * while a `form` task's answers hold raw object keys under the form's file
 * fields (spec.md §6).
 *
 * Profile files come in alongside them when the caller supplies them: a
 * headshot is a deliverable the organizer chased for just like a deck, so it
 * belongs in the same list rather than only on the speaker's avatar.
 *
 * Newest upload first, so the library opens on what just came in.
 */
export function collectDeliverables(input: CollectDeliverablesInput): Deliverable[] {
  const deliverables: Deliverable[] = [];

  for (const [speakerId, versions] of input.profileVersionsBySpeaker ?? []) {
    if (versions.length === 0) continue;
    const [newest, ...older] = versionsWithCurrentFirst(
      versions,
      input.profileCurrentUrlBySpeaker?.get(speakerId),
    );
    deliverables.push({
      selectionId: `profile:${speakerId}`,
      assignmentId: null,
      taskId: null,
      taskTitle: PROFILE_FILE_LABEL,
      speakerId,
      label: PROFILE_FILE_LABEL,
      current: versionRef(newest),
      older: older.map(versionRef),
      versionCount: versions.length,
      fromFormAnswer: false,
      source: "profile",
    });
  }

  for (const { assignment, task } of input.views) {
    const history = buildFileHistory(
      assignment,
      input.versionsByAssignment.get(assignment.id) ?? [],
    );
    if (history.current) {
      deliverables.push({
        selectionId: `assignment:${assignment.id}:file`,
        assignmentId: assignment.id,
        taskId: task.id,
        taskTitle: task.title,
        speakerId: assignment.speakerId,
        label: task.title,
        current: history.current,
        older: history.older,
        versionCount: history.versionCount,
        fromFormAnswer: false,
        source: "assignment",
      });
    }

    const form = task.formId ? input.formsById.get(task.formId) : undefined;
    if (!form || !assignment.responseJson) continue;
    for (const field of form.fields) {
      if (field.type !== "file") continue;
      const value = assignment.responseJson[field.id];
      if (typeof value !== "string" || value === "") continue;
      deliverables.push({
        selectionId: `assignment:${assignment.id}:field:${field.id}`,
        assignmentId: assignment.id,
        taskId: task.id,
        taskTitle: task.title,
        speakerId: assignment.speakerId,
        label: `${task.title} — ${field.label}`,
        current: {
          key: value,
          url: fileUrl(value),
          filename: filenameFromKey(value),
          uploadedAt: assignment.completedAt ?? assignment.updatedAt,
          uploadedBy: assignment.speakerId,
        },
        older: [],
        versionCount: 1,
        fromFormAnswer: true,
        source: "assignment",
      });
    }
  }

  return deliverables.sort(
    (a, b) => b.current.uploadedAt.getTime() - a.current.uploadedAt.getTime(),
  );
}

/** Long enough for a paragraph of feedback, short enough that the thread
 * stays a thread. Enforced in the box and again in the server action. */
export const MAX_COMMENT_LENGTH = 2000;

/**
 * "May 1, 2026, 3:04 PM PDT" — uploads and comments are instants, so they are
 * stamped in the event's zone (the frame every other date on the event uses)
 * rather than whatever zone the reader's machine is set to.
 */
export function formatFileMoment(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

export interface CommentView {
  id: string;
  authorName: string;
  body: string;
  createdAt: Date;
}

/**
 * A thread in reading order — oldest first, newest last, the way a
 * conversation is read rather than the way a feed is scanned.
 *
 * An author who has left (or was never resolved) is shown as "Unknown" rather
 * than dropped: a comment without a name is still evidence of what was said.
 */
export function buildCommentThread(
  comments: FileComment[],
  authorsById: Map<string, { name: string | null; email: string }>,
): CommentView[] {
  return [...comments]
    .sort((a, b) => {
      const byTime = a.createdAt.getTime() - b.createdAt.getTime();
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    })
    .map((comment) => {
      const author = authorsById.get(comment.authorId);
      return {
        id: comment.id,
        authorName: author?.name || author?.email || "Unknown",
        body: comment.body,
        createdAt: comment.createdAt,
      };
    });
}

/** Groups rows by the assignment they belong to, for pages that load a whole
 * event's worth in one query. Rows with no assignment (a profile-scoped file
 * version) are skipped rather than bucketed under a placeholder key. */
export function groupByAssignment<T extends { assignmentId: string | null }>(
  rows: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    if (row.assignmentId === null) continue;
    const list = grouped.get(row.assignmentId);
    if (list) list.push(row);
    else grouped.set(row.assignmentId, [row]);
  }
  return grouped;
}

/** The mirror of `groupByAssignment` for profile-scoped versions: keyed by
 * the speaker the file belongs to, skipping any row that carries no owner. */
export function groupProfileVersionsBySpeaker(versions: FileVersion[]): Map<string, FileVersion[]> {
  const grouped = new Map<string, FileVersion[]>();
  for (const version of versions) {
    if (version.scope !== "profile" || !version.ownerUserId) continue;
    const list = grouped.get(version.ownerUserId);
    if (list) list.push(version);
    else grouped.set(version.ownerUserId, [version]);
  }
  return grouped;
}

const IMAGE_WORDS =
  /\b(headshot|headshots|portrait|portraits|photo|photos|photograph|picture|pictures|image|images|avatar)\b/;
const SLIDES_WORDS = /\b(slide|slides|deck|decks|presentation|keynote|powerpoint)\b/;
const DOCUMENT_WORDS =
  /\b(pdf|document|documents|contract|agreement|waiver|release|invoice|w-9)\b/;

/**
 * What kind of file a request is asking for, read off its own wording
 * (decisions.md D-054 — accepted file types).
 *
 * Tasks carry no accepted-types column, and adding the picker that would fill
 * one belongs to the task editor, so this infers the constraint from the
 * title and instructions an organizer already wrote. Because it is a guess,
 * it narrows the file picker and states the rule next to the control — it is
 * never used to reject a file the server has already stored.
 *
 * Mixed signals ("slides and a headshot") stay `any`: a wrong narrow filter
 * hides the file the speaker meant to send.
 */
export function inferUploadKind(task: { title: string; instructions: string | null }): UploadKind {
  const text = `${task.title} ${task.instructions ?? ""}`.toLowerCase();
  const image = IMAGE_WORDS.test(text);
  const slides = SLIDES_WORDS.test(text);
  const document = DOCUMENT_WORDS.test(text);

  if (image && !slides && !document) return "image";
  if (slides && !image) return "slides";
  if (document && !image && !slides) return "document";
  return "any";
}
