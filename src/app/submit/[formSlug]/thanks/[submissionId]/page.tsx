import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2Icon } from "lucide-react";
import { getRepos } from "@/lib/db";
import { renderText } from "@/domain/comms-templates";
import { Button } from "@/components/ui/button";

/**
 * The confirmation page a speaker sees right after submitting (spec.md §2 —
 * "confirmation page and confirmation email", both editable per form).
 *
 * The page copy is the organizer's, run through the same merge-field renderer
 * as the emails so `{{speaker_name}}` and friends work in both places
 * (decisions.md D-020: unknown placeholders render empty rather than shouting
 * at a speaker).
 */
export default async function SubmissionThanksPage({
  params,
}: {
  params: Promise<{ formSlug: string; submissionId: string }>;
}) {
  const { formSlug, submissionId } = await params;
  const repos = await getRepos();

  const form = await repos.forms.getBySlug(formSlug);
  if (!form) notFound();

  const submission = await repos.submissions.getById(submissionId);
  // The submission id is unguessable, but it still has to belong to this form
  // — otherwise the URL would confirm any submission under any form's copy.
  if (!submission || submission.formId !== form.id) notFound();

  const [event, speakers] = await Promise.all([
    repos.events.getById(submission.eventId),
    repos.submissions.listSpeakers(submission.id),
  ]);
  const primaryId = (speakers.find((link) => link.role === "primary") ?? speakers[0])?.userId;
  const primary = primaryId ? await repos.users.getById(primaryId) : null;

  const copy = renderText(form.confirmationPageContent ?? "", {
    eventName: event?.name ?? "",
    speakerName: primary?.name ?? "",
    speakerFirstName: primary?.name?.split(" ")[0] ?? "",
    submissionTitle: submission.title,
    portalUrl: `/portal/submissions/${submission.id}`,
  });

  const editPath = `/portal/submissions/${submission.id}`;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
      <div className="flex items-center gap-2 text-primary">
        <CheckCircle2Icon className="size-5" />
        <p className="text-sm font-medium">Proposal received</p>
      </div>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
        {submission.title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {event ? `${event.name} — ` : ""}
        {form.name}
      </p>

      <div className="mt-6 rounded-lg border border-border bg-muted/40 p-6">
        <p className="whitespace-pre-line text-sm text-foreground">
          {copy.trim() ||
            `Thanks${primary?.name ? `, ${primary.name}` : ""} — we have your proposal and will be in touch.`}
        </p>
      </div>

      {primary ? (
        <p className="mt-6 text-sm text-muted-foreground">
          A confirmation email is on its way to {primary.email}.
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Need to change something? You can keep editing your proposal — sign in with the same
          email address and we&apos;ll send you a link, no password needed.
        </p>
        <div>
          <Button asChild variant="outline">
            <Link href={`/login?next=${encodeURIComponent(editPath)}`}>
              Sign in to edit your proposal
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
