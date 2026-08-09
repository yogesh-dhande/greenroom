import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { emptyValues, formWindowState, publicFields } from "@/domain/forms";
import { formatDeadline } from "@/lib/event-time";
import { SchemaForm } from "@/components/schema-form/schema-form";
import { uploadFormFile } from "@/app/upload-actions";
import { submitProposal } from "./actions";

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
  // An unpublished form is indistinguishable from a nonexistent one to the
  // public: drafts must not be discoverable by guessing slugs.
  if (!form || !form.isPublished) notFound();

  const event = await repos.events.getById(form.eventId);
  if (!event) notFound();

  const tracks = await repos.tracks.listByEvent(event.id);
  const fields = publicFields(
    form.fields,
    tracks.map((track) => track.name),
  );
  const state = formWindowState(form);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
      <p className="text-sm text-muted-foreground">{event.name}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{form.name}</h1>

      {form.welcomeCopy ? (
        <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{form.welcomeCopy}</p>
      ) : null}

      {state === "open" ? (
        <>
          {form.closesAt ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Submissions close {formatDeadline(form.closesAt, event.timezone)}.
            </p>
          ) : null}
          <div className="mt-8">
            <SchemaForm
              fields={fields}
              defaultValues={emptyValues(fields)}
              submitLabel="Submit proposal"
              pendingLabel="Submitting…"
              action={submitProposal.bind(null, form.slug)}
              uploadAction={uploadFormFile}
              uploadScope={form.slug}
              footnote={
                <p className="text-sm text-muted-foreground">
                  Questions marked <span className="text-destructive">*</span> are required. We
                  will email you a confirmation, and you can sign in later to edit your proposal.
                </p>
              }
            />
          </div>
        </>
      ) : (
        <ClosedNotice
          state={state}
          opensAt={form.opensAt}
          closesAt={form.closesAt}
          timezone={event.timezone}
        />
      )}
    </div>
  );
}

/** The friendly closed page (spec.md §2 — a submission window that has not
 * opened yet reads very differently from one that has passed). */
function ClosedNotice({
  state,
  opensAt,
  closesAt,
  timezone,
}: {
  state: string;
  opensAt: Date | null;
  closesAt: Date | null;
  timezone: string;
}) {
  const scheduled = state === "scheduled";
  return (
    <div className="mt-8 rounded-lg border border-border bg-muted/40 p-8">
      <p className="text-base font-medium text-foreground">
        {scheduled ? "This call for speakers hasn't opened yet" : "This call for speakers is closed"}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {scheduled && opensAt
          ? `Submissions open ${formatDeadline(opensAt, timezone)} — come back then.`
          : closesAt
            ? `Submissions closed ${formatDeadline(closesAt, timezone)}. Thanks for your interest — watch for the next call.`
            : "Submissions aren't being accepted right now. Watch for the next call."}
      </p>
    </div>
  );
}
