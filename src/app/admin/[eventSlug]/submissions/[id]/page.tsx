import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { createsSessionsDirectly, RESERVED_FIELD_IDS, type FormField } from "@/db/entities";
import { DIRECT_TO_SESSION_LABEL, prefillValues, publicFields } from "@/domain/forms";
import { loadSubmissionDetail, queuePosition, type QueuePosition } from "@/domain/submissions";
import { canRecordDecision, canViewSubmission, tallyReviews } from "@/domain/review";
import {
  BLIND_REVIEW_NOTICE,
  hidesSpeakerIdentity,
  reviewerVisibleFields,
  rollupProgressLabel,
  viewerHasBlindAssignment,
} from "@/domain/rounds";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer } from "@/lib/session";
import { fileUrl, filenameFromKey } from "@/lib/uploads";
import { formatDate } from "@/components/date-format";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScorecardForm } from "../../rounds/[roundId]/score/[submissionId]/scorecard-form";
import {
  loadRoundRollups,
  loadSubmissionOrder,
  loadViewerScorecards,
  personName,
  reviewerTrackIdsFor,
  rollupFor,
  type SubmissionRollup,
} from "../queue";
import { DecisionBar } from "./decision-panel";
import { DecisionOutcome } from "./decision-outcome";
import { ReviewPanel } from "./review-panel";
import { TracksCard } from "./tracks-card";

/**
 * One submission, in full (spec.md §4): every answer as the speaker gave it,
 * what the reviewers said, and — for an admin — the decision that turns it
 * into a session and an onboarding plan (spec.md §5).
 */
export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ eventSlug: string; id: string }>;
}) {
  const { eventSlug, id } = await params;
  const viewer = await requireAdminOrReviewer(`/admin/${eventSlug}/submissions/${id}`);

  const repos = await getRepos();
  const [event, detail] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    loadSubmissionDetail({ repos }, id),
  ]);
  if (!event || !detail || detail.submission.eventId !== event.id) notFound();

  const [trackIds, reviewerTrackIds] = await Promise.all([
    repos.submissions.listTrackIds(id),
    reviewerTrackIdsFor(repos, viewer, event.id),
  ]);
  // A reviewer outside this submission's tracks gets the same answer as a
  // stranger: it isn't here. Same for an unsubmitted draft, which is nobody's
  // to review yet (decisions.md D-034).
  if (!canViewSubmission(viewer.role, reviewerTrackIds, trackIds)) notFound();
  if (viewer.role !== "admin" && detail.submission.status === "draft") notFound();
  // Nor is a session-type submission review work — it was a session before a
  // reviewer could have an opinion (decisions.md D-041).
  if (viewer.role !== "admin" && createsSessionsDirectly(detail.form)) notFound();

  const { submission, form, tracks } = detail;
  const isDirectToSession = createsSessionsDirectly(form);

  const [reviews, session, decider, queueOrder] = await Promise.all([
    repos.reviews.listBySubmission(id),
    repos.sessions.getBySubmission(id),
    submission.decidedBy ? repos.users.getById(submission.decidedBy) : Promise.resolve(null),
    // The pager walks the submissions list's own order and membership: the same
    // loader, so "4 of 17" counts exactly the rows that list would show this
    // viewer, and Next never lands on a record their queue doesn't hold.
    loadSubmissionOrder(repos, event, viewer),
  ]);
  const pager = queuePosition(queueOrder, id);
  const reviewers = await repos.users.listByIds([...new Set(reviews.map((r) => r.reviewerId))]);
  const reviewerById = new Map(reviewers.map((person) => [person.id, person]));
  const tally = tallyReviews(reviews);
  const myReview = reviews.find((review) => review.reviewerId === viewer.id) ?? null;

  // What acceptance already produced, so the outcome is visible on the page
  // that caused it rather than only on the agenda and task screens.
  const [eventTasks, assignments, rollups, myScorecards] = await Promise.all([
    repos.tasks.listByEvent(event.id),
    Promise.all(detail.speakerIds.map((speakerId) => repos.taskAssignments.listBySpeaker(speakerId))),
    // Round scorecards are review activity too, and this record has to say so
    // rather than contradict the round's own results page (decisions.md D-048).
    // Organizer-only, like every other view of a round's aggregate (D-035).
    viewer.role === "admin"
      ? loadRoundRollups(repos, event.id)
      : Promise.resolve<Record<string, SubmissionRollup>>({}),
    // The viewer's own round work on this proposal, so the scorecard is where
    // the proposal is rather than only behind the rounds pages (D-048).
    loadViewerScorecards(repos, event.id, viewer.id, id),
  ]);
  const rollup = rollupFor(rollups, id);

  // The track queue reaches this record (D-035(1)/D-047), so a reviewer scoring
  // this proposal in a blind round would otherwise read the author here that
  // the round's own scorecard withheld. Same withholding, same source of truth:
  // the identity questions are filtered out *before* the values are built, so a
  // withheld answer never reaches the browser. Admins are never anonymized —
  // blind review keeps the scorer unbiased, not the organizer (D-049).
  const blind = viewer.role !== "admin" && viewerHasBlindAssignment(myScorecards);
  const fields = reviewerVisibleFields(
    publicFields(
      form.fields,
      tracks.map((track) => track.name),
    ),
    blind,
  );
  const values = prefillValues(fields, {
    answers: submission.answers,
    title: submission.title,
    description: submission.description,
    trackNames: detail.trackNames,
    primarySpeaker: { name: detail.primarySpeaker.name, email: detail.primarySpeaker.email },
    coSpeakers: detail.coSpeakers,
  });

  const taskById = new Map(eventTasks.map((task) => [task.id, task]));
  const speakerTaskCount = assignments
    .flat()
    .filter((assignment) => taskById.has(assignment.taskId)).length;

  // Abstract first, and only once. The title question is dropped outright (the
  // h1 above already is the answer, printed larger) and the abstract is lifted
  // out of the answer list so the thing being judged reads as prose instead of
  // as one more label/value row between the format and the code of conduct.
  const abstractField = fields.find((field) => field.id === RESERVED_FIELD_IDS.description);
  const abstract = abstractField ? values[abstractField.id] : null;
  const abstractText = typeof abstract === "string" ? abstract.trim() : "";
  const detailFields = fields.filter(
    (field) =>
      field.id !== RESERVED_FIELD_IDS.title && field.id !== RESERVED_FIELD_IDS.description,
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/admin/${eventSlug}/submissions`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          All submissions
        </Link>
        <QueuePager eventSlug={eventSlug} pager={pager} />
      </div>

      <PageHeader
        title={submission.title}
        description={`Submitted ${formatDate(submission.createdAt)} via ${form.name}`}
        action={
          isDirectToSession ? <Badge variant="outline">{DIRECT_TO_SESSION_LABEL}</Badge> : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-4">
              {/* One marker where the author would have been, so the gap reads
                  as a rule rather than as missing data (D-049). */}
              {blind ? (
                <p className="text-sm text-muted-foreground">{BLIND_REVIEW_NOTICE}</p>
              ) : null}
              {abstractText ? (
                <p className="max-w-prose text-base leading-7 whitespace-pre-line text-foreground">
                  {abstractText}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {abstractField
                    ? `No ${abstractField.label.toLowerCase()} was given.`
                    : "This form didn't ask for an abstract."}
                </p>
              )}
            </CardContent>
          </Card>

          {detailFields.length === 0 ? null : (
            <Card>
              <CardHeader>
                <CardTitle>The rest of the proposal</CardTitle>
                <CardDescription>
                  Everything else this form asked for, as the speaker answered it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AnswerList fields={detailFields} values={values} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Reviewer notes</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {/* Only when *neither* source holds anything: a filed
                      scorecard is a reviewer weighing in (D-048). */}
                  {rollup.scorecards > 0
                    ? `No written recommendation yet — ${rollup.scorecards} round scorecard${
                        rollup.scorecards === 1 ? "" : "s"
                      } filed — see Round results below.`
                    : "No reviewer has weighed in yet."}
                </p>
              ) : (
                reviews.map((review, index) => {
                  const person = reviewerById.get(review.reviewerId);
                  return (
                    <div key={review.id} className="flex flex-col gap-1.5">
                      {index > 0 && <Separator className="mb-3" />}
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {person ? personName(person) : "A reviewer"}
                        </span>
                        {review.recommendation && (
                          <RecommendationBadge recommendation={review.recommendation} />
                        )}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {formatDate(review.updatedAt)}
                        </span>
                      </div>
                      {review.comment ? (
                        <p className="text-sm whitespace-pre-line text-muted-foreground">
                          {review.comment}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">No comment.</p>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* The rounds pages stay the deep view; this is the record telling
              the truth about them (decisions.md D-048). */}
          {rollup.rounds.length === 0 ? null : (
            <Card>
              <CardHeader>
                <CardTitle>Round results</CardTitle>
                <CardDescription>
                  Where this proposal stands in each review round it was assigned to.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {rollup.rounds.map((round) => (
                  <div key={round.roundId} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <Link
                        href={`/admin/${eventSlug}/rounds/${round.roundId}/results`}
                        className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {round.roundName}
                      </Link>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {round.score === null ? "Not scored yet" : `avg ${round.score}`}
                        {" · "}
                        {rollupProgressLabel(round)}
                      </span>
                    </div>
                    {/* The scorecards themselves, not just the aggregate: the
                        dropdown and free-text criteria are never scored (D-035),
                        so an average is the one thing that can't say what a
                        reviewer actually answered. */}
                    {round.filed.map((card, index) => (
                      <div
                        key={`${card.reviewerName}-${index}`}
                        className="flex flex-col gap-1 border-l-2 border-border pl-3"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-sm font-medium text-foreground">
                            {card.reviewerName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(card.submittedAt)}
                          </span>
                        </div>
                        {card.answers.length === 0 ? (
                          <p className="text-sm text-muted-foreground italic">
                            Filed with nothing filled in.
                          </p>
                        ) : (
                          <dl className="flex flex-col gap-0.5">
                            {card.answers.map((answer, position) => (
                              <div
                                key={`${answer.label}-${position}`}
                                className="flex flex-wrap gap-x-2 text-sm"
                              >
                                <dt className="text-muted-foreground">{answer.label}:</dt>
                                <dd className="whitespace-pre-line text-foreground">
                                  {answer.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {/* Not a reviewer's call — routing a talk into or out of their own
              tracks would be them widening their own reach. Admin-only,
              matching the DecisionBar's canDecide gate below. */}
          {viewer.role === "admin" ? (
            <TracksCard
              eventSlug={eventSlug}
              submissionId={submission.id}
              tracks={tracks}
              trackIds={trackIds}
            />
          ) : null}

          {myScorecards.map((card) => (
            <Card key={card.round.id}>
              <CardHeader>
                <CardTitle>{card.round.name}</CardTitle>
                <CardDescription>
                  {card.submitted
                    ? "Your scorecard for this round — filed, and editable while the round is open."
                    : "Your scorecard for this round."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* A blind round is scored where the author isn't shown, and
                    this page shows the author — so the round keeps its own
                    page and this card is only the way in (decisions.md D-049). */}
                {hidesSpeakerIdentity(card.round) ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-muted-foreground">
                      This round hides speaker identity, so its scorecard is filled in on the
                      round&apos;s own page.
                    </p>
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/admin/${eventSlug}/rounds/${card.round.id}/score/${submission.id}`}
                      >
                        {card.submitted ? "Open your scorecard" : "Score this submission"}
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <ScorecardForm
                    eventSlug={eventSlug}
                    roundId={card.round.id}
                    submissionId={submission.id}
                    criteria={card.round.criteria}
                    values={card.values}
                    submitted={card.submitted}
                    recused={card.assignment.status === "recused"}
                    recusalReason={card.assignment.recusalReason}
                    canScore={card.open}
                    returnTo={`/admin/${eventSlug}/submissions/${submission.id}`}
                  />
                )}
              </CardContent>
            </Card>
          ))}

          {/* Nothing to recommend on a talk the form already accepted (D-041),
              and nothing to recommend in the flat §4 vocabulary once a round
              has asked this viewer its own questions: the round is the
              authoritative scoring system where one is configured (D-048), so
              the two forms never sit on the page together. */}
          {isDirectToSession || myScorecards.length > 0 ? null : (
            <ReviewPanel
              eventSlug={eventSlug}
              submissionId={submission.id}
              tally={tally}
              myReview={
                myReview
                  ? { recommendation: myReview.recommendation, comment: myReview.comment }
                  : null
              }
            />
          )}

          {/* What the decision already set off (spec.md section 5): reference
              material, so it stays on the page with the rest of the record
              while the buttons themselves live in the bar below. */}
          <DecisionOutcome
            eventSlug={eventSlug}
            status={submission.status}
            note={submission.decisionNote}
            session={
              session
                ? {
                    id: session.id,
                    scheduled: Boolean(session.day && session.startTime),
                    cancelled: session.status === "cancelled",
                  }
                : null
            }
            taskCount={speakerTaskCount}
            speakerCount={detail.speakerIds.length}
          />
        </div>
      </div>

      {/* The decision is the reason this page exists, so it stops being
          something you scroll to find: the bar rides the bottom of the
          viewport with the record scrolling underneath it. */}
      <DecisionBar
        eventSlug={eventSlug}
        submissionId={submission.id}
        status={submission.status}
        note={submission.decisionNote}
        decidedBy={decider ? personName(decider) : null}
        decidedAt={submission.decidedAt ? formatDate(submission.decidedAt) : null}
        canDecide={canRecordDecision(viewer.role)}
        speakerCount={detail.speakerIds.length}
      />
    </div>
  );
}

/**
 * "4 of 17", with the record either side of this one (wave W25).
 *
 * Plain links to sibling ids, no client state and no cursor in the URL, so the
 * pager is as reloadable and as shareable as the record itself. `pager` is
 * null when this record isn't in the viewer's queue at all (an out-of-queue
 * record still opens; it just has nothing to page through).
 */
function QueuePager({ eventSlug, pager }: { eventSlug: string; pager: QueuePosition | null }) {
  if (!pager) return null;
  const href = (id: string) => `/admin/${eventSlug}/submissions/${id}`;
  return (
    <nav aria-label="Submissions" className="flex items-center gap-2">
      <span className="text-sm tabular-nums text-muted-foreground">
        {pager.position} of {pager.total}
      </span>
      <div className="flex items-center gap-1">
        {/* Disabled rather than hidden at either end: the pair keeps its
            shape, so Next doesn't slide under the pointer on the last record. */}
        {pager.previousId ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(pager.previousId)} rel="prev">
              <ChevronLeftIcon />
              Prev
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeftIcon />
            Prev
          </Button>
        )}
        {pager.nextId ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(pager.nextId)} rel="next">
              Next
              <ChevronRightIcon />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
            <ChevronRightIcon />
          </Button>
        )}
      </div>
    </nav>
  );
}

function RecommendationBadge({ recommendation }: { recommendation: "approve" | "maybe" | "deny" }) {
  if (recommendation === "approve") return <Badge>Approve</Badge>;
  if (recommendation === "deny") return <Badge variant="destructive">Deny</Badge>;
  return <Badge variant="secondary">Maybe</Badge>;
}

/**
 * The submitted answers, rendered from the form's own field schema (D-009) so
 * a custom question an organizer added shows up here without any code change.
 *
 * Everything here is supporting detail now that the abstract has been lifted
 * out above it, so it is set two-up and in the same muted weight the queue
 * table uses for its own data cells: still perfectly readable, and no longer
 * competing with the thing actually being judged.
 */
function AnswerList({ fields, values }: { fields: FormField[]; values: Record<string, unknown> }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const value = values[field.id];
        const rendered = renderAnswer(field, value);
        if (rendered === null) return null;
        return (
          <div key={field.id} className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              {field.label}
            </dt>
            <dd className="text-sm whitespace-pre-line text-muted-foreground">{rendered}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function renderAnswer(field: FormField, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return null;

  if (field.type === "checkbox") return value ? "Yes" : "No";

  if (field.type === "file" && typeof value === "string") {
    return (
      <a
        href={fileUrl(value)}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-4"
      >
        {filenameFromKey(value)}
      </a>
    );
  }

  if (field.type === "co_speakers" && Array.isArray(value)) {
    const rows = value
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .map((row) =>
        [row.name, row.email, [row.title, row.company].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" — "),
      )
      .filter(Boolean);
    return rows.length === 0 ? null : rows.join("\n");
  }

  if (Array.isArray(value)) {
    const items = value.map(String).filter(Boolean);
    return items.length === 0 ? null : items.join(", ");
  }

  if (field.type === "url" && typeof value === "string") {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-4"
      >
        {value}
      </a>
    );
  }

  return typeof value === "string" ? value : String(value);
}
