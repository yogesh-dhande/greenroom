import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { toZonedInputValue } from "@/domain/forms";
import { FormBuilder } from "./form-builder";

/** The form builder (spec.md §2). Everything an organizer needs to open a
 * call for speakers lives on this one page: the questions, the copy, the
 * window, and the publish switch. */
export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ eventSlug: string; formId: string }>;
}) {
  const { eventSlug, formId } = await params;
  await requireAdmin(`/admin/${eventSlug}/forms/${formId}`);

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const form = await repos.forms.getById(formId);
  if (!form || form.eventId !== event.id) notFound();

  const [tracks, counts] = await Promise.all([
    repos.tracks.listByEvent(event.id),
    repos.submissions.countByForms([form.id]),
  ]);

  return (
    <div>
      <Link
        href={`/admin/${eventSlug}/forms`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        All forms
      </Link>

      <FormBuilder
        eventSlug={eventSlug}
        eventTimezone={event.timezone}
        trackNames={tracks.map((track) => track.name)}
        responseCount={counts[form.id] ?? 0}
        form={{
          id: form.id,
          name: form.name,
          slug: form.slug,
          type: form.type,
          welcomeCopy: form.welcomeCopy ?? "",
          fields: form.fields,
          opensAt: toZonedInputValue(form.opensAt, event.timezone),
          closesAt: toZonedInputValue(form.closesAt, event.timezone),
          confirmationPageContent: form.confirmationPageContent ?? "",
          confirmationEmailSubject: form.confirmationEmailSubject ?? "",
          confirmationEmailBody: form.confirmationEmailBody ?? "",
          maxSubmissionsPerSpeaker:
            form.maxSubmissionsPerSpeaker === null ? "" : String(form.maxSubmissionsPerSpeaker),
          isPublished: form.isPublished,
        }}
      />
    </div>
  );
}
