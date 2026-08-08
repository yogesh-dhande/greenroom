import { notFound } from "next/navigation";
import { isFormOpen } from "@/db/entities";
import { getRepos } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

/**
 * Public call-for-speakers submission page (spec.md §2, §3). No auth — this
 * is the page speakers land on from a CFP link, so the slug alone has to
 * resolve the form (form slugs are globally unique for exactly this reason).
 *
 * Wave 1 renders the form's public framing — welcome copy, open/closed
 * window, the fields that will be asked. Rendering real inputs and accepting
 * a submission is Wave 2.
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
  const open = isFormOpen(form);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
      {event ? <p className="text-sm text-muted-foreground">{event.name}</p> : null}
      <div className="mt-1 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {form.name}
        </h1>
        <Badge variant={open ? "default" : "secondary"}>{open ? "Open" : "Closed"}</Badge>
      </div>

      {form.welcomeCopy ? (
        <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">
          {form.welcomeCopy}
        </p>
      ) : null}

      {open ? (
        <EmptyState
          className="mt-8"
          title="The submission form isn't ready yet"
          description={
            form.fields.length > 0
              ? `This call asks for: ${form.fields.map((field) => field.label).join(", ")}.`
              : "This form has no questions yet."
          }
        />
      ) : (
        <EmptyState
          className="mt-8"
          title="This call for speakers is closed"
          description="Submissions are not being accepted right now. Check back for the next call."
        />
      )}
    </div>
  );
}
