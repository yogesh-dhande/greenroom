import { csvFilename, roundResultsCsv, sortResultRows } from "@/domain/rounds";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { buildResultRows, loadRound, loadRoundSubmissions, loadRoundWork } from "../../../data";

/**
 * Downloads one round's results as CSV (spec.md: scores exportable — rubric
 * ABS-13). Organizer-only, and guarded before anything is read: scores are not
 * public data, and a route handler is as much of a door as a page.
 *
 * Rows come out highest aggregate first, which is the order the results table
 * opens in — the file matches what the organizer was looking at.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventSlug: string; roundId: string }> },
): Promise<Response> {
  const { eventSlug, roundId } = await params;
  await requireAdmin(`/admin/${eventSlug}/rounds/${roundId}/results`);

  const repos = await getRepos();
  const loaded = await loadRound(repos, eventSlug, roundId);
  if (!loaded) return new Response("Not found", { status: 404 });
  const { event, round } = loaded;

  const [submissions, work] = await Promise.all([
    loadRoundSubmissions(repos, event.id),
    loadRoundWork(repos, roundId),
  ]);
  const rows = sortResultRows(
    buildResultRows(round, submissions, work.assignments, work.scores),
    "score",
    "desc",
  );

  return new Response(roundResultsCsv(round.criteria, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFilename(eventSlug, round.name)}"`,
      "cache-control": "no-store",
    },
  });
}
