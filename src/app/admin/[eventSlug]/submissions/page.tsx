import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const submissions = await repos.submissions.listByEvent(event.id);

  return (
    <div>
      <PageHeader
        title="Submissions"
        description="Every talk submitted to this event's call for speakers."
      />

      {submissions.length === 0 ? (
        <EmptyState
          title="No submissions yet"
          description="They'll show up here as soon as speakers submit via a published form."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Track(s)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.map((submission) => (
              <TableRow key={submission.id}>
                <TableCell className="font-medium text-foreground">{submission.title}</TableCell>
                <TableCell className="text-muted-foreground">—</TableCell>
                <TableCell>
                  <SubmissionStatusBadge status={submission.status} />
                </TableCell>
                <TableCell>{submission.createdAt.toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
