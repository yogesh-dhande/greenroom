"use server";

import { getFilesBucket } from "@/lib/db";
import { checkUpload, isServableKey, uploadKey, uploadProblemMessage } from "@/lib/uploads";
import type { UploadResult } from "@/components/schema-form/types";

/**
 * Puts a picked file in R2 and hands back its key (spec.md §2 — headshots and
 * supporting documents).
 *
 * Shared by the public CFP page and the speaker portal's edit view, which is
 * why it lives here rather than in either route's actions file.
 *
 * Deliberately unauthenticated: the public CFP page has no login, so the only
 * gate is what `checkUpload` allows (size + content type), enforced here as
 * well as in the browser. The generated key carries a random segment, so the
 * URL that serves it back is an unguessable capability.
 */
export async function uploadFormFile(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  const scope = formData.get("scope");
  if (!(file instanceof File)) return { ok: false, error: "No file was received." };

  const problem = checkUpload(file);
  if (problem) return { ok: false, error: uploadProblemMessage(problem) };

  const key = uploadKey(typeof scope === "string" ? scope : "misc", file.name);
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
