import { describe, expect, it } from "vitest";
import { RESERVED_FIELD_IDS } from "@/db/entities";
import type {
  FormField,
  ReviewRound,
  RoundAssignment,
  RoundScore,
  ScorecardCriterion,
} from "@/db/entities";
import {
  BLIND_REVIEW_NOTICE,
  assignmentsForReviewer,
  blindSubmissionIds,
  canScoreSubmission,
  criterionIdFromLabel,
  criterionRange,
  criterionScalePoints,
  criterionWeight,
  csvHeader,
  csvRow,
  hidesSpeakerIdentity,
  isIdentityField,
  isRoundOpen,
  normalizeCriteria,
  normalizedValue,
  pickScorecardValues,
  progressByReviewer,
  progressLabel,
  reviewerVisibleFields,
  rollupProgressLabel,
  rollupRoundsBySubmission,
  roundResultsCsv,
  roundState,
  scorecardAnswers,
  scorecardScore,
  sortResultRows,
  speakerLine,
  summarizeRound,
  validateScorecard,
  viewerHasBlindAssignment,
  withoutSpeakers,
  type ResultRow,
} from "@/domain/rounds";

const EPOCH = new Date(0);

/** The judge's demo scorecard: two weighted ratings, a dropdown, free text. */
const INITIAL_REVIEW: ScorecardCriterion[] = [
  { id: "originality", label: "Originality", type: "number", min: 1, max: 5, weight: 2 },
  { id: "relevance", label: "Relevance", type: "number", min: 1, max: 5, weight: 1 },
  {
    id: "recommendation",
    label: "Recommendation",
    type: "select",
    options: ["Accept", "Maybe", "Decline"],
  },
  { id: "comments", label: "Comments", type: "text" },
];

function round(overrides: Partial<ReviewRound> = {}): ReviewRound {
  return {
    id: "round-1",
    eventId: "evt-1",
    name: "Initial Review",
    description: null,
    opensAt: new Date("2026-08-01T00:00:00Z"),
    closesAt: new Date("2026-10-15T23:59:00Z"),
    criteria: INITIAL_REVIEW,
    blindReview: false,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function assignment(overrides: Partial<RoundAssignment> & { id: string }): RoundAssignment {
  return {
    roundId: "round-1",
    submissionId: "sub-1",
    reviewerId: "rev-1",
    status: "pending",
    recusalReason: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function score(assignmentId: string, values: Record<string, unknown>): RoundScore {
  return {
    id: `score-${assignmentId}`,
    assignmentId,
    values,
    submittedAt: EPOCH,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

// ---------------------------------------------------------------------------

describe("roundState", () => {
  it("is upcoming before the open date, open inside the window, closed after", () => {
    const r = round();
    expect(roundState(r, new Date("2026-07-30T00:00:00Z"))).toBe("upcoming");
    expect(roundState(r, new Date("2026-08-09T00:00:00Z"))).toBe("open");
    expect(roundState(r, new Date("2026-11-01T00:00:00Z"))).toBe("closed");
  });

  it("treats a missing date as no boundary on that side", () => {
    expect(roundState(round({ opensAt: null }), new Date("2020-01-01"))).toBe("open");
    expect(roundState(round({ closesAt: null }), new Date("2099-01-01"))).toBe("open");
    expect(roundState(round({ opensAt: null, closesAt: null }))).toBe("open");
  });

  it("only lets reviewers score while the window is open", () => {
    expect(isRoundOpen(round(), new Date("2026-09-01T00:00:00Z"))).toBe(true);
    // The second round of the demo plan hasn't started yet.
    const final = round({
      opensAt: new Date("2026-10-16T00:00:00Z"),
      closesAt: new Date("2026-11-30T00:00:00Z"),
    });
    expect(isRoundOpen(final, new Date("2026-09-01T00:00:00Z"))).toBe(false);
  });
});

describe("criteria", () => {
  it("defaults a numeric scale to 1–5 and never allows a zero-width range", () => {
    expect(criterionRange({ id: "a", label: "A", type: "number" })).toEqual({ min: 1, max: 5 });
    expect(criterionRange({ id: "a", label: "A", type: "number", min: 3, max: 3 })).toEqual({
      min: 3,
      max: 4,
    });
  });

  it("weights default to 1, and only numeric criteria carry weight at all", () => {
    expect(criterionWeight({ id: "a", label: "A", type: "number" })).toBe(1);
    expect(criterionWeight({ id: "a", label: "A", type: "number", weight: 2 })).toBe(2);
    expect(criterionWeight({ id: "a", label: "A", type: "select", options: ["x"] })).toBe(0);
    expect(criterionWeight({ id: "a", label: "A", type: "text" })).toBe(0);
  });

  it("offers a rating scale as discrete points, defaulting to 1-5", () => {
    expect(criterionScalePoints({ id: "a", label: "A", type: "number" })).toEqual([1, 2, 3, 4, 5]);
    expect(
      criterionScalePoints({ id: "a", label: "A", type: "number", min: 0, max: 3 }),
    ).toEqual([0, 1, 2, 3]);
  });

  it("has no points for a scale a segmented control can't carry", () => {
    // Too many buttons, a fractional scale, and a criterion that isn't rated
    // at all all fall back to whatever control the caller uses instead.
    expect(criterionScalePoints({ id: "a", label: "A", type: "number", min: 1, max: 100 })).toBeNull();
    expect(criterionScalePoints({ id: "a", label: "A", type: "number", min: 0.5, max: 3 })).toBeNull();
    expect(criterionScalePoints({ id: "a", label: "A", type: "text" })).toBeNull();
  });

  it("normalizes a rating to a share of its own scale, clamping out-of-range values", () => {
    const originality = INITIAL_REVIEW[0];
    expect(normalizedValue(originality, 1)).toBe(0);
    expect(normalizedValue(originality, 3)).toBe(50);
    expect(normalizedValue(originality, 5)).toBe(100);
    expect(normalizedValue(originality, 9)).toBe(100);
    expect(normalizedValue(originality, "4")).toBe(75);
    expect(normalizedValue(originality, "")).toBeNull();
  });

  it("derives unique ids from labels", () => {
    expect(criterionIdFromLabel("Final Score")).toBe("final_score");
    expect(criterionIdFromLabel("Originality", ["originality"])).toBe("originality_2");
    expect(criterionIdFromLabel("!!!")).toBe("criterion");
  });
});

describe("normalizeCriteria", () => {
  it("gives every criterion an id and keeps only the settings its type uses", () => {
    expect(
      normalizeCriteria([
        { label: " Originality ", type: "number", min: 1, max: 5, weight: 2, options: ["ignored"] },
        { label: "Recommendation", type: "select", options: [" Accept ", "Decline", ""] },
        { label: "Comments", type: "text", min: 1, max: 5, weight: 3 },
      ]),
    ).toEqual([
      { id: "originality", label: "Originality", type: "number", min: 1, max: 5, weight: 2 },
      {
        id: "recommendation",
        label: "Recommendation",
        type: "select",
        options: ["Accept", "Decline"],
      },
      { id: "comments", label: "Comments", type: "text" },
    ]);
  });

  it("fills in a usable scale and weight when the organizer leaves them blank", () => {
    expect(normalizeCriteria([{ label: "Impact", type: "number" }])[0]).toMatchObject({
      min: 1,
      max: 5,
      weight: 1,
    });
    // A max at or below the min would make the scale meaningless.
    expect(normalizeCriteria([{ label: "Impact", type: "number", min: 0, max: 0 }])[0]).toMatchObject(
      { min: 0, max: 4 },
    );
  });

  it("keeps existing ids stable so scorecards already filed still line up", () => {
    const [criterion] = normalizeCriteria([
      { id: "originality", label: "Originality (rewritten)", type: "number" },
    ]);
    expect(criterion.id).toBe("originality");
  });

  it("drops abandoned blank rows and de-duplicates ids", () => {
    const criteria = normalizeCriteria([
      { label: "Clarity", type: "number" },
      { label: "   ", type: "text" },
      { label: "Clarity", type: "text" },
    ]);
    expect(criteria.map((criterion) => criterion.id)).toEqual(["clarity", "clarity_2"]);
  });
});

describe("scorecardScore", () => {
  it("is the weighted mean of the normalized ratings", () => {
    // Originality 5/5 = 100% at weight 2, Relevance 3/5 = 50% at weight 1.
    expect(scorecardScore(INITIAL_REVIEW, { originality: 5, relevance: 3 })).toBeCloseTo(
      (100 * 2 + 50 * 1) / 3,
    );
  });

  it("visibly differs from the unweighted mean — weights are not decoration", () => {
    const values = { originality: 5, relevance: 3 };
    const weighted = scorecardScore(INITIAL_REVIEW, values)!;
    const unweighted = scorecardScore(
      INITIAL_REVIEW.map((c) => ({ ...c, weight: 1 })),
      values,
    )!;
    expect(weighted).toBeCloseTo(83.33, 1);
    expect(unweighted).toBeCloseTo(75);
    expect(weighted).toBeGreaterThan(unweighted);
  });

  it("ignores dropdown and free-text answers", () => {
    const withJudgement = scorecardScore(INITIAL_REVIEW, {
      originality: 4,
      relevance: 4,
      recommendation: "Decline",
      comments: "Not for us.",
    });
    expect(withJudgement).toBeCloseTo(75);
  });

  it("is null when no rating was given", () => {
    expect(scorecardScore(INITIAL_REVIEW, { comments: "Only words" })).toBeNull();
    expect(scorecardScore([INITIAL_REVIEW[3]], { comments: "x" })).toBeNull();
  });

  it("scores a partially filled card on the ratings it does have", () => {
    // Only Relevance answered: 4/5 = 75%, and Originality's weight drops out.
    expect(scorecardScore(INITIAL_REVIEW, { relevance: 4 })).toBeCloseTo(75);
  });
});

describe("validateScorecard", () => {
  it("requires every rating and dropdown, but not free text", () => {
    expect(
      validateScorecard(INITIAL_REVIEW, {
        originality: 4,
        relevance: 3,
        recommendation: "Accept",
      }),
    ).toBeNull();
    expect(validateScorecard(INITIAL_REVIEW, { relevance: 3, recommendation: "Accept" })).toBe(
      "Give Originality a rating",
    );
    expect(validateScorecard(INITIAL_REVIEW, { originality: 4, relevance: 3 })).toBe(
      "Choose an option for Recommendation",
    );
  });

  it("rejects a rating outside its scale and a choice that isn't offered", () => {
    expect(
      validateScorecard(INITIAL_REVIEW, {
        originality: 9,
        relevance: 3,
        recommendation: "Accept",
      }),
    ).toBe("Originality must be between 1 and 5");
    expect(
      validateScorecard(INITIAL_REVIEW, {
        originality: 4,
        relevance: 3,
        recommendation: "Perhaps",
      }),
    ).toContain("isn't one of the choices");
  });

  it("keeps only the answers the scorecard asks for, coercing posted strings", () => {
    expect(
      pickScorecardValues(INITIAL_REVIEW, {
        originality: "5",
        relevance: "2",
        recommendation: " Accept ",
        comments: " Strong ",
        smuggled: "nope",
      }),
    ).toEqual({ originality: 5, relevance: 2, recommendation: "Accept", comments: "Strong" });
  });
});

describe("reviewer scoping", () => {
  const assignments = [
    assignment({ id: "a1", reviewerId: "dana", submissionId: "sub-1" }),
    assignment({ id: "a2", reviewerId: "dana", submissionId: "sub-2" }),
    assignment({ id: "a3", reviewerId: "marco", submissionId: "sub-3" }),
    assignment({ id: "a4", reviewerId: "dana", submissionId: "sub-9", roundId: "round-2" }),
  ];

  it("gives a reviewer exactly their own assignments in the round", () => {
    expect(assignmentsForReviewer(assignments, "round-1", "dana").map((a) => a.submissionId)).toEqual(
      ["sub-1", "sub-2"],
    );
    expect(assignmentsForReviewer(assignments, "round-1", "marco").map((a) => a.submissionId)).toEqual(
      ["sub-3"],
    );
    expect(assignmentsForReviewer(assignments, "round-3", "dana")).toEqual([]);
  });

  it("does not carry a reviewer from one round into the next", () => {
    // Marco has work in round 1 only; round 2 is Dana's.
    expect(assignmentsForReviewer(assignments, "round-2", "marco")).toEqual([]);
    expect(assignmentsForReviewer(assignments, "round-2", "dana")).toHaveLength(1);
  });

  it("authorises scoring only through the assignment itself", () => {
    expect(canScoreSubmission(assignments, "round-1", "dana", "sub-1")).toBe(true);
    expect(canScoreSubmission(assignments, "round-1", "dana", "sub-3")).toBe(false);
    expect(canScoreSubmission(assignments, "round-2", "dana", "sub-1")).toBe(false);
    expect(canScoreSubmission(assignments, "round-1", "stranger", "sub-1")).toBe(false);
  });

  it("keeps recused work on the reviewer's list", () => {
    const withRecusal = [
      ...assignments,
      assignment({ id: "a5", reviewerId: "dana", submissionId: "sub-4", status: "recused" }),
    ];
    expect(assignmentsForReviewer(withRecusal, "round-1", "dana")).toHaveLength(3);
  });
});

describe("progressByReviewer", () => {
  it("counts submitted scorecards against what each reviewer still owes", () => {
    const assignments = [
      assignment({ id: "a1", reviewerId: "dana" }),
      assignment({ id: "a2", reviewerId: "dana", submissionId: "sub-2", status: "done" }),
      assignment({ id: "a3", reviewerId: "marco", submissionId: "sub-3" }),
    ];
    const progress = progressByReviewer(assignments, new Set(["a2"]));

    expect(progress).toEqual([
      { reviewerId: "dana", assigned: 2, required: 2, done: 1, recused: 0, pending: 1 },
      { reviewerId: "marco", assigned: 1, required: 1, done: 0, recused: 0, pending: 1 },
    ]);
    expect(progressLabel(progress[0])).toBe("1 of 2 scored");
  });

  it("drops a recusal out of the required work without hiding it", () => {
    const assignments = [
      assignment({ id: "a1", reviewerId: "dana", status: "done" }),
      assignment({ id: "a2", reviewerId: "dana", submissionId: "sub-2", status: "recused" }),
    ];
    const [dana] = progressByReviewer(assignments, new Set(["a1"]));
    expect(dana).toEqual({
      reviewerId: "dana",
      assigned: 2,
      required: 1,
      done: 1,
      recused: 1,
      pending: 0,
    });
    expect(progressLabel(dana)).toBe("1 of 1 scored");
  });

  it("counts a stale 'done' status with no scorecard as still pending", () => {
    const [dana] = progressByReviewer(
      [assignment({ id: "a1", reviewerId: "dana", status: "done" })],
      new Set(),
    );
    expect(dana.done).toBe(0);
    expect(dana.pending).toBe(1);
  });
});

describe("summarizeRound", () => {
  const assignments = [
    assignment({ id: "a1", submissionId: "sub-1", reviewerId: "dana", status: "done" }),
    assignment({ id: "a2", submissionId: "sub-1", reviewerId: "marco", status: "done" }),
    assignment({ id: "a3", submissionId: "sub-2", reviewerId: "dana" }),
    assignment({ id: "a4", submissionId: "sub-3", reviewerId: "dana", status: "recused" }),
  ];
  const scores = [
    score("a1", { originality: 5, relevance: 3, recommendation: "Accept" }),
    score("a2", { originality: 3, relevance: 3, recommendation: "Maybe" }),
  ];

  it("averages the reviewers' scorecard scores per submission", () => {
    const [first] = summarizeRound(INITIAL_REVIEW, assignments, scores);
    // (100·2 + 50)/3 = 83.3 and (50·2 + 50)/3 = 50 -> mean 66.7.
    expect(first.submissionId).toBe("sub-1");
    expect(first.score).toBeCloseTo(66.7, 1);
    expect(first).toMatchObject({ assigned: 2, required: 2, scored: 2, recused: 0 });
  });

  it("reports raw per-criterion averages alongside the aggregate", () => {
    const [first] = summarizeRound(INITIAL_REVIEW, assignments, scores);
    expect(first.criterionAverages).toEqual({ originality: 4, relevance: 3 });
  });

  it("keeps every dropdown and free-text answer verbatim, unaveraged", () => {
    const [first] = summarizeRound(INITIAL_REVIEW, assignments, scores);
    expect(first.criterionAnswers).toEqual({
      recommendation: ["Accept", "Maybe"],
      comments: [],
    });
  });

  it("leaves an unscored submission without a score rather than a zero", () => {
    const summaries = summarizeRound(INITIAL_REVIEW, assignments, scores);
    const second = summaries.find((s) => s.submissionId === "sub-2")!;
    expect(second.score).toBeNull();
    expect(second).toMatchObject({ assigned: 1, required: 1, scored: 0 });
  });

  it("excludes recused assignments from the work owed", () => {
    const summaries = summarizeRound(INITIAL_REVIEW, assignments, scores);
    const third = summaries.find((s) => s.submissionId === "sub-3")!;
    expect(third).toMatchObject({ assigned: 1, required: 0, scored: 0, recused: 1 });
    expect(third.score).toBeNull();
  });

  it("lets weights change the ranking, not just the number", () => {
    const criteria: ScorecardCriterion[] = [
      { id: "originality", label: "Originality", type: "number", min: 1, max: 5, weight: 2 },
      { id: "relevance", label: "Relevance", type: "number", min: 1, max: 5, weight: 1 },
    ];
    const pair = [
      assignment({ id: "x", submissionId: "bold", reviewerId: "dana" }),
      assignment({ id: "y", submissionId: "safe", reviewerId: "dana" }),
    ];
    const filed = [
      score("x", { originality: 5, relevance: 1 }),
      score("y", { originality: 1, relevance: 5 }),
    ];

    const weighted = summarizeRound(criteria, pair, filed);
    expect(weighted.find((s) => s.submissionId === "bold")!.score).toBeGreaterThan(
      weighted.find((s) => s.submissionId === "safe")!.score!,
    );

    const flat = summarizeRound(
      criteria.map((c) => ({ ...c, weight: 1 })),
      pair,
      filed,
    );
    expect(flat.find((s) => s.submissionId === "bold")!.score).toBe(
      flat.find((s) => s.submissionId === "safe")!.score,
    );
  });
});

describe("rollupRoundsBySubmission", () => {
  const rounds = [
    round(),
    round({ id: "round-2", name: "Final Review" }),
  ];
  const assignments = [
    assignment({ id: "a1", submissionId: "sub-1", reviewerId: "dana" }),
    assignment({ id: "a2", submissionId: "sub-1", reviewerId: "marco" }),
    assignment({ id: "a3", roundId: "round-2", submissionId: "sub-1", reviewerId: "dana" }),
    assignment({ id: "a4", submissionId: "sub-2", reviewerId: "dana" }),
  ];
  const scores = [
    score("a1", { originality: 5, relevance: 3 }),
    score("a3", { originality: 4, relevance: 4 }),
  ];

  it("counts filed scorecards across every round the submission sits in", () => {
    const rollups = rollupRoundsBySubmission(rounds, assignments, scores);
    expect(rollups["sub-1"].scorecards).toBe(2);
    expect(rollups["sub-1"].rounds.map((r) => r.roundName)).toEqual([
      "Initial Review",
      "Final Review",
    ]);
  });

  it("carries each round's own aggregate and progress", () => {
    const [initial, final] = rollupRoundsBySubmission(rounds, assignments, scores)["sub-1"].rounds;
    // One of two scorecards in on the first round: (100·2 + 50)/3 = 83.3.
    expect(initial).toMatchObject({ roundId: "round-1", scored: 1, required: 2 });
    expect(initial.score).toBeCloseTo(83.3, 1);
    expect(final).toMatchObject({ roundId: "round-2", scored: 1, required: 1 });
  });

  it("keeps an assigned-but-unscored submission at zero rather than absent", () => {
    const rollups = rollupRoundsBySubmission(rounds, assignments, scores);
    expect(rollups["sub-2"]).toMatchObject({ scorecards: 0 });
    expect(rollups["sub-2"].rounds).toHaveLength(1);
    expect(rollups["sub-2"].rounds[0].score).toBeNull();
  });

  it("leaves a submission no round holds out of the rollup entirely", () => {
    expect(rollupRoundsBySubmission(rounds, assignments, scores)["sub-9"]).toBeUndefined();
    expect(rollupRoundsBySubmission(rounds, [], [])).toEqual({});
  });

  it("labels progress the way the submission record reads it", () => {
    expect(rollupProgressLabel({ scored: 1, required: 2 })).toBe("1 of 2 scorecards");
    expect(rollupProgressLabel({ scored: 1, required: 1 })).toBe("1 of 1 scorecard");
  });
});

describe("scorecardAnswers", () => {
  it("reads a rating back raw, on its own scale — never the normalized share", () => {
    const answers = scorecardAnswers(INITIAL_REVIEW, { originality: 4, relevance: "2" });
    expect(answers).toEqual([
      { label: "Originality", value: "4 / 5" },
      { label: "Relevance", value: "2 / 5" },
    ]);
  });

  it("shows a dropdown choice and a free-text note as the reviewer left them", () => {
    expect(
      scorecardAnswers(INITIAL_REVIEW, {
        recommendation: "Maybe",
        comments: "  Strong idea, thin on evidence.  ",
      }),
    ).toEqual([
      { label: "Recommendation", value: "Maybe" },
      { label: "Comments", value: "Strong idea, thin on evidence." },
    ]);
  });

  it("skips criteria nobody answered rather than showing an empty line", () => {
    expect(
      scorecardAnswers(INITIAL_REVIEW, {
        originality: null,
        relevance: undefined,
        recommendation: "",
        comments: "   ",
      }),
    ).toEqual([]);
    expect(scorecardAnswers(INITIAL_REVIEW, {})).toEqual([]);
  });

  it("ignores a value stored under a key the scorecard no longer asks about", () => {
    expect(scorecardAnswers(INITIAL_REVIEW, { removed_criterion: "7", originality: 1 })).toEqual([
      { label: "Originality", value: "1 / 5" },
    ]);
  });
});

describe("results table", () => {
  function row(title: string, score: number | null, scored = 1): ResultRow {
    return {
      submissionId: title,
      title,
      speakers: ["Priya Raman"],
      trackNames: ["AI Engineering"],
      status: "Unreviewed",
      summary: {
        submissionId: title,
        assigned: 1,
        required: 1,
        scored,
        recused: 0,
        score,
        criterionAverages: { originality: score === null ? null : 4 },
        criterionAnswers: {},
      },
    };
  }

  const rows = [row("Bravo", 50), row("Alpha", 90), row("Charlie", null, 0)];

  it("sorts by aggregate in both directions, keeping unscored talks last", () => {
    expect(sortResultRows(rows, "score", "desc").map((r) => r.title)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
    expect(sortResultRows(rows, "score", "asc").map((r) => r.title)).toEqual([
      "Bravo",
      "Alpha",
      "Charlie",
    ]);
  });

  it("sorts by title too", () => {
    expect(sortResultRows(rows, "title", "asc").map((r) => r.title)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  it("does not mutate the rows it was given", () => {
    const original = rows.map((r) => r.title);
    sortResultRows(rows, "score", "desc");
    expect(rows.map((r) => r.title)).toEqual(original);
  });
});

describe("CSV export", () => {
  it("heads the file with a column per criterion — averages, then the qualitative ones", () => {
    expect(csvHeader(INITIAL_REVIEW)).toEqual([
      "Submission",
      "Speakers",
      "Tracks",
      "Status",
      "Reviewers assigned",
      "Scorecards submitted",
      "Aggregate score",
      "Originality (avg)",
      "Relevance (avg)",
      "Recommendation",
      "Comments",
    ]);
  });

  it("quotes cells containing commas, quotes, or newlines", () => {
    expect(csvRow(["plain", 'say "hi"', "a,b", "line\nbreak", null, 3])).toBe(
      'plain,"say ""hi""","a,b","line\nbreak",,3',
    );
  });

  it("writes one row per submission, with an empty cell for a missing score", () => {
    const rows: ResultRow[] = [
      {
        submissionId: "sub-1",
        title: "Retrieval, at scale",
        speakers: ["Priya Raman", "Tom Beckett"],
        trackNames: ["AI Engineering"],
        status: "Unreviewed",
        summary: {
          submissionId: "sub-1",
          assigned: 2,
          required: 2,
          scored: 2,
          recused: 0,
          score: 66.7,
          criterionAverages: { originality: 4, relevance: 3 },
          criterionAnswers: {
            recommendation: ["Accept", "Maybe"],
            comments: ["Strong, if a little long"],
          },
        },
      },
      {
        submissionId: "sub-2",
        title: "Nobody scored me",
        speakers: [],
        trackNames: [],
        status: "Unreviewed",
        summary: {
          submissionId: "sub-2",
          assigned: 1,
          required: 1,
          scored: 0,
          recused: 0,
          score: null,
          criterionAverages: { originality: null, relevance: null },
          criterionAnswers: { recommendation: [], comments: [] },
        },
      },
    ];

    const csv = roundResultsCsv(INITIAL_REVIEW, rows);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "Submission,Speakers,Tracks,Status,Reviewers assigned,Scorecards submitted,Aggregate score,Originality (avg),Relevance (avg),Recommendation,Comments",
    );
    // Both reviewers' dropdown answers survive the export, and a free-text note
    // with a comma in it is quoted like any other cell.
    expect(lines[1]).toBe(
      '"Retrieval, at scale",Priya Raman; Tom Beckett,AI Engineering,Unreviewed,2,2,66.7,4,3,Accept; Maybe,"Strong, if a little long"',
    );
    expect(lines[2]).toBe("Nobody scored me,,,Unreviewed,1,0,,,,,");
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("carries qualitative answers end to end, from scorecards to columns", () => {
    const assignments = [
      assignment({ id: "a1", submissionId: "sub-1", reviewerId: "dana" }),
      assignment({ id: "a2", submissionId: "sub-1", reviewerId: "marco" }),
    ];
    const summaries = summarizeRound(INITIAL_REVIEW, assignments, [
      score("a1", { originality: 5, relevance: 5, recommendation: "Accept", comments: "Yes" }),
      score("a2", { originality: 5, relevance: 5, recommendation: "Decline" }),
    ]);
    const rows: ResultRow[] = summaries.map((summary) => ({
      submissionId: summary.submissionId,
      title: "Retrieval",
      speakers: [],
      trackNames: [],
      status: "Unreviewed",
      summary,
    }));

    expect(roundResultsCsv(INITIAL_REVIEW, rows).trimEnd().split("\n")[1]).toBe(
      "Retrieval,,,Unreviewed,2,2,100,5,5,Accept; Decline,Yes",
    );
  });
});

describe("blind review (D-049)", () => {
  /** A CFP form as the builder produces it: reserved questions plus a custom one. */
  const FORM_FIELDS: FormField[] = [
    { id: RESERVED_FIELD_IDS.title, type: "text", label: "Title" },
    { id: RESERVED_FIELD_IDS.description, type: "textarea", label: "Abstract" },
    { id: RESERVED_FIELD_IDS.tracks, type: "multiselect", label: "Track" },
    { id: RESERVED_FIELD_IDS.speakerName, type: "text", label: "Your name" },
    { id: RESERVED_FIELD_IDS.speakerEmail, type: "email", label: "Your email" },
    { id: RESERVED_FIELD_IDS.speakerBio, type: "textarea", label: "Your bio" },
    { id: RESERVED_FIELD_IDS.headshot, type: "file", label: "Headshot" },
    { id: RESERVED_FIELD_IDS.coSpeakers, type: "co_speakers", label: "Co-speakers" },
    { id: "format", type: "select", label: "Session format", options: ["Talk", "Workshop"] },
    { id: "takeaway", type: "textarea", label: "Audience takeaway" },
  ];

  it("is off unless the round says otherwise", () => {
    expect(hidesSpeakerIdentity(round())).toBe(false);
    expect(hidesSpeakerIdentity(round({ blindReview: true }))).toBe(true);
  });

  it("counts the person-shaped reserved questions as identity, and nothing else", () => {
    const identity = FORM_FIELDS.filter(isIdentityField).map((field) => field.id);
    expect(identity).toEqual([
      RESERVED_FIELD_IDS.speakerName,
      RESERVED_FIELD_IDS.speakerEmail,
      RESERVED_FIELD_IDS.speakerBio,
      RESERVED_FIELD_IDS.headshot,
      RESERVED_FIELD_IDS.coSpeakers,
    ]);
  });

  it("treats a co-speaker block as identity even under a non-reserved id", () => {
    expect(isIdentityField({ id: "extra_presenters", type: "co_speakers" })).toBe(true);
  });

  it("keeps what the talk is judged on and drops who wrote it", () => {
    const visible = reviewerVisibleFields(FORM_FIELDS, true).map((field) => field.id);
    expect(visible).toEqual([
      RESERVED_FIELD_IDS.title,
      RESERVED_FIELD_IDS.description,
      RESERVED_FIELD_IDS.tracks,
      "format",
      "takeaway",
    ]);
  });

  it("changes nothing when the round isn't blind", () => {
    expect(reviewerVisibleFields(FORM_FIELDS, false)).toEqual(FORM_FIELDS);
  });

  it("replaces the speaker line with the marker, and only when blind", () => {
    expect(speakerLine(["Priya Raman", "Tom Beckett"], false)).toBe("Priya Raman, Tom Beckett");
    expect(speakerLine([], false)).toBe("No speaker on file");
    expect(speakerLine(["Priya Raman"], true)).toBe(BLIND_REVIEW_NOTICE);
    // The marker stands in even when there was nobody to hide, so an empty
    // queue row can't be read as "this one has no author".
    expect(speakerLine([], true)).toBe(BLIND_REVIEW_NOTICE);
  });

  it("strips speakers off queue rows in the loader, leaving the proposal intact", () => {
    const rows = [
      { title: "Retrieval, at scale", speakers: [{ id: "u1", name: "Priya Raman" }] },
      { title: "Nobody here", speakers: [] },
    ];
    expect(withoutSpeakers(rows, true)).toEqual([
      { title: "Retrieval, at scale", speakers: [] },
      { title: "Nobody here", speakers: [] },
    ]);
    expect(withoutSpeakers(rows, false)).toEqual(rows);
  });

  it("finds a blind assignment among the viewer's own scorecards on a submission", () => {
    expect(viewerHasBlindAssignment([])).toBe(false);
    expect(viewerHasBlindAssignment([{ round: round() }])).toBe(false);
    // One blind round is enough — a sighted round beside it must not undo it.
    expect(
      viewerHasBlindAssignment([{ round: round() }, { round: round({ blindReview: true }) }]),
    ).toBe(true);
  });

  it("keys the viewer's blind submissions for a list, ignoring other events' rounds", () => {
    const rounds = [round({ id: "round-1" }), round({ id: "round-2", blindReview: true })];
    const mine = [
      assignment({ id: "a1", roundId: "round-1", submissionId: "sub-1" }),
      assignment({ id: "a2", roundId: "round-2", submissionId: "sub-2" }),
      // Held on another event's blind round, which this event never lists.
      assignment({ id: "a3", roundId: "round-9", submissionId: "sub-3" }),
    ];
    expect(blindSubmissionIds(rounds, mine)).toEqual(new Set(["sub-2"]));
    expect(blindSubmissionIds([], mine)).toEqual(new Set());
  });
});
