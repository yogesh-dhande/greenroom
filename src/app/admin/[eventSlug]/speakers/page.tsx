import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * Speaker directory. Wave 1 shows every user with the `speaker` role
 * platform-wide (there's no per-event speaker link yet — that comes with
 * acceptance conversion, spec.md §5). Onboarding status (missing bios,
 * headshots, files) lands with the task-assignment work in a later wave.
 */
export default async function SpeakersPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const speakers = await repos.users.listByRole("speaker");

  return (
    <div>
      <PageHeader
        title="Speakers"
        description="Everyone confirmed to speak at any event."
      />

      {speakers.length === 0 ? (
        <EmptyState
          title="No speakers yet"
          description="Accepting a submission automatically creates the speaker record here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {speakers.map((speaker) => (
              <TableRow key={speaker.id}>
                <TableCell className="font-medium text-foreground">
                  {speaker.name ?? "—"}
                </TableCell>
                <TableCell>{speaker.email}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
