import { Zip, ZipDeflate, ZipPassThrough } from "fflate/browser";
import {
  buildZipEntries,
  storeWithoutCompression,
  zipArchiveFilename,
  NO_FILES_MESSAGE,
  type ZipEntry,
} from "@/domain/file-export";
import { getFilesBucket, getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import { loadFileLibrary, speakerLabels } from "../data";

/**
 * "Download all": every current deliverable for the event as one ZIP, one
 * folder per speaker (decisions.md D-073).
 *
 * Organizer-only, guarded before anything is read, the same way the round
 * results CSV is: an archive of a whole event's uploads is not the individual
 * capability URL that /files/[...key] serves (which is deliberately open
 * because headshots render on public pages) -- it is an enumeration of every
 * file the event holds, so it takes the guard of the page that offers it.
 *
 * `requireEventAdmin` is that page's guard exactly, and a route handler is as
 * much of a door as a page: a reviewer or a signed-out visitor is redirected
 * rather than handed the bytes.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventSlug: string }> },
): Promise<Response> {
  const { eventSlug } = await params;
  const { event } = await requireEventAdmin(eventSlug, `/admin/${eventSlug}/files`);

  const repos = await getRepos();
  const library = await loadFileLibrary(repos, event.id);
  const entries = buildZipEntries({
    deliverables: library.deliverables,
    speakerLabelById: speakerLabels(library.peopleById),
  });

  // An honest empty state: an event with nothing uploaded gets the reason,
  // not a valid ZIP holding nothing. The button on the page is disabled in
  // the same case; this covers the bookmarked URL.
  if (entries.length === 0) {
    return new Response(NO_FILES_MESSAGE, {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const bucket = await getFilesBucket();
  return new Response(zipStream(entries, bucket), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${zipArchiveFilename(eventSlug)}"`,
      // The archive is assembled from live rows; nothing about it is stable
      // enough to sit in a cache.
      "cache-control": "no-store",
    },
  });
}

/**
 * The archive as a response body, assembled one object at a time.
 *
 * Nothing larger than a single R2 read is ever held: files are added to the
 * `Zip` strictly in sequence, and fflate flushes the chunks of whichever file
 * is currently first in line straight to `ondata` (a file added while another
 * is still streaming would instead be buffered until its turn -- which is
 * exactly what this loop avoids). The 10MB per-file upload cap therefore
 * bounds the working set, not the total size of the export.
 *
 * Backpressure is real rather than decorative: the pump waits whenever the
 * stream's queue is full and resumes on `pull`, so a slow client throttles
 * the R2 reads instead of filling the Worker's memory with an archive nobody
 * is collecting yet.
 */
function zipStream(entries: ZipEntry[], bucket: R2Bucket): ReadableStream<Uint8Array> {
  let resume: (() => void) | null = null;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const drained = () => {
        if ((controller.desiredSize ?? 1) > 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
          resume = resolve;
        });
      };
      void pump(controller, entries, bucket, drained, () => cancelled).catch((error: unknown) => {
        if (!cancelled) controller.error(error);
      });
    },
    pull() {
      const waiting = resume;
      resume = null;
      waiting?.();
    },
    cancel() {
      cancelled = true;
      const waiting = resume;
      resume = null;
      waiting?.();
    },
  });
}

async function pump(
  controller: ReadableStreamDefaultController<Uint8Array>,
  entries: ZipEntry[],
  bucket: R2Bucket,
  drained: () => Promise<void>,
  isCancelled: () => boolean,
): Promise<void> {
  const zip = new Zip();
  zip.ondata = (error, chunk, final) => {
    if (error) {
      controller.error(error);
      return;
    }
    if (chunk.length > 0) controller.enqueue(chunk);
    if (final) controller.close();
  };

  for (const entry of entries) {
    if (isCancelled()) return;
    const object = await bucket.get(entry.key);
    // A row whose object is gone (deleted out from under the database) costs
    // the organizer one file, not the whole archive.
    if (!object) continue;

    const file = storeWithoutCompression(entry.path)
      ? new ZipPassThrough(entry.path)
      : new ZipDeflate(entry.path);
    zip.add(file);

    const reader = object.body.getReader();
    // fflate needs to know which chunk is the last one, and a reader only
    // says so on the read *after* it, so each chunk is held back by one turn.
    let held: Uint8Array | null = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (held) {
          file.push(held, false);
          await drained();
          if (isCancelled()) return;
        }
        held = value;
      }
    } finally {
      reader.releaseLock();
    }
    file.push(held ?? new Uint8Array(0), true);
    await drained();
  }

  if (isCancelled()) return;
  zip.end();
}
