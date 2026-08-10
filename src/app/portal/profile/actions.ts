"use server";

import { revalidatePath } from "next/cache";
import { parseProfileInput } from "@/domain/profile";
import type { FormValues } from "@/domain/forms";
import { getFilesBucket, getRepos } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import {
  checkUpload,
  filenameFromKey,
  fileUrl,
  isImageUploadType,
  isServableKey,
  keyFromFileUrl,
  uploadKey,
  uploadProblemMessage,
  UPLOAD_PREFIX,
} from "@/lib/uploads";
import type { Repos } from "@/db/repos";
import type { SchemaFormResult, UploadResult } from "@/components/schema-form/types";

/** Namespaces headshot object keys in R2, away from CFP/task uploads. */
const HEADSHOT_SCOPE = "profile";

/**
 * Refreshes every surface that renders this speaker (spec.md §6 — profile
 * edits "feed the admin roster and public gallery").
 *
 * Path-based invalidation, matching every other write action in the app: the
 * public program pages hold no cache tags today — `src/app/p/[eventSlug]/
 * data.ts` uses React `cache()`, which is per-request memoization only — so
 * there is nothing tag-shaped to revalidate. If D-010's tag-based ISR is
 * wired up later, this is the one place a profile edit has to learn about it.
 *
 * Which surfaces those are depends on where the speaker is actually
 * programmed, so the events are discovered from their sessions rather than
 * guessed: a gallery card and a schedule byline only exist for an event the
 * speaker has a session on, and the admin roster for that same event is where
 * an organizer reads their title/company/bio back.
 */
async function revalidateSpeakerSurfaces(repos: Repos, userId: string): Promise<void> {
  revalidatePath("/portal");
  revalidatePath("/portal/profile");

  const sessions = await repos.sessions.listBySpeaker(userId);
  const eventIds = [...new Set(sessions.map((session) => session.eventId))];
  const events = await Promise.all(eventIds.map((eventId) => repos.events.getById(eventId)));

  for (const event of events) {
    if (!event) continue;
    // Gallery cards carry name/title/company/bio/headshot/links; schedule
    // bylines carry the name — both go stale on a profile edit.
    revalidatePath(`/p/${event.slug}/speakers`);
    revalidatePath(`/p/${event.slug}/schedule`);
    revalidatePath(`/embed/${event.slug}/speakers`);
    revalidatePath(`/embed/${event.slug}/schedule`);
    revalidatePath(`/admin/${event.slug}/speakers`);
    // The speaker's own record renders their uploads, and the Files library
    // now carries their headshot too.
    revalidatePath(`/admin/${event.slug}/speakers/${userId}`);
    revalidatePath(`/admin/${event.slug}/files`);
  }
}

/**
 * Saves the signed-in speaker's own profile (spec.md §6).
 *
 * The user id is never taken from the client — it comes from the session on
 * every call — so the only profile this action can ever write is the caller's
 * own. Everything else is re-validated here regardless of what the browser
 * already checked (src/domain/profile.ts).
 */
export async function saveProfile(values: FormValues): Promise<SchemaFormResult> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return { ok: false, error: "Please sign in again to save your profile." };

  const repos = await getRepos();
  const user = await repos.users.getById(sessionUser.id);
  if (!user) return { ok: false, error: "We couldn't find your account — try signing in again." };

  const parsed = parseProfileInput(values, { headshotUrl: user.headshotUrl });
  if (!parsed.ok) {
    return {
      ok: false,
      error: "A couple of details need another look.",
      fieldErrors: parsed.errors,
    };
  }

  // Backstop for the image-only rule enforced at upload time: a *newly*
  // supplied key has to be one `uploadHeadshot` minted, so a key harvested
  // from somewhere else (a CFP slide deck, say) can't be pasted in as a
  // headshot. An unchanged value is always fine — a headshot that arrived
  // with the speaker's CFP submission lives under that form's scope.
  const { headshotUrl } = parsed.patch;
  const newKey = headshotUrl === user.headshotUrl ? null : keyFromFileUrl(headshotUrl ?? "");
  if (newKey && !newKey.startsWith(`${UPLOAD_PREFIX}/${HEADSHOT_SCOPE}/`)) {
    return { ok: false, error: "That headshot didn't upload properly — pick the image again." };
  }

  await repos.users.update(user.id, parsed.patch);

  // Track the headshot as a file, not just as an avatar URL (spec.md §6 — the
  // Files library covers "decks, headshots, paperwork"). Recorded here rather
  // than in `uploadHeadshot` so a picked-then-abandoned image never becomes a
  // row: only a headshot the speaker actually saved is a file they sent in.
  // `users.headshot_url` is untouched by this and stays what renders the
  // avatar; this row is the filename/uploader/timestamp beside it.
  if (newKey) {
    await repos.fileVersions.create({
      scope: "profile",
      ownerUserId: user.id,
      fileKey: newKey,
      url: fileUrl(newKey),
      filename: filenameFromKey(newKey),
      uploadedBy: user.id,
    });
  }

  await revalidateSpeakerSurfaces(repos, user.id);

  return { ok: true, message: "Profile saved." };
}

/**
 * Puts a picked headshot in R2 and hands back its key.
 *
 * Deliberately *not* the shared `uploadFormFile` (src/app/upload-actions.ts):
 * that one is unauthenticated by design for the public CFP page and accepts
 * documents as well as images. A headshot is uploaded by a signed-in speaker
 * and has to be something the gallery can render as an `<img>`, and both of
 * those are enforced here, on the server, rather than only in the picker.
 */
export async function uploadHeadshot(formData: FormData): Promise<UploadResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again to upload a headshot." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was received." };

  const problem = checkUpload(file);
  if (problem) return { ok: false, error: uploadProblemMessage(problem) };
  if (!isImageUploadType(file.type)) {
    return { ok: false, error: "A headshot has to be an image — JPEG, PNG, WebP, GIF, or AVIF." };
  }

  const key = uploadKey(HEADSHOT_SCOPE, file.name);
  if (!isServableKey(key)) return { ok: false, error: "That filename can't be stored." };

  const bucket = await getFilesBucket();
  await bucket.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type,
      contentDisposition: `inline; filename="${file.name.replace(/"/g, "")}"`,
    },
  });

  return { ok: true, key, filename: file.name };
}
