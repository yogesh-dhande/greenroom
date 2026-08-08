import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate } from "@/components/date-format";

const TASK_TYPE_LABEL: Record<string, string> = {
  form: "Fill out a form",
  file_request: "Upload a file",
  confirm: "Confirm information",
};

export default async function TasksPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const tasks = await repos.tasks.listByEvent(event.id);

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Onboarding jobs assigned to accepted speakers — forms, uploads, confirmations."
      />

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Define onboarding tasks and they can auto-assign to speakers when a submission is accepted."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="font-medium text-foreground">{task.title}</TableCell>
                <TableCell>
                  <Badge variant="outline">{TASK_TYPE_LABEL[task.type] ?? task.type}</Badge>
                </TableCell>
                <TableCell>{task.dueAt ? formatDate(task.dueAt) : "No due date"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
