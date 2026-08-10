"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PIPELINE_STAGE_LABELS, isPipelineStage } from "@/domain/pipeline";
import { contactDisplayName } from "@/domain/crm";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

/**
 * Writes for the sourcing pipeline (spec.md "Org-level speaker CRM",
 * decisions.md D-077).
 *
 * Every action re-guards with `requireAdmin` rather than trusting the (org)
 * layout: a server action is a public endpoint, and the layout only guards
 * the render. The CRM is org-scoped, so the guard is the plain admin check —
 * there is no event to check access against.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

const BOARD_PATH = "/admin/pipeline";
const OVERVIEW_PATH = "/admin/crm";
const DIRECTORY_PATH = "/admin/directory";

/** The board, the overview KPIs and the directory's pipeline badges all read
 * the same cards, so a card write invalidates all three. */
function revalidateBoard(cardId?: string) {
  revalidatePath(BOARD_PATH);
  if (cardId) revalidatePath(`${BOARD_PATH}/${cardId}`);
  revalidatePath(OVERVIEW_PATH);
  revalidatePath(DIRECTORY_PATH);
}

// ---------------------------------------------------------------------------
// Enroll
// ---------------------------------------------------------------------------

/**
 * `stage` arrives as a plain string and is narrowed with `isPipelineStage`
 * rather than parsed by the entity enum, so an unknown value produces the
 * organizer-facing sentence below instead of a zod union error.
 *
 * `score` is deliberately 0-100 and integral: it is a fit judgement an
 * organizer types, not a computed metric, and a bounded whole number is what
 * the card renders ("Score 85").
 */
const enrollInputSchema = z.object({
  userId: z.string().trim().min(1, "Pick a contact to enroll"),
  stage: z.string(),
  score: z
    .number()
    .int("Score must be a whole number")
    .min(0, "Score must be between 0 and 100")
    .max(100, "Score must be between 0 and 100")
    .nullable()
    .optional(),
  rationale: z
    .string()
    .trim()
    .max(2000, "Keep the rationale under 2000 characters")
    .nullable()
    .optional(),
});
export type EnrollProspectInput = z.infer<typeof enrollInputSchema>;

/**
 * Puts a directory contact on the board.
 *
 * One card per contact is a uniqueness rule the repo enforces, so this checks
 * `getCardByUser` first and answers with a sentence an organizer can act on
 * ("... is already on the board") rather than letting a constraint violation
 * surface as a 500.
 */
export async function enrollProspect(
  input: EnrollProspectInput,
): Promise<
  { ok: true; data: { cardId: string; message: string } } | { ok: false; error: string }
> {
  const viewer = await requireAdmin(BOARD_PATH);

  const parsed = enrollInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and retry");
  const { userId, stage, score, rationale } = parsed.data;
  if (!isPipelineStage(stage)) return fail("Pick a pipeline stage");

  const repos = await getRepos();

  const contact = await repos.users.getById(userId);
  if (!contact) return fail("That contact no longer exists");

  const existing = await repos.pipeline.getCardByUser(userId);
  if (existing) {
    const name = contactDisplayName({ name: contact.name, email: contact.email });
    return fail(
      `${name} is already on the board in ${PIPELINE_STAGE_LABELS[existing.stage]}. Move that card instead.`,
    );
  }

  const { card } = await repos.pipeline.enroll({
    userId,
    stage,
    score: score ?? null,
    rationale: rationale?.trim() ? rationale.trim() : null,
    actorUserId: viewer.id,
  });

  revalidateBoard(card.id);
  const name = contactDisplayName({ name: contact.name, email: contact.email });
  return {
    ok: true,
    data: {
      cardId: card.id,
      message: `${name} added to ${PIPELINE_STAGE_LABELS[stage]}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Move stage
// ---------------------------------------------------------------------------

const moveStageInputSchema = z.object({
  cardId: z.string().trim().min(1, "Pick a card to move"),
  toStage: z.string(),
});
export type MovePipelineStageInput = z.infer<typeof moveStageInputSchema>;

/**
 * Moves a card to another stage, recording the transition.
 *
 * Re-selecting the stage a card already occupies is a silent no-op (the repo
 * writes nothing and returns a null stage event, per `planStageMove`), so the
 * organizer gets the same green confirmation and the history stays a record of
 * things that actually happened.
 */
export async function movePipelineStage(
  input: MovePipelineStageInput,
): Promise<{ ok: true; data: { message: string } } | { ok: false; error: string }> {
  const viewer = await requireAdmin(BOARD_PATH);

  const parsed = moveStageInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and retry");
  const { cardId, toStage } = parsed.data;
  if (!isPipelineStage(toStage)) return fail("Pick a pipeline stage");

  const repos = await getRepos();
  const card = await repos.pipeline.getCard(cardId);
  if (!card) return fail("That card is no longer on the board");

  await repos.pipeline.moveStage(cardId, toStage, viewer.id);

  revalidateBoard(cardId);
  return { ok: true, data: { message: `Moved to ${PIPELINE_STAGE_LABELS[toStage]}` } };
}

// ---------------------------------------------------------------------------
// Internal notes
// ---------------------------------------------------------------------------

const addNoteInputSchema = z.object({
  cardId: z.string().trim().min(1),
  body: z
    .string()
    .trim()
    .min(1, "Write a note first")
    .max(4000, "Keep the note under 4000 characters"),
});
export type AddContactNoteInput = z.infer<typeof addNoteInputSchema>;

/**
 * Adds an org-level internal note about the contact behind a card.
 *
 * The note is written against the *contact*, not the card: notes outlive the
 * board (a declined prospect re-approached next year keeps last year's
 * context), and the contact profile shows the same list. The card id is the
 * argument only because that is what the detail page knows.
 */
export async function addContactNote(
  input: AddContactNoteInput,
): Promise<{ ok: true; data: { message: string } } | { ok: false; error: string }> {
  const viewer = await requireAdmin(BOARD_PATH);

  const parsed = addNoteInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and retry");
  const { cardId, body } = parsed.data;

  const repos = await getRepos();
  const card = await repos.pipeline.getCard(cardId);
  if (!card) return fail("That card is no longer on the board");

  await repos.contacts.addNote({
    userId: card.userId,
    authorUserId: viewer.id,
    body,
  });

  revalidateBoard(cardId);
  return { ok: true, data: { message: "Note added" } };
}
