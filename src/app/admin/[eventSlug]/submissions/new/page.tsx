import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { emptyValues, publicFields } from "@/domain/forms";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SchemaForm } from "@/components/schema-form/schema-form";
import { uploadFormFile } from "@/app/upload-actions";
import { createSubmissionOnBehalf } from "./actions";

/**
 * Entering a proposal on a speaker's behalf (spec.md §2, decisions.md D-034,
 * D-038) — the invited keynote, the abstract that arrived by email, the talk
 * agreed in a hallway.
 *
 * It renders the event's own CFP form rather than a separate admin-only field
 * set: the questions an organizer wants answered are the ones they already
 * wrote, and reusing the schema means a manually entered proposal carries the
 * same answers as every other one in the queue.
 */
export default async function NewSubmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{ formId?: string }>;
}) {
  const { eventSlug } = await params;
  const { formId } = await searchParams;
  await requireAdmin(`/admin/${eventSlug}/submissions/new`);

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const forms = await repos.forms.listByEvent(event.id);
  // A single form is the common case — don't make an organizer pick from a
  // list of one.
  const selected = formId
    ? (forms.find((form) => form.id === formId) ?? null)
    : forms.length === 1
      ? forms[0]
      : null;

  const tracks = await repos.tracks.listByEvent(event.id);
  const fields = selected
    ? publicFields(
        selected.fields,
        tracks.map((track) => track.name),
      )
    : [];

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
        title="Add a submission"
        description="For a talk that came to you outside the form — an invited keynote, an emailed abstract. It lands in the queue like any other proposal."
      />

      {forms.length === 0 ? (
        <EmptyState
          title="No forms yet"
          description="Create a call-for-speakers form first — its questions are what you'll fill in here."
        />
      ) : !selected ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Which form should it be filed under?</p>
          <ul className="flex flex-col gap-2">
            {forms.map((form) => (
              <li key={form.id}>
                <Link
                  href={`/admin/${eventSlug}/submissions/new?formId=${form.id}`}
                  className="block rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
                >
                  {form.name}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {form.isPublished ? "Published" : "Not published"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="max-w-2xl">
          {forms.length > 1 ? (
            <p className="mb-6 text-sm text-muted-foreground">
              Using the questions from <span className="text-foreground">{selected.name}</span>.{" "}
              <Link
                href={`/admin/${eventSlug}/submissions/new`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Choose a different form
              </Link>
            </p>
          ) : null}

          <SchemaForm
            fields={fields}
            defaultValues={emptyValues(fields)}
            submitLabel="Add proposal"
            pendingLabel="Adding…"
            action={createSubmissionOnBehalf.bind(null, eventSlug, selected.id)}
            uploadAction={uploadFormFile}
            uploadScope={selected.slug}
            footnote={
              <p className="text-sm text-muted-foreground">
                The speaker&apos;s email address creates or matches their profile, so they can sign
                in later and edit this like their own. We don&apos;t send them a confirmation —
                they never filled in a form. The submission window and any per-speaker limit are
                ignored here.
              </p>
            }
          />
        </div>
      )}
    </div>
  );
}
