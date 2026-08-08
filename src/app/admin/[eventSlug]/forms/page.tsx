import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export default async function FormsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const forms = await repos.forms.listByEvent(event.id);

  return (
    <div>
      <PageHeader
        title="Forms"
        description="Call-for-speakers forms — welcome copy, abstract fields, and speaker info."
      />

      {forms.length === 0 ? (
        <EmptyState
          title="No forms yet"
          description="Build a submission form to open a call for speakers."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {forms.map((form) => (
              <TableRow key={form.id}>
                <TableCell className="font-medium text-foreground">{form.name}</TableCell>
                <TableCell className="text-muted-foreground">/submit/{form.slug}</TableCell>
                <TableCell>
                  <Badge variant={form.isPublished ? "default" : "secondary"}>
                    {form.isPublished ? "Published" : "Draft"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
