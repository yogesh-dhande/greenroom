import Link from "next/link";
import { notFound } from "next/navigation";
import { RESERVED_FIELD_IDS, type FormField } from "@/db/entities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
import { prefillValues, publicFields } from "@/domain/forms";
import {
  ROUND_STATE_LABEL,
  canScoreSubmission,
  hidesSpeakerIdentity,
  reviewerVisibleFields,
  roundState,
  speakerLine,
} from "@/domain/rounds";
import { loadSubmissionDetail } from "@/domain/submissions";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer } from "@/lib/session";
import { fileUrl, filenameFromKey } from "@/lib/uploads";
import { loadRound, loadRoundSubmissions } from "../../../data";
import { ScorecardForm } from "./scorecard-form";

/**
 * One submission's scorecard, as its assigned reviewer sees it (rubric ABS-03,
 * ABS-12).
 *
 * The gate is the reviewer's own assignment row, re-read here from the session
 * id: guessing another submission's id in the URL gets a 404, not a form. The
 * page shows the proposal and this reviewer's own answers — never the aggregate
 * and never anyone else's scorecard.
 *
 * On a blind round (decisions.md D-049) the proposal is shown without its
 * author: the speaker block becomes a marker, and the identity questions are
 * dropped from the answer list before its values are built, so a withheld
 * answer is never rendered. Everything the talk is judged on — title, abstract,
 * tracks, and every genuinely custom question — still shows, and recusal stays
 * available: a reviewer can recognise the work without the name.
 */

/** Questions with their own slot above the answer list, so they aren't repeated. */
const ALREADY_SHOWN = new Set<string>([
  RESERVED_FIELD_IDS.title,
  RESERVED_FIELD_IDS.description,
  RESERVED_FIELD_IDS.tracks,
]);

export default async function ScorecardPage({
  params,
}: {
  params: Promise<{ eventSlug: string; roundId: string; submissionId: string }>;
}) {
  const { eventSlug, roundId, submissionId } = await params;
  const viewer = await requireAdminOrReviewer(
    `/admin/${eventSlug}/rounds/${roundId}/score/${submissionId}`,
  );
  const repos = await getRepos();
  const loaded = await loadRound(repos, eventSlug, roundId);
  if (!loaded) notFound();
  const { event, round } = loaded;

  const mine = await repos.reviewRounds.listAssignmentsByReviewer(viewer.id);
  if (!canScoreSubmission(mine, roundId, viewer.id, submissionId)) notFound();
  const assignment = mine.find(
    (row) => row.roundId === roundId && row.submissionId === submissionId,
  )!;

  const [submissions, existing, detail] = await Promise.all([
    loadRoundSubmissions(repos, event.id),
    repos.reviewRounds.getScore(assignment.id),
    loadSubmissionDetail({ repos }, submissionId),
  ]);
  const row = submissions.find((entry) => entry.submission.id === submissionId);
  if (!row) notFound();

  const state = roundState(round);
  const blind = hidesSpeakerIdentity(round);

  // The proposal as the speaker filled it in, rendered from the form's own
  // schema (D-009) so a custom question shows up without a code change. On a
  // blind round the identity questions are filtered out *first*, so the values
  // built below never contain a name, an email, a bio, a headshot key or a
  // co-speaker row. Title, abstract and tracks are dropped either way — they
  // already have their own place on this page.
  const answerFields = detail
    ? reviewerVisibleFields(
        publicFields(
          detail.form.fields,
          detail.tracks.map((track) => track.name),
        ),
        blind,
      ).filter((field) => !ALREADY_SHOWN.has(field.id))
    : [];
  const answerValues = detail
    ? prefillValues(answerFields, {
        answers: detail.submission.answers,
        title: detail.submission.title,
        description: detail.submission.description,
        trackNames: detail.trackNames,
        primarySpeaker: {
          name: detail.primarySpeaker.name,
          email: detail.primarySpeaker.email,
        },
        coSpeakers: detail.coSpeakers,
      })
    : {};

  return (
    <div>
      <PageHeader
        title={row.submission.title}
        description={`${round.name} — your scorecard`}
        action={
          <Button asChild variant="outline">
            <Link href={`/admin/${eventSlug}/rounds/${roundId}/score`}>Back to queue</Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <SubmissionStatusBadge status={row.submission.status} />
          <Badge variant={state === "open" ? "default" : "outline"}>
            {ROUND_STATE_LABEL[state]}
          </Badge>
          {blind ? <Badge variant="outline">Blind review</Badge> : null}
          {row.trackNames.length > 0 ? <span>{row.trackNames.join(", ")}</span> : null}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            {blind ? "Speaker" : row.speakers.length > 1 ? "Speakers" : "Speaker"}
          </p>
          <p className="text-sm text-muted-foreground">
            {speakerLine(
              row.speakers.map((person) => person.name ?? person.email),
              blind,
            )}
          </p>
        </div>
        {row.submission.description ? (
          <div>
            <p className="text-sm font-medium text-foreground">Abstract</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {row.submission.description}
            </p>
          </div>
        ) : null}
        {answerFields.length > 0 ? <AnswerList fields={answerFields} values={answerValues} /> : null}
      </div>

      <ScorecardForm
        eventSlug={eventSlug}
        roundId={roundId}
        submissionId={submissionId}
        criteria={round.criteria}
        values={existing?.values ?? {}}
        submitted={Boolean(existing)}
        recused={assignment.status === "recused"}
        recusalReason={assignment.recusalReason}
        canScore={state === "open"}
      />
    </div>
  );
}

/** The rest of the proposal, in the form's own field order. */
function AnswerList({ fields, values }: { fields: FormField[]; values: Record<string, unknown> }) {
  return (
    <dl className="flex flex-col gap-4">
      {fields.map((field) => {
        const rendered = renderAnswer(field, values[field.id]);
        if (rendered === null) return null;
        return (
          <div key={field.id} className="flex flex-col gap-1">
            <dt className="text-sm font-medium text-foreground">{field.label}</dt>
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
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) =>
        [entry.name, entry.email, [entry.title, entry.company].filter(Boolean).join(", ")]
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
