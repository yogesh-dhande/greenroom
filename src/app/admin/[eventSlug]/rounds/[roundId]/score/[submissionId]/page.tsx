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

/** Questions with their own slot above the answer list, so they aren't repeated.
 * Speaker identity is the speaker line's job — printing the "Your name" answer
 * again below it says the same thing twice (and blind rounds already strip
 * identity fields before this set is consulted). */
const ALREADY_SHOWN = new Set<string>([
  RESERVED_FIELD_IDS.title,
  RESERVED_FIELD_IDS.description,
  RESERVED_FIELD_IDS.tracks,
  RESERVED_FIELD_IDS.speakerName,
  RESERVED_FIELD_IDS.speakerEmail,
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
  if (!canScoreSubmission(mine, roundId, viewer.id, submissionId)) {
    // The authorization decision is unchanged — only an explicit assignment
    // authorises scoring (D-089), and an organizer never holds one. What
    // changes is the *answer*, and only for organizers: this used to be a bare
    // 404, which reads as a broken link rather than a permission boundary, and
    // an organizer reaches it by following an ordinary score link.
    //
    // A *reviewer* who lands here still gets the 404. They may be in a blind
    // round, where naming the other reviewers on a submission — or even
    // confirming that this submission id sits in this round — is exactly the
    // context the round is designed to withhold. An organizer already reads all
    // of it on the assignments page, so telling them costs nothing.
    if (viewer.role !== "admin") notFound();

    const holders = (await repos.reviewRounds.listAssignments(roundId)).filter(
      (row) => row.submissionId === submissionId,
    );
    const reviewers = await Promise.all(
      holders.map(async (row) => {
        const person = await repos.users.getById(row.reviewerId);
        return person?.name ?? person?.email ?? null;
      }),
    );
    return (
      <NotAssigned
        eventSlug={eventSlug}
        roundId={roundId}
        roundName={round.name}
        reviewers={reviewers.filter((name): name is string => Boolean(name))}
      />
    );
  }
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
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/admin/${eventSlug}/rounds/${roundId}/score`}>Back to queue</Link>
            </Button>
            {/* The proposal is long by design, and the scorecard is what the
                reviewer came to do: this is the short way past it. */}
            <Button asChild variant="secondary">
              <Link href="#scorecard">Jump to scorecard</Link>
            </Button>
          </div>
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

      <section
        id="scorecard"
        className="flex scroll-mt-6 flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6"
      >
        <div>
          <h2 className="text-base font-semibold text-foreground">Your scorecard</h2>
          <p className="text-sm text-muted-foreground">
            Rate each criterion, and the weighted total updates as you pick.
          </p>
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
      </section>
    </div>
  );
}

/**
 * Shown when the viewer holds no assignment for this submission in this round.
 *
 * Deliberately says nothing about the proposal itself — not its title, not its
 * speaker, not its status. The viewer is not authorised to evaluate it, and a
 * "helpful" preview here would leak exactly what a blind round withholds. It
 * names the round and who is assigned, which an organizer already sees on the
 * assignments page, and sends them there.
 */
function NotAssigned({
  eventSlug,
  roundId,
  roundName,
  reviewers,
}: {
  eventSlug: string;
  roundId: string;
  roundName: string;
  reviewers: string[];
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader title="Not your scorecard" description={roundName} />
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">
          Only a reviewer holding an explicit assignment can score a submission, and you don&apos;t
          hold one for this proposal in this round. Organizers don&apos;t get an implicit
          assignment — being an admin lets you <em>manage</em> the round, not evaluate inside it.
        </p>
        {reviewers.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Assigned to {reviewers.join(", ")}.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nobody is assigned to this proposal in this round yet.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/admin/${eventSlug}/rounds/${roundId}/assignments`}>
              Manage assignments
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/admin/${eventSlug}/rounds/${roundId}`}>Back to round</Link>
          </Button>
        </div>
      </div>
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
