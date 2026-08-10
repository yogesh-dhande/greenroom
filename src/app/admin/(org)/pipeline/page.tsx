import Link from "next/link";
import type { PipelineStage } from "@/db/entities";
import type { DirectoryContact } from "@/db/repos/contacts";
import { contactDisplayName } from "@/domain/crm";
import {
  filterByStage,
  formatPipelineScore,
  isPipelineStage,
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGES,
  PIPELINE_VIEW_TABLE,
  resolvePipelineView,
  sortByLastTouch,
} from "@/domain/pipeline";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EnrollProspectDialog, type EnrollCandidate } from "./enroll-prospect-dialog";
import { MoveStageMenu } from "./move-stage-menu";
import { PipelineFilters } from "./pipeline-filters";
import { PipelineTable, type ProspectRow } from "./pipeline-table";

const PIPELINE_PATH = "/admin/pipeline";

/**
 * The sourcing pipeline (spec.md "Org-level speaker CRM", decisions.md
 * D-077), in either of two shapes: the board — five stage columns, one card
 * per enrolled contact, moved by an explicit control rather than a drag
 * gesture — or the same prospects as a table sorted stalest-first for an
 * outreach pass. The board is the default; the table is `?view=table`, so the
 * choice is a URL rather than hidden state and survives a reload, a bookmark
 * and the back button.
 *
 * Identity comes from the directory rather than from the card, because a card
 * stores a `userId` and nothing else — names and companies live on the person,
 * so a contact who changes employer is right on the board without a backfill.
 * The `users.listByIds` fallback covers the one case the directory can't: a
 * card whose contact is neither a speaker anywhere nor in the registry, which
 * shouldn't happen but must not blank out a card if it does.
 *
 * Last touch is read in one batched query (`listLastTouchByCards`) and only
 * for the view that shows it: the board doesn't ask, so it doesn't pay.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; stage?: string }>;
}) {
  const { view, stage } = await searchParams;
  await requireAdmin(PIPELINE_PATH);
  const repos = await getRepos();

  const activeView = resolvePipelineView(view);
  const onTable = activeView === PIPELINE_VIEW_TABLE;
  const stageFilter: PipelineStage | null = isPipelineStage(stage) ? stage : null;

  const [cards, contacts] = await Promise.all([
    repos.pipeline.listCards(),
    repos.contacts.listDirectory(),
  ]);

  const contactsByUser = new Map<string, Pick<DirectoryContact, "name" | "email" | "company">>(
    contacts.map((contact) => [contact.userId, contact]),
  );

  const orphanIds = cards
    .map((card) => card.userId)
    .filter((userId) => !contactsByUser.has(userId));
  if (orphanIds.length > 0) {
    for (const user of await repos.users.listByIds(orphanIds)) {
      contactsByUser.set(user.id, {
        name: user.name,
        email: user.email,
        company: user.company,
      });
    }
  }

  // A card with no stage history at all can't exist (enrolling writes one),
  // but the enrolment date is the honest answer if one ever does: it is the
  // last thing that happened to that prospect either way.
  const touches = onTable
    ? await repos.pipeline.listLastTouchByCards(cards.map((card) => card.id))
    : [];
  const touchByCard = new Map(touches.map((touch) => [touch.cardId, touch.lastTouchedAt]));

  const prospects: ProspectRow[] = cards.map((card) => {
    const contact = contactsByUser.get(card.userId);
    return {
      cardId: card.id,
      userId: card.userId,
      name: contact ? contactDisplayName(contact) : "Unknown contact",
      company: contact?.company ?? null,
      score: card.score,
      stage: card.stage,
      lastTouchedAt: touchByCard.get(card.id) ?? card.createdAt,
    };
  });

  const enrolledUserIds = new Set(cards.map((card) => card.userId));
  const candidates: EnrollCandidate[] = contacts
    .filter((contact) => !enrolledUserIds.has(contact.userId))
    .map((contact) => ({
      userId: contact.userId,
      label: `${contactDisplayName(contact)} (${contact.email})`,
    }));

  const tableRows = sortByLastTouch(filterByStage(prospects, stageFilter));

  // Read once, server-side, and handed down: every row's "34d ago" is measured
  // from the same instant. `new Date().getTime()` rather than `Date.now()`
  // because React's purity lint flags the latter as a known-impure call during
  // render, even here where it runs once per request.
  const now = new Date().getTime();

  return (
    <div>
      <PageHeader
        title="Sourcing pipeline"
        description="Prospective speakers across every event, from first sighting to a confirmed yes."
        action={<EnrollProspectDialog candidates={candidates} />}
      />

      {/* Which shape, in the organizer's own words. Two links rather than a
          control with state: each view is a URL, so it is linkable and the
          back button takes you where you were (the same pattern the
          submissions queue's list toggle uses). */}
      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="How to show the pipeline"
      >
        <Button asChild size="sm" variant={onTable ? "outline" : "default"}>
          <Link href={PIPELINE_PATH} aria-current={onTable ? undefined : "page"}>
            Board
          </Link>
        </Button>
        <Button asChild size="sm" variant={onTable ? "default" : "outline"}>
          <Link
            href={`${PIPELINE_PATH}?view=${PIPELINE_VIEW_TABLE}`}
            aria-current={onTable ? "page" : undefined}
          >
            Table
          </Link>
        </Button>
      </div>

      {onTable ? (
        <>
          <PipelineFilters
            stage={stageFilter}
            total={prospects.length}
            shown={tableRows.length}
          />

          {tableRows.length === 0 ? (
            <EmptyState
              title={stageFilter ? "Nobody is on that stage" : "No prospects yet"}
              description={
                stageFilter
                  ? "Pick another stage, or show every prospect on the board."
                  : "Add a prospect to start tracking who you're approaching for future events."
              }
            />
          ) : (
            <PipelineTable rows={tableRows} now={now} />
          )}
        </>
      ) : (
        <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {PIPELINE_STAGES.map((columnStage) => {
            const columnCards = filterByStage(prospects, columnStage);
            return (
              <section
                key={columnStage}
                aria-label={`${PIPELINE_STAGE_LABELS[columnStage]} stage`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
              >
                <header className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold tracking-tight text-foreground">
                    {PIPELINE_STAGE_LABELS[columnStage]}
                  </h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {columnCards.length}
                  </span>
                </header>

                {columnCards.length === 0 ? (
                  <EmptyState variant="inline" title="No prospects" />
                ) : (
                  columnCards.map((card) => (
                    <article
                      key={card.cardId}
                      className="flex flex-col gap-1 rounded-md border border-border bg-background p-3"
                    >
                      <Link
                        href={`${PIPELINE_PATH}/${card.cardId}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {card.name}
                      </Link>
                      {card.company && (
                        <p className="truncate text-xs text-muted-foreground">{card.company}</p>
                      )}
                      {/* The scale travels with the number: "Score 85" alone
                          doesn't say what it is out of, and a fit judgement
                          read as a percentage is a different judgement. */}
                      {card.score !== null && (
                        <p className="text-xs tabular-nums text-muted-foreground">
                          Score {formatPipelineScore(card.score)}
                        </p>
                      )}
                      <div className="mt-1">
                        <MoveStageMenu
                          cardId={card.cardId}
                          stage={card.stage}
                          contactName={card.name}
                        />
                      </div>
                    </article>
                  ))
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
