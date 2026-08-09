import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLinkIcon } from "lucide-react";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { FORM_STATE_LABELS, formWindowState } from "@/domain/forms";
import { formatDeadline } from "@/lib/event-time";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { NewFormButton } from "./new-form-button";

export default async function FormsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  // Building a CFP is an organizer job — reviewers land back on their queue,
  // the same guard event settings uses.
  await requireAdmin(`/admin/${eventSlug}/forms`);

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const forms = await repos.forms.listByEvent(event.id);
  const counts = await repos.submissions.countByForms(forms.map((form) => form.id));

  return (
    <div>
      <PageHeader
        title="Forms"
        description="Call-for-speakers forms — welcome copy, questions, submission window, and confirmation copy."
        action={<NewFormButton eventSlug={eventSlug} />}
      />

      {forms.length === 0 ? (
        <EmptyState
          title="No forms yet"
          description="Build a submission form to open a call for speakers. New forms start with the standard questions — a title, an abstract, tracks, and speaker info — so you only have to change what's different."
          action={<NewFormButton eventSlug={eventSlug} />}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Window</TableHead>
              <TableHead className="text-right">Responses</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {forms.map((form) => {
              const state = formWindowState(form);
              return (
                <TableRow key={form.id}>
                  <TableCell>
                    <Link
                      href={`/admin/${eventSlug}/forms/${form.id}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {form.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">/submit/{form.slug}</p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        state === "open" ? "default" : state === "closed" ? "outline" : "secondary"
                      }
                    >
                      {FORM_STATE_LABELS[state]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {form.opensAt || form.closesAt ? (
                      <>
                        {form.opensAt ? `Opens ${formatDeadline(form.opensAt, event.timezone)}` : null}
                        {form.opensAt && form.closesAt ? <br /> : null}
                        {form.closesAt
                          ? `Closes ${formatDeadline(form.closesAt, event.timezone)}`
                          : null}
                      </>
                    ) : (
                      "No dates set"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">
                    {counts[form.id] ?? 0}
                  </TableCell>
                  <TableCell>
                    {form.isPublished ? (
                      <Link
                        href={`/submit/${form.slug}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                      >
                        View
                        <ExternalLinkIcon className="size-3.5" />
                      </Link>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
