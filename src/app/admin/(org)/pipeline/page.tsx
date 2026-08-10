import Link from "next/link";
import type { PipelineCard } from "@/db/entities";
import type { DirectoryContact } from "@/db/repos/contacts";
import { contactDisplayName } from "@/domain/crm";
import { PIPELINE_STAGES, PIPELINE_STAGE_LABELS } from "@/domain/pipeline";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { EnrollProspectDialog, type EnrollCandidate } from "./enroll-prospect-dialog";
import { MoveStageMenu } from "./move-stage-menu";

/** What one card renders — resolved server-side so the board is plain markup. */
interface BoardCard {
  id: string;
  name: string;
  company: string | null;
  score: number | null;
  stage: PipelineCard["stage"];
}

/**
 * The sourcing board (spec.md "Org-level speaker CRM", decisions.md D-077):
 * five stage columns, one card per enrolled contact, moved by an explicit
 * control rather than a drag gesture.
 *
 * Identity comes from the directory rather than from the card, because a card
 * stores a `userId` and nothing else — names and companies live on the person,
 * so a contact who changes employer is right on the board without a backfill.
 * The `users.listByIds` fallback covers the one case the directory can't: a
 * card whose contact is neither a speaker anywhere nor in the registry, which
 * shouldn't happen but must not blank out a card if it does.
 */
export default async function PipelinePage() {
  await requireAdmin("/admin/pipeline");
  const repos = await getRepos();

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

  const boardCards: BoardCard[] = cards.map((card) => {
    const contact = contactsByUser.get(card.userId);
    return {
      id: card.id,
      name: contact ? contactDisplayName(contact) : "Unknown contact",
      company: contact?.company ?? null,
      score: card.score,
      stage: card.stage,
    };
  });

  const enrolledUserIds = new Set(cards.map((card) => card.userId));
  const candidates: EnrollCandidate[] = contacts
    .filter((contact) => !enrolledUserIds.has(contact.userId))
    .map((contact) => ({
      userId: contact.userId,
      label: `${contactDisplayName(contact)} (${contact.email})`,
    }));

  return (
    <div>
      <PageHeader
        title="Sourcing pipeline"
        description="Prospective speakers across every event, from first sighting to a confirmed yes."
        action={<EnrollProspectDialog candidates={candidates} />}
      />

      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {PIPELINE_STAGES.map((stage) => {
          const columnCards = boardCards.filter((card) => card.stage === stage);
          return (
            <section
              key={stage}
              aria-label={`${PIPELINE_STAGE_LABELS[stage]} stage`}
              className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
            >
              <header className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  {PIPELINE_STAGE_LABELS[stage]}
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {columnCards.length}
                </span>
              </header>

              {columnCards.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  No prospects
                </p>
              ) : (
                columnCards.map((card) => (
                  <article
                    key={card.id}
                    className="flex flex-col gap-1 rounded-md border border-border bg-background p-3"
                  >
                    <Link
                      href={`/admin/pipeline/${card.id}`}
                      className="text-sm font-medium text-foreground hover:underline"
                    >
                      {card.name}
                    </Link>
                    {card.company && (
                      <p className="truncate text-xs text-muted-foreground">{card.company}</p>
                    )}
                    {card.score !== null && (
                      <p className="text-xs tabular-nums text-muted-foreground">
                        Score {card.score}
                      </p>
                    )}
                    <div className="mt-1">
                      <MoveStageMenu
                        cardId={card.id}
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
    </div>
  );
}
