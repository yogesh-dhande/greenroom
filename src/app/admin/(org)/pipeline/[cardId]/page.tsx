import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import type { User } from "@/db/entities";
import { contactDisplayName } from "@/domain/crm";
import { formatPipelineScore, PIPELINE_STAGE_LABELS } from "@/domain/pipeline";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddNoteForm } from "./add-note-form";
import { MoveStageMenu } from "../move-stage-menu";

/**
 * Stage history and notes are minutes apart in the eval scenario, so the
 * stamp carries the time as well as the date — a date-only label would render
 * two distinct moves identically and the history would read as a duplicate.
 *
 * UTC with the zone spelled out, because these are org-level records with no
 * event whose zone they could belong to (contrast `formatDueDate`, which is
 * event-scoped by design). Server-rendered only, so there is no client clock
 * to disagree with.
 */
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function stamp(instant: Date): string {
  return TIMESTAMP_FORMAT.format(instant);
}

/** "Ada Lovelace" / "ada@example.com" / "Removed user" for an actor id. */
function personLabel(userId: string | null, people: Map<string, User>): string {
  if (!userId) return "System";
  const person = people.get(userId);
  if (!person) return "Removed user";
  return contactDisplayName(person);
}

/**
 * One pipeline card in full (spec.md "Org-level speaker CRM", D-077): who the
 * prospect is, where they sit on the board, why they were enrolled, the
 * org-level internal notes about them, and the timestamped record of every
 * stage they have passed through.
 */
export default async function PipelineCardPage({
  params,
}: {
  params: Promise<{ cardId: string }>;
}) {
  const { cardId } = await params;
  await requireAdmin(`/admin/pipeline/${cardId}`);

  const repos = await getRepos();
  const cardWithHistory = await repos.pipeline.getCardWithHistory(cardId);
  if (!cardWithHistory) notFound();

  const { card, history } = cardWithHistory;
  const detail = await repos.contacts.getDetail(card.userId);
  // The card outlives nothing: its contact is a `users` row, so a missing
  // detail means the account is gone and there is no card left to show.
  if (!detail) notFound();

  const contact = detail.user;
  const displayName = contactDisplayName(contact);
  const notes = detail.notes;

  const peopleIds = [
    ...new Set(
      [
        ...history.map((event) => event.actorUserId),
        ...notes.map((note) => note.authorUserId),
      ].filter((id): id is string => id !== null),
    ),
  ];
  const people = new Map<string, User>(
    (peopleIds.length > 0 ? await repos.users.listByIds(peopleIds) : []).map((person) => [
      person.id,
      person,
    ]),
  );

  return (
    <div>
      <Link
        href="/admin/pipeline"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Back to pipeline
      </Link>

      <PageHeader
        title={displayName}
        description={[contact.title, contact.company].filter(Boolean).join(" · ") || undefined}
        action={
          <MoveStageMenu cardId={card.id} stage={card.stage} contactName={displayName} />
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Contact</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="font-medium text-foreground">{displayName}</p>
            <p className="text-muted-foreground">{contact.email}</p>
            {contact.title && <p className="text-muted-foreground">{contact.title}</p>}
            {contact.company && <p className="text-muted-foreground">{contact.company}</p>}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-muted-foreground">Stage</span>
              <Badge variant="outline">{PIPELINE_STAGE_LABELS[card.stage]}</Badge>
            </div>
            <Link
              href={`/admin/directory/${contact.id}`}
              className="pt-1 text-sm text-primary underline-offset-4 hover:underline"
            >
              Open contact profile
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sourcing rationale
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {card.score !== null ? (
              <p className="text-foreground tabular-nums">
                Score {formatPipelineScore(card.score)}
              </p>
            ) : (
              <EmptyState variant="inline" title="No score recorded" />
            )}
            <p className={card.rationale ? "whitespace-pre-wrap text-foreground" : "text-muted-foreground"}>
              {card.rationale ?? "No rationale recorded"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Internal notes
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {notes.length === 0 ? (
              <EmptyState
                variant="inline"
                title="No notes yet."
                description="Only organizers ever see these."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {notes.map((note) => (
                  <li key={note.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <p className="text-sm whitespace-pre-wrap text-foreground">{note.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {personLabel(note.authorUserId, people)} · {stamp(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <AddNoteForm cardId={card.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Stage history
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <EmptyState variant="inline" title="No stage changes recorded." />
            ) : (
              <ul className="flex flex-col gap-3">
                {history.map((event) => (
                  <li key={event.id}>
                    <p className="text-sm text-foreground">
                      {event.fromStage
                        ? `${PIPELINE_STAGE_LABELS[event.fromStage]} -> ${PIPELINE_STAGE_LABELS[event.toStage]}`
                        : `Enrolled as ${PIPELINE_STAGE_LABELS[event.toStage]}`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {personLabel(event.actorUserId, people)} · {stamp(event.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
