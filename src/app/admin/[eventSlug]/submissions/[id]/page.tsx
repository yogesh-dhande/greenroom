import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import type { FormField } from "@/db/entities";
import { prefillValues, publicFields } from "@/domain/forms";
import { loadSubmissionDetail } from "@/domain/submissions";
import { canRecordDecision, canViewSubmission, tallyReviews } from "@/domain/review";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer } from "@/lib/session";
import { fileUrl, filenameFromKey } from "@/lib/uploads";
import { formatDate } from "@/components/date-format";
import { PageHeader } from "@/components/page-header";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { personName, reviewerTrackIdsFor } from "../queue";
import { DecisionPanel } from "./decision-panel";
import { ReviewPanel } from "./review-panel";

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
  // stranger: it isn't here.
  if (!canViewSubmission(viewer.role, reviewerTrackIds, trackIds)) notFound();

  const { submission, form, tracks } = detail;
  const fields = publicFields(
    form.fields,
    tracks.map((track) => track.name),
  );
  const values = prefillValues(fields, {
    answers: submission.answers,
    title: submission.title,
    description: submission.description,
    trackNames: detail.trackNames,
    primarySpeaker: { name: detail.primarySpeaker.name, email: detail.primarySpeaker.email },
    coSpeakers: detail.coSpeakers,
  });

  const [reviews, session, decider] = await Promise.all([
    repos.reviews.listBySubmission(id),
    repos.sessions.getBySubmission(id),
    submission.decidedBy ? repos.users.getById(submission.decidedBy) : Promise.resolve(null),
  ]);
  const reviewers = await repos.users.listByIds([...new Set(reviews.map((r) => r.reviewerId))]);
  const reviewerById = new Map(reviewers.map((person) => [person.id, person]));
  const tally = tallyReviews(reviews);
  const myReview = reviews.find((review) => review.reviewerId === viewer.id) ?? null;

  // What acceptance already produced, so the outcome is visible on the page
  // that caused it rather than only on the agenda and task screens.
  const [eventTasks, assignments] = await Promise.all([
    repos.tasks.listByEvent(event.id),
    Promise.all(detail.speakerIds.map((speakerId) => repos.taskAssignments.listBySpeaker(speakerId))),
  ]);
  const taskById = new Map(eventTasks.map((task) => [task.id, task]));
  const speakerTaskCount = assignments
    .flat()
    .filter((assignment) => taskById.has(assignment.taskId)).length;

  return (
    <div>
      <Link
        href={`/admin/${eventSlug}/submissions`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        All submissions
      </Link>

      <PageHeader
        title={submission.title}
        description={`Submitted ${formatDate(submission.createdAt)} via ${form.name}`}
        action={<SubmissionStatusBadge status={submission.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>The proposal</CardTitle>
            </CardHeader>
            <CardContent>
              <AnswerList fields={fields} values={values} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reviewer notes</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No reviewer has weighed in yet.
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
        </div>

        <div className="flex flex-col gap-6">
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

          <DecisionPanel
            eventSlug={eventSlug}
            submissionId={submission.id}
            status={submission.status}
            note={submission.decisionNote}
            decidedBy={decider ? personName(decider) : null}
            decidedAt={submission.decidedAt ? formatDate(submission.decidedAt) : null}
            canDecide={canRecordDecision(viewer.role)}
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
    </div>
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
 */
function AnswerList({ fields, values }: { fields: FormField[]; values: Record<string, unknown> }) {
  return (
    <dl className="flex flex-col gap-4">
      {fields.map((field) => {
        const value = values[field.id];
        const rendered = renderAnswer(field, value);
        if (rendered === null) return null;
        return (
          <div key={field.id} className="flex flex-col gap-1">
            <dt className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              {field.label}
            </dt>
            <dd className="text-sm whitespace-pre-line text-foreground">{rendered}</dd>
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
