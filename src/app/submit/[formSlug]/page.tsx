import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { RESERVED_FIELD_IDS } from "@/db/entities";
import {
  emptyValues,
  formWindowState,
  publicFields,
  submissionLimitMessage,
} from "@/domain/forms";
import { speakerLimitState } from "@/domain/submissions";
import { formatDeadline } from "@/lib/event-time";
import { getSessionUser } from "@/lib/session";
import { SchemaForm } from "@/components/schema-form/schema-form";
import { uploadFormFile } from "@/app/upload-actions";
import { saveDraft, submitProposal } from "./actions";
import { ClosedNotice, DraftResumeNotice, SubmitNotice, SubmitShell } from "./submit-shell";

/**
 * Public call-for-speakers submission page (spec.md §2, §3).
 *
 * No auth — this is the page speakers land on from a CFP link, so the slug
 * alone has to resolve the form (form slugs are globally unique for exactly
 * this reason). The questions, their order, their conditional logic and their
 * validation all come from the form's stored field schema (decisions.md
 * D-009); nothing about a particular event is hardcoded here.
 */
export default async function SubmitFormPage({
  params,
}: {
  params: Promise<{ formSlug: string }>;
}) {
  const { formSlug } = await params;
  const repos = await getRepos();
  const form = await repos.forms.getBySlug(formSlug);
  // Only a slug matching no form is a true 404 (decisions.md D-063). An
  // unpublished form still resolves — it renders the same closed state as a
  // form outside its open window, below, rather than a dead end that reads
  // like a broken deployment to a speaker following a shared link.
  if (!form) notFound();

  const event = await repos.events.getById(form.eventId);
  if (!event) notFound();

  const tracks = await repos.tracks.listByEvent(event.id);
  const fields = publicFields(
    form.fields,
    tracks.map((track) => track.name),
  );
  const state = formWindowState(form);

  // Anyone we can already identify — a speaker who signed in to edit an
  // earlier proposal — gets their answers started for them, and is told up
  // front if they've used up their allowance rather than after filling the
  // whole thing in (decisions.md D-034, D-038).
  const viewer = state === "open" ? await getSessionUser() : null;
  const person = viewer ? await repos.users.getById(viewer.id) : null;
  const limit = person ? await speakerLimitState({ repos }, form, person.email) : null;
  // A returning speaker who never finished a proposal here shouldn't be handed
  // a second blank form with no mention of the first (D-038) — but this must
  // never block starting a fresh one, so it's a notice, not a wall.
  const drafts = person
    ? (await repos.submissions.listByFormAndSpeaker(form.id, person.id)).filter(
        (submission) => submission.status === "draft",
      )
    : [];

  const defaultValues = emptyValues(fields);
  if (person) {
    if (RESERVED_FIELD_IDS.speakerName in defaultValues) {
      defaultValues[RESERVED_FIELD_IDS.speakerName] = person.name ?? "";
    }
    if (RESERVED_FIELD_IDS.speakerEmail in defaultValues) {
      defaultValues[RESERVED_FIELD_IDS.speakerEmail] = person.email;
    }
  }

  return (
    <SubmitShell eventName={event.name} formName={form.name} welcomeCopy={form.welcomeCopy}>
      {state !== "open" ? (
        <>
          <ClosedNotice form={form} timezone={event.timezone} />
          <p className="mt-4 text-sm text-muted-foreground">
            <Link
              href={`/p/${event.slug}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              View {event.name}&apos;s public program
            </Link>
          </p>
        </>
      ) : limit?.atLimit && limit.limit !== null ? (
        <SubmitNotice title="You've used your proposals for this call">
          <p>{submissionLimitMessage(limit.limit)}</p>
          <p className="mt-3">
            <Link href="/portal" className="text-primary underline-offset-4 hover:underline">
              Go to your proposals
            </Link>
          </p>
        </SubmitNotice>
      ) : (
        <>
          <DraftResumeNotice drafts={drafts} />
          {form.closesAt ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Submissions close {formatDeadline(form.closesAt, event.timezone)}.
            </p>
          ) : null}
          <div className="mt-8">
            <SchemaForm
              fields={fields}
              defaultValues={defaultValues}
              submitLabel="Submit proposal"
              pendingLabel="Submitting…"
              action={submitProposal.bind(null, form.slug, null)}
              draftAction={saveDraft.bind(null, form.slug, null)}
              uploadAction={uploadFormFile}
              uploadScope={form.slug}
              footnote={
                <p className="text-sm text-muted-foreground">
                  Questions marked <span className="text-destructive">*</span> are required. Not
                  finished? Save a draft and we&apos;ll email you a link back to it. Once you
                  submit, we email a confirmation and you can sign in later to edit your proposal.
                </p>
              }
            />
          </div>
        </>
      )}
    </SubmitShell>
  );
}
