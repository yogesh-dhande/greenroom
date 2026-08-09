import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRepos } from "@/lib/db";
import { formWindowState, prefillValues, publicFields } from "@/domain/forms";
import { loadSubmissionDetail } from "@/domain/submissions";
import { formatDeadline } from "@/lib/event-time";
import { SchemaForm } from "@/components/schema-form/schema-form";
import { uploadFormFile } from "@/app/upload-actions";
import { saveDraft, submitProposal } from "../../actions";
import { ClosedNotice, SubmitNotice, SubmitShell } from "../../submit-shell";

/**
 * Picking a saved draft back up (spec.md §2, decisions.md D-034, D-038).
 *
 * The token in the URL *is* the authentication: there are no accounts at
 * submit time, so the unguessable link we emailed the submitter is what proves
 * they own the draft. Nothing here is listed or searchable, and the token is
 * scoped to one submission, so knowing it grants exactly one proposal.
 */
export default async function ResumeDraftPage({
  params,
}: {
  params: Promise<{ formSlug: string; token: string }>;
}) {
  const { formSlug, token } = await params;
  const repos = await getRepos();

  const submission = await repos.submissions.getByResumeToken(token);
  if (!submission) notFound();

  const detail = await loadSubmissionDetail({ repos }, submission.id);
  if (!detail || detail.form.slug !== formSlug) notFound();

  const { form, event } = detail;

  // The token outlives the draft, so a speaker who clicks an old link after
  // submitting lands on their confirmation rather than a dead end.
  if (submission.status !== "draft") {
    redirect(`/submit/${form.slug}/thanks/${submission.id}`);
  }

  const fields = publicFields(
    form.fields,
    detail.tracks.map((track) => track.name),
  );
  const state = formWindowState(form);

  return (
    <SubmitShell eventName={event.name} formName={form.name} welcomeCopy={form.welcomeCopy}>
      {state !== "open" ? (
        <>
          <ClosedNotice form={form} timezone={event.timezone} />
          <p className="mt-4 text-sm text-muted-foreground">
            Your draft is safe, but it can&apos;t be submitted right now.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            <Link
              href={`/p/${event.slug}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              View {event.name}&apos;s public program
            </Link>
          </p>
        </>
      ) : (
        <>
          <SubmitNotice title="Picking up where you left off">
            <p>
              This is the draft you saved{form.closesAt ? "" : "."}
              {form.closesAt
                ? ` — it hasn't been sent to the organizers yet. Submissions close ${formatDeadline(form.closesAt, event.timezone)}.`
                : " It hasn't been sent to the organizers yet."}
            </p>
            <p className="mt-3">
              Save it again to keep working later, or submit it when you&apos;re happy with it.
            </p>
          </SubmitNotice>

          <div className="mt-8">
            <SchemaForm
              fields={fields}
              defaultValues={prefillValues(fields, {
                answers: submission.answers,
                title: submission.title,
                description: submission.description,
                trackNames: detail.trackNames,
                primarySpeaker: detail.primarySpeaker,
                coSpeakers: detail.coSpeakers,
              })}
              submitLabel="Submit proposal"
              pendingLabel="Submitting…"
              action={submitProposal.bind(null, form.slug, token)}
              draftAction={saveDraft.bind(null, form.slug, token)}
              draftLabel="Save draft again"
              uploadAction={uploadFormFile}
              uploadScope={form.slug}
              footnote={
                <p className="text-sm text-muted-foreground">
                  Questions marked <span className="text-destructive">*</span> are required before
                  you can submit — a draft doesn&apos;t need them. Keep this link: it&apos;s how you
                  get back here.{" "}
                  <Link href="/portal" className="text-primary underline-offset-4 hover:underline">
                    Already submitted something?
                  </Link>
                </p>
              }
            />
          </div>
        </>
      )}
    </SubmitShell>
  );
}
