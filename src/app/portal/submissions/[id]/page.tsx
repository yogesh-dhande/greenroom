import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getRepos } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { formatDeadline } from "@/lib/event-time";
import { acceptsSubmissions, closureIsDateDriven, prefillValues, publicFields } from "@/domain/forms";
import { speakerFacingStatus } from "@/domain/evaluation";
import { loadSubmissionDetail } from "@/domain/submissions";
import { PageHeader } from "@/components/page-header";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
import { SchemaForm } from "@/components/schema-form/schema-form";
import { uploadFormFile } from "@/app/upload-actions";
import { updateOwnSubmission } from "./actions";

/**
 * A speaker's own proposal, editable while the call is open (spec.md §3 —
 * "submissions remain editable by the submitter").
 *
 * The same schema-driven renderer as the public CFP page, prefilled: the
 * answers that live in `submissions.answers`, plus the ones whose real home is
 * a column or a join table (title, description, tracks, speakers) read back
 * from there, so an organizer's edit is never clobbered by a stale copy.
 */
export default async function PortalSubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/portal/submissions/${id}`);

  const repos = await getRepos();
  const detail = await loadSubmissionDetail({ repos }, id);
  if (!detail) notFound();

  // Primary speaker or co-speaker only. A 404 rather than a "not yours" page:
  // whether a given submission exists is not the visitor's business.
  if (!detail.speakerIds.includes(user.id)) notFound();

  const { submission, form, event, tracks } = detail;
  const fields = publicFields(
    form.fields,
    tracks.map((track) => track.name),
  );
  const editable = acceptsSubmissions(form);
  // A draft is reachable here as well as through its emailed link; saving it
  // from this form submits it, since this form asks for everything
  // (decisions.md D-034, D-038).
  const isDraft = submission.status === "draft";
  const values = prefillValues(fields, {
    answers: submission.answers,
    title: submission.title,
    description: submission.description,
    trackNames: detail.trackNames,
    primarySpeaker: { name: detail.primarySpeaker.name, email: detail.primarySpeaker.email },
    coSpeakers: detail.coSpeakers,
  });

  return (
    <div>
      <Link
        href="/portal"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Speaker home
      </Link>

      <PageHeader
        title={submission.title}
        description={`${event.name} — ${form.name}`}
        action={<SubmissionStatusBadge status={speakerFacingStatus(submission.status)} />}
      />

      {editable ? (
        <>
          {isDraft ? (
            <p className="mb-6 text-sm text-muted-foreground">
              This is still a draft — the organizers haven&apos;t seen it. Finish the required
              questions and submit it
              {form.closesAt ? ` before ${formatDeadline(form.closesAt, event.timezone)}` : ""}.
            </p>
          ) : form.closesAt ? (
            <p className="mb-6 text-sm text-muted-foreground">
              You can keep editing until {formatDeadline(form.closesAt, event.timezone)}.
            </p>
          ) : (
            <p className="mb-6 text-sm text-muted-foreground">
              You can keep editing while this call for speakers is open.
            </p>
          )}
          <SchemaForm
            fields={fields}
            defaultValues={values}
            submitLabel={isDraft ? "Submit proposal" : "Save changes"}
            pendingLabel={isDraft ? "Submitting…" : "Saving…"}
            action={updateOwnSubmission.bind(null, submission.id)}
            uploadAction={uploadFormFile}
            uploadScope={form.slug}
          />
        </>
      ) : (
        <ReadOnlyAnswers
          fields={fields}
          values={values}
          // Only cite the date when the window's own close date is what
          // froze the form — an unpublished or not-yet-open form is also
          // non-editable, but blaming a future closesAt for that is
          // misleading (eval finding: this banner used to say a form
          // "closed" on a date that hadn't happened yet).
          closedAt={closureIsDateDriven(form) ? form.closesAt : null}
          timezone={event.timezone}
        />
      )}
    </div>
  );
}

/** Once the window closes the proposal is frozen, but the speaker should still
 * be able to see exactly what they submitted. */
function ReadOnlyAnswers({
  fields,
  values,
  closedAt,
  timezone,
}: {
  fields: { id: string; label: string; type: string }[];
  values: Record<string, unknown>;
  closedAt: Date | null;
  timezone: string;
}) {
  function display(value: unknown): string {
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          item && typeof item === "object"
            ? [(item as { name?: string }).name, (item as { email?: string }).email]
                .filter(Boolean)
                .join(" — ")
            : String(item),
        )
        .filter(Boolean)
        .join(", ");
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return typeof value === "string" ? value : "";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-warning bg-warning/10 p-4">
        <p className="text-sm text-foreground">
          {closedAt
            ? `This call for speakers closed ${formatDeadline(closedAt, timezone)}, so your proposal can no longer be edited.`
            : "This call for speakers is closed, so your proposal can no longer be edited."}{" "}
          Get in touch with the organizers if something needs to change.
        </p>
      </div>
      <dl className="flex flex-col gap-4">
        {fields.map((field) => {
          const text = display(values[field.id]);
          if (!text) return null;
          return (
            <div key={field.id} className="flex flex-col gap-1">
              <dt className="text-sm font-medium text-foreground">{field.label}</dt>
              <dd className="whitespace-pre-line text-sm text-muted-foreground">{text}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
