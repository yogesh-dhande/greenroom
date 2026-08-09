/**
 * Multi-round scored evaluations (spec.md "Important", decisions.md D-031).
 *
 * Pure TypeScript — no datastore imports. Callers fetch rounds, assignments,
 * and scorecards through src/db/repos/* and pass plain entities in.
 *
 * A **round** is a named window with its own scorecard. A **assignment** is one
 * reviewer's job on one submission in one round; it is also the only thing that
 * lets that reviewer see the submission in the round, which is why the queue
 * helpers here take assignments rather than submissions.
 *
 * ## How the aggregate score is calculated
 *
 * 1. Each **numeric** criterion's raw rating is expressed as a share of its own
 *    scale: `(value − min) / (max − min) × 100`. Normalising is what makes a
 *    round scored 1–5 and a round scored 1–10 comparable in the same column,
 *    and it means changing a scale doesn't silently re-rank the field.
 * 2. One reviewer's scorecard score is the **weighted mean** of those
 *    percentages, using each criterion's `weight` (default 1). Weight 2 on
 *    Originality really does count double.
 * 3. A submission's aggregate is the **plain mean** of the scorecard scores
 *    actually submitted for it — every reviewer counts once, however many
 *    criteria they filled in.
 *
 * Dropdown and free-text criteria are recorded and shown but never scored:
 * "Accept / Maybe / Decline" is a judgement, not a measurement, and mapping it
 * onto numbers would invent precision nobody entered.
 */
import type {
  ReviewRound,
  RoundAssignment,
  RoundScore,
  ScorecardCriterion,
} from "@/db/entities";

// ---------------------------------------------------------------------------
// Round windows
// ---------------------------------------------------------------------------

export type RoundState = "upcoming" | "open" | "closed";

/** Where a round sits relative to now; null dates mean "no boundary". */
export function roundState(
  round: Pick<ReviewRound, "opensAt" | "closesAt">,
  now: Date = new Date(),
): RoundState {
  if (round.opensAt && now < round.opensAt) return "upcoming";
  if (round.closesAt && now > round.closesAt) return "closed";
  return "open";
}

/** Whether reviewers may record scores in this round right now. */
export function isRoundOpen(
  round: Pick<ReviewRound, "opensAt" | "closesAt">,
  now: Date = new Date(),
): boolean {
  return roundState(round, now) === "open";
}

export const ROUND_STATE_LABEL: Record<RoundState, string> = {
  upcoming: "Not open yet",
  open: "Open",
  closed: "Closed",
};

// ---------------------------------------------------------------------------
// Scorecard criteria
// ---------------------------------------------------------------------------

/** The scale a numeric criterion is rated on, with sane fallbacks. */
export function criterionRange(criterion: ScorecardCriterion): { min: number; max: number } {
  const min = Number.isFinite(criterion.min) ? (criterion.min as number) : 1;
  const rawMax = Number.isFinite(criterion.max) ? (criterion.max as number) : 5;
  // A zero-width scale would make every rating either 0% or undefined, so it
  // is widened by one point rather than rejected — an organizer mid-edit
  // shouldn't be able to produce a scorecard that crashes the results table.
  return { min, max: rawMax > min ? rawMax : min + 1 };
}

/** A criterion's pull on the aggregate. Non-numeric criteria never count. */
export function criterionWeight(criterion: ScorecardCriterion): number {
  if (criterion.type !== "number") return 0;
  const weight = Number.isFinite(criterion.weight) ? (criterion.weight as number) : 1;
  return weight > 0 ? weight : 0;
}

export function numericCriteria(criteria: ScorecardCriterion[]): ScorecardCriterion[] {
  return criteria.filter((criterion) => criterion.type === "number");
}

/** Reads a stored answer as a number, tolerating the strings a form posts. */
export function readNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** One rating as a 0–100 share of its own scale (step 1 above). */
export function normalizedValue(criterion: ScorecardCriterion, raw: unknown): number | null {
  if (criterion.type !== "number") return null;
  const value = readNumber(raw);
  if (value === null) return null;
  const { min, max } = criterionRange(criterion);
  const clamped = Math.min(Math.max(value, min), max);
  return ((clamped - min) / (max - min)) * 100;
}

/** One reviewer's scorecard as a single 0–100 number (step 2 above). */
export function scorecardScore(
  criteria: ScorecardCriterion[],
  values: Record<string, unknown>,
): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const criterion of criteria) {
    const weight = criterionWeight(criterion);
    if (weight === 0) continue;
    const percent = normalizedValue(criterion, values[criterion.id]);
    if (percent === null) continue;
    weighted += percent * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? null : weighted / totalWeight;
}

/** Rounds a score for display without pretending to precision nobody entered. */
export function roundScoreValue(value: number | null, decimals = 1): number | null {
  if (value === null) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * A criterion id derived from its label, unique within the scorecard. Ids are
 * the keys answers are stored under, so they're generated once and kept.
 */
export function criterionIdFromLabel(label: string, taken: string[] = []): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "criterion";
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

/** One row as the scorecard builder hands it over, before it's stored. */
export interface CriterionDraft {
  id?: string;
  label: string;
  type: ScorecardCriterion["type"];
  helpText?: string;
  min?: number;
  max?: number;
  options?: string[];
  weight?: number;
}

/**
 * Turns builder rows into a stored scorecard: a stable id per criterion, and
 * only the settings the criterion's own type uses (a dropdown has no scale, a
 * free-text note has no weight). Unlabelled rows are dropped — a half-typed row
 * the organizer abandoned is not a question.
 */
export function normalizeCriteria(drafts: CriterionDraft[]): ScorecardCriterion[] {
  const taken: string[] = [];
  const criteria: ScorecardCriterion[] = [];

  for (const draft of drafts) {
    const label = draft.label.trim();
    if (!label) continue;

    const existing = draft.id?.trim();
    const id = existing && !taken.includes(existing) ? existing : criterionIdFromLabel(label, taken);
    taken.push(id);

    const criterion: ScorecardCriterion = { id, label, type: draft.type };
    const helpText = draft.helpText?.trim();
    if (helpText) criterion.helpText = helpText;

    if (draft.type === "number") {
      const min = Number.isFinite(draft.min) ? (draft.min as number) : 1;
      const max = Number.isFinite(draft.max) && (draft.max as number) > min ? (draft.max as number) : min + 4;
      const weight = Number.isFinite(draft.weight) && (draft.weight as number) > 0
        ? (draft.weight as number)
        : 1;
      criterion.min = min;
      criterion.max = max;
      criterion.weight = weight;
    }

    if (draft.type === "select") {
      criterion.options = (draft.options ?? []).map((option) => option.trim()).filter(Boolean);
    }

    criteria.push(criterion);
  }

  return criteria;
}

/**
 * The first thing wrong with a submitted scorecard, or null when it's complete.
 * Ratings and dropdowns must be answered — they are what the round is for.
 * Free-text criteria stay optional: a reviewer with nothing to add shouldn't be
 * blocked from filing their scores.
 */
export function validateScorecard(
  criteria: ScorecardCriterion[],
  values: Record<string, unknown>,
): string | null {
  for (const criterion of criteria) {
    const raw = values[criterion.id];
    if (criterion.type === "number") {
      const value = readNumber(raw);
      if (value === null) return `Give ${criterion.label} a rating`;
      const { min, max } = criterionRange(criterion);
      if (value < min || value > max) {
        return `${criterion.label} must be between ${min} and ${max}`;
      }
    }
    if (criterion.type === "select") {
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value) return `Choose an option for ${criterion.label}`;
      if ((criterion.options ?? []).length > 0 && !(criterion.options ?? []).includes(value)) {
        return `"${value}" isn't one of the choices for ${criterion.label}`;
      }
    }
  }
  return null;
}

/** Keeps only the answers the scorecard actually asks for. */
export function pickScorecardValues(
  criteria: ScorecardCriterion[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const criterion of criteria) {
    const raw = values[criterion.id];
    if (raw === undefined) continue;
    clean[criterion.id] =
      criterion.type === "number" ? readNumber(raw) : typeof raw === "string" ? raw.trim() : raw;
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Reviewer queues & scoping
// ---------------------------------------------------------------------------

/**
 * A reviewer's work in one round: exactly the submissions assigned to them,
 * and nothing else. Recused items stay on the list (marked) so the reviewer can
 * see what they stepped back from — they just stop counting as work owed.
 */
export function assignmentsForReviewer(
  assignments: RoundAssignment[],
  roundId: string,
  reviewerId: string,
): RoundAssignment[] {
  return assignments.filter(
    (assignment) => assignment.roundId === roundId && assignment.reviewerId === reviewerId,
  );
}

/** The rounds this person has any work in — their view of the review plan. */
export function roundIdsForReviewer(assignments: RoundAssignment[]): string[] {
  return [...new Set(assignments.map((assignment) => assignment.roundId))];
}

/**
 * Server-side gate for opening one submission's scorecard. Membership of the
 * round is not enough and neither is a track: only the assignment itself
 * authorises the reviewer.
 */
export function canScoreSubmission(
  assignments: RoundAssignment[],
  roundId: string,
  reviewerId: string,
  submissionId: string,
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.roundId === roundId &&
      assignment.reviewerId === reviewerId &&
      assignment.submissionId === submissionId,
  );
}

// ---------------------------------------------------------------------------
// Progress (per reviewer) — spec.md: review-progress visibility
// ---------------------------------------------------------------------------

export interface ReviewerProgress {
  reviewerId: string;
  /** Every submission handed to them, recusals included. */
  assigned: number;
  /** What they still owe: assigned minus recusals. */
  required: number;
  /** Scorecards actually on file. */
  done: number;
  recused: number;
  pending: number;
}

/**
 * Per-reviewer completion for one round. `done` counts submitted scorecards
 * rather than the assignment's status flag, so the number on screen is the
 * number of scorecards that exist.
 */
export function progressByReviewer(
  assignments: Array<Pick<RoundAssignment, "id" | "reviewerId" | "status">>,
  scoredAssignmentIds: ReadonlySet<string>,
): ReviewerProgress[] {
  const byReviewer = new Map<string, ReviewerProgress>();
  for (const assignment of assignments) {
    const progress = byReviewer.get(assignment.reviewerId) ?? {
      reviewerId: assignment.reviewerId,
      assigned: 0,
      required: 0,
      done: 0,
      recused: 0,
      pending: 0,
    };
    progress.assigned += 1;
    if (assignment.status === "recused") {
      progress.recused += 1;
    } else {
      progress.required += 1;
      if (scoredAssignmentIds.has(assignment.id)) progress.done += 1;
    }
    byReviewer.set(assignment.reviewerId, progress);
  }
  for (const progress of byReviewer.values()) {
    progress.pending = progress.required - progress.done;
  }
  return [...byReviewer.values()];
}

/** "1 of 2 scored" — the same sentence everywhere progress is shown. */
export function progressLabel(progress: Pick<ReviewerProgress, "done" | "required">): string {
  return `${progress.done} of ${progress.required} scored`;
}

// ---------------------------------------------------------------------------
// Results (per submission)
// ---------------------------------------------------------------------------

export interface SubmissionRoundSummary {
  submissionId: string;
  assigned: number;
  required: number;
  scored: number;
  recused: number;
  /** Weighted, normalized aggregate on 0–100, or null before anyone scores. */
  score: number | null;
  /** Mean of the raw ratings per numeric criterion, keyed by criterion id. */
  criterionAverages: Record<string, number | null>;
}

/**
 * Every submission in the round with its aggregate (step 3 above). Assignments
 * with no scorecard contribute to the counts and not to the score, so an
 * unfinished round reads as "2 of 5 scored" instead of a misleadingly confident
 * average.
 */
export function summarizeRound(
  criteria: ScorecardCriterion[],
  assignments: RoundAssignment[],
  scores: RoundScore[],
): SubmissionRoundSummary[] {
  const scoreByAssignment = new Map(scores.map((score) => [score.assignmentId, score]));
  const numeric = numericCriteria(criteria);

  const bySubmission = new Map<
    string,
    { summary: SubmissionRoundSummary; totals: number[]; raw: Map<string, number[]> }
  >();

  for (const assignment of assignments) {
    let entry = bySubmission.get(assignment.submissionId);
    if (!entry) {
      entry = {
        summary: {
          submissionId: assignment.submissionId,
          assigned: 0,
          required: 0,
          scored: 0,
          recused: 0,
          score: null,
          criterionAverages: {},
        },
        totals: [],
        raw: new Map(numeric.map((criterion) => [criterion.id, []])),
      };
      bySubmission.set(assignment.submissionId, entry);
    }

    entry.summary.assigned += 1;
    if (assignment.status === "recused") {
      entry.summary.recused += 1;
      continue;
    }
    entry.summary.required += 1;

    const score = scoreByAssignment.get(assignment.id);
    if (!score) continue;
    entry.summary.scored += 1;

    const values = score.values;
    const total = scorecardScore(criteria, values);
    if (total !== null) entry.totals.push(total);
    for (const criterion of numeric) {
      const value = readNumber(values[criterion.id]);
      if (value !== null) entry.raw.get(criterion.id)!.push(value);
    }
  }

  return [...bySubmission.values()].map(({ summary, totals, raw }) => {
    summary.score = roundScoreValue(mean(totals));
    for (const [criterionId, values] of raw) {
      summary.criterionAverages[criterionId] = roundScoreValue(mean(values));
    }
    return summary;
  });
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Rollup onto the submission record (decisions.md D-048)
// ---------------------------------------------------------------------------

/** Where one submission stands in one round, as the submission record shows
 * it: the round's aggregate for it, and how much of the work is filed. */
export interface SubmissionRoundRollup {
  roundId: string;
  roundName: string;
  scored: number;
  required: number;
  /** The round's aggregate for this submission, null before anyone scores. */
  score: number | null;
}

export interface SubmissionReviewRollup {
  /** Every round holding this submission, in the event's round order. */
  rounds: SubmissionRoundRollup[];
  /** Scorecards filed across all of them — the count that keeps a scored
   * submission from reading as "no reviews" on the queue (D-048). */
  scorecards: number;
}

/**
 * Round standings keyed by submission id, for the organizer's submission list
 * and detail page. A submission no round was ever assigned holds no entry, so
 * an absent rollup means "no round has this proposal" rather than "unscored" —
 * the two read very differently to an organizer.
 */
export function rollupRoundsBySubmission(
  rounds: Array<Pick<ReviewRound, "id" | "name" | "criteria">>,
  assignments: RoundAssignment[],
  scores: RoundScore[],
): Record<string, SubmissionReviewRollup> {
  const rollups: Record<string, SubmissionReviewRollup> = {};
  for (const round of rounds) {
    const roundAssignments = assignments.filter(
      (assignment) => assignment.roundId === round.id,
    );
    if (roundAssignments.length === 0) continue;
    for (const summary of summarizeRound(round.criteria, roundAssignments, scores)) {
      const rollup = (rollups[summary.submissionId] ??= { rounds: [], scorecards: 0 });
      rollup.rounds.push({
        roundId: round.id,
        roundName: round.name,
        scored: summary.scored,
        required: summary.required,
        score: summary.score,
      });
      rollup.scorecards += summary.scored;
    }
  }
  return rollups;
}

/** "1 of 2 scorecards" — one round's progress on one submission. */
export function rollupProgressLabel(
  rollup: Pick<SubmissionRoundRollup, "scored" | "required">,
): string {
  return `${rollup.scored} of ${rollup.required} scorecard${rollup.required === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Results table: sorting and CSV export
// ---------------------------------------------------------------------------

export type ResultSortKey = "score" | "title" | "scored";
export type SortDirection = "asc" | "desc";

export interface ResultRow {
  submissionId: string;
  title: string;
  speakers: string[];
  trackNames: string[];
  status: string;
  summary: SubmissionRoundSummary;
}

/**
 * Sorts the results table. Submissions nobody has scored yet always sink to the
 * bottom, in either direction: "no score" is missing information, not a zero,
 * and an organizer sorting ascending is looking for the weakest talk that has
 * actually been reviewed.
 */
export function sortResultRows(
  rows: ResultRow[],
  key: ResultSortKey,
  direction: SortDirection,
): ResultRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "title") return sign * a.title.localeCompare(b.title);
    const left = key === "score" ? a.summary.score : a.summary.scored;
    const right = key === "score" ? b.summary.score : b.summary.scored;
    if (left === null && right === null) return a.title.localeCompare(b.title);
    if (left === null) return 1;
    if (right === null) return -1;
    if (left === right) return a.title.localeCompare(b.title);
    return sign * (left - right);
  });
}

/** RFC-4180 escaping: quote anything containing a comma, quote, or newline. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: Array<string | number | null>): string {
  return cells.map(csvCell).join(",");
}

/** Column headings for the export, in order. */
export function csvHeader(criteria: ScorecardCriterion[]): string[] {
  return [
    "Submission",
    "Speakers",
    "Tracks",
    "Status",
    "Reviewers assigned",
    "Scorecards submitted",
    "Aggregate score",
    ...numericCriteria(criteria).map((criterion) => `${criterion.label} (avg)`),
  ];
}

/**
 * The results table as a CSV document (spec.md: scores exportable). Rows come
 * in the order the caller sorted them, so the file matches what was on screen.
 */
export function roundResultsCsv(criteria: ScorecardCriterion[], rows: ResultRow[]): string {
  const numeric = numericCriteria(criteria);
  const lines = [csvRow(csvHeader(criteria))];
  for (const row of rows) {
    lines.push(
      csvRow([
        row.title,
        row.speakers.join("; "),
        row.trackNames.join("; "),
        row.status,
        row.summary.assigned,
        row.summary.scored,
        row.summary.score,
        ...numeric.map((criterion) => row.summary.criterionAverages[criterion.id] ?? null),
      ]),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** A safe download filename for one round's export. */
export function csvFilename(eventSlug: string, roundName: string): string {
  const slug = roundName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${eventSlug}-${slug || "round"}-scores.csv`;
}
