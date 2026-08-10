"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isCommsTemplateId, type CommsTemplateId } from "@/domain/comms-templates";
import {
  checkTemplateDraft,
  COMMS_TEMPLATES,
  MANUAL_MERGE_FIELDS,
  REMINDER_SKIP_LABELS,
  runReminderJob,
  sendCalendarInvite,
  sendManualEmail,
  speakerMergeData,
  TEMPLATE_MERGE_FIELDS,
  TEMPLATE_TRIGGERS,
  type ReminderSkipReason,
} from "@/domain/comms";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

/**
 * Writes behind the admin Communications screen (spec.md §7).
 *
 * Everything here sends mail as the event, or changes the words the event
 * will use next time it does — so every action is admin-only, matching the
 * rule decisions.md D-025 already applies to change requests and decisions.
 * A reviewer can read the log; they can't speak for the programme.
 *
 * Each action re-derives the event and re-checks the viewer rather than
 * trusting the page that rendered the button: a server action is a public
 * endpoint.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

/**
 * The signature line for mail this admin triggers by hand — the sending
 * admin's own display name, not the `DEFAULT_ORGANIZER_NAME` fallback
 * (decisions.md D-053: "{{organizerName}}" must not read "The program team"
 * for a real, admin-initiated send). Automated/cron sends have no acting
 * user and keep the fallback (see `runReminderJob`'s scheduled call sites).
 */
function organizerNameFor(viewer: { name: string | null; email: string }): string {
  return viewer.name?.trim() || viewer.email;
}

/**
 * The `{{organizerEmail}}` merge token for mail this admin triggers by hand -
 * the acting admin's own address, not the no-reply transport address (same
 * rationale as `organizerNameFor`, extended to the reply address: see
 * `CommsContext.organizerEmail` in src/domain/comms.ts).
 */
function organizerEmailFor(viewer: { email: string }): string {
  return viewer.email;
}

async function authorize(eventSlug: string) {
  const viewer = await requireAdmin(`/admin/${eventSlug}/communications`);
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return { ok: false as const, error: "Event not found" };
  return { ok: true as const, repos, event, viewer };
}

// ---------------------------------------------------------------------------
// One-off messages
// ---------------------------------------------------------------------------

const manualEmailSchema = z.object({
  /** User ids of the speakers to write to. */
  recipientIds: z.array(z.string()).min(1, "Pick at least one recipient"),
  subject: z.string().trim().min(1, "Give the message a subject").max(200, "That subject is too long"),
  body: z.string().trim().min(1, "The message body can't be empty").max(20_000, "That message is too long"),
});
export type ManualEmailInputData = z.infer<typeof manualEmailSchema>;

/**
 * Sends an organizer-composed message to one or more of the event's speakers
 * (spec.md §7's manual path).
 *
 * The merge data is assembled **per recipient**, so one composition addressed
 * to eight people produces eight personalised emails rather than one message
 * with eight names on it — and each lands in that speaker's own
 * communication log.
 */
export async function sendComposedEmail(eventSlug: string, input: ManualEmailInputData) {
  const auth = await authorize(eventSlug);
  if (!auth.ok) return fail(auth.error);

  const parsed = manualEmailSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid message");

  // The same validation the composer runs live, re-run server-side: a draft
  // referencing a field this path can't fill would arrive with a hole in it.
  const check = checkTemplateDraft(parsed.data.subject, parsed.data.body, MANUAL_MERGE_FIELDS);
  if (check.errors.length > 0) return fail(check.errors[0]);

  const recipients = await auth.repos.users.listByIds(parsed.data.recipientIds);
  if (recipients.length === 0) return fail("Couldn't find those recipients");

  const comms = await getCommsContext({
    repos: auth.repos,
    organizerName: organizerNameFor(auth.viewer),
    organizerEmail: organizerEmailFor(auth.viewer),
  });

  let sent = 0;
  const failures: string[] = [];
  for (const user of recipients) {
    try {
      const data = await speakerMergeData(comms, auth.event, user);
      const delivery = await sendManualEmail(comms, {
        template: { subject: parsed.data.subject, body: parsed.data.body },
        to: user.email,
        data,
        log: { kind: "manual", relatedType: "user", relatedId: user.id },
      });
      if (delivery.status === "sent") sent += 1;
      else failures.push(`${user.email}: ${delivery.error ?? "delivery failed"}`);
    } catch (error) {
      failures.push(`${user.email}: ${error instanceof Error ? error.message : "send failed"}`);
    }
  }

  revalidatePath(`/admin/${eventSlug}/communications`);
  return { ok: true as const, data: { sent, failed: failures.length, failures } };
}

// ---------------------------------------------------------------------------
// Template overrides
// ---------------------------------------------------------------------------

const templateSaveSchema = z.object({
  templateId: z.string().refine(isCommsTemplateId, "Unknown template"),
  subject: z.string().max(200, "That subject is too long"),
  body: z.string().max(20_000, "That message is too long"),
});
export type TemplateSaveInput = z.infer<typeof templateSaveSchema>;

/** The event's `email_templates` row overriding `templateId`, if it has one. */
async function findOverride(
  repos: Awaited<ReturnType<typeof getRepos>>,
  eventId: string,
  templateId: CommsTemplateId,
) {
  const rows = await repos.emailTemplates.listByEvent(eventId);
  return rows.find((row) => row.name === templateId) ?? null;
}

/**
 * Saves an event's own wording for one of the built-in templates.
 *
 * Merge fields are validated before anything is written (decisions.md D-020 —
 * "the admin UI validates fields before saving"). A template is used for
 * every future send of its kind, so a typo'd `{{speakername}}` would blank a
 * sentence in mail nobody proofreads again; refusing the save is the only
 * point at which a human is still looking.
 */
export async function saveTemplateOverride(eventSlug: string, input: TemplateSaveInput) {
  const auth = await authorize(eventSlug);
  if (!auth.ok) return fail(auth.error);

  const parsed = templateSaveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid template");

  const templateId = parsed.data.templateId as CommsTemplateId;
  const check = checkTemplateDraft(
    parsed.data.subject,
    parsed.data.body,
    TEMPLATE_MERGE_FIELDS[templateId],
  );
  if (check.errors.length > 0) return fail(check.errors[0]);

  const existing = await findOverride(auth.repos, auth.event.id, templateId);
  try {
    if (existing) {
      await auth.repos.emailTemplates.update(existing.id, {
        subject: parsed.data.subject,
        body: parsed.data.body,
      });
    } else {
      await auth.repos.emailTemplates.create({
        eventId: auth.event.id,
        // The join key back to the built-in template (see
        // `resolveCommsTemplate` in src/domain/comms-templates.ts).
        name: templateId,
        subject: parsed.data.subject,
        body: parsed.data.body,
        trigger: TEMPLATE_TRIGGERS[templateId],
      });
    }
  } catch {
    return fail("Couldn't save the template — try again");
  }

  revalidatePath(`/admin/${eventSlug}/communications`);
  return { ok: true as const, data: { templateId } };
}

/** Drops the event's override so the built-in wording applies again. */
export async function resetTemplateOverride(eventSlug: string, templateId: string) {
  const auth = await authorize(eventSlug);
  if (!auth.ok) return fail(auth.error);
  if (!isCommsTemplateId(templateId)) return fail("Unknown template");

  const existing = await findOverride(auth.repos, auth.event.id, templateId);
  if (existing) {
    try {
      await auth.repos.emailTemplates.delete(existing.id);
    } catch {
      return fail("Couldn't reset the template — try again");
    }
  }

  revalidatePath(`/admin/${eventSlug}/communications`);
  const builtIn = COMMS_TEMPLATES[templateId];
  return {
    ok: true as const,
    data: { templateId, subject: builtIn.subject, body: builtIn.body },
  };
}

// ---------------------------------------------------------------------------
// Calendar invites
// ---------------------------------------------------------------------------

/**
 * Sends — or re-sends — the `.ics` invitation for one session (spec.md §7,
 * decisions.md D-020).
 *
 * Re-sending is the whole point rather than an edge case: the invite goes out
 * before a room is assigned, and again after, with the same UID and a higher
 * SEQUENCE so the speaker's existing calendar entry updates in place instead
 * of a second one appearing.
 */
export async function sendSessionInvite(eventSlug: string, sessionId: string) {
  const auth = await authorize(eventSlug);
  if (!auth.ok) return fail(auth.error);

  const session = await auth.repos.sessions.getById(sessionId);
  if (!session || session.eventId !== auth.event.id) return fail("Session not found");

  const comms = await getCommsContext({
    repos: auth.repos,
    organizerName: organizerNameFor(auth.viewer),
    organizerEmail: organizerEmailFor(auth.viewer),
  });

  let deliveries;
  try {
    deliveries = await sendCalendarInvite(comms, { sessionId });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Couldn't send the invitation");
  }

  revalidatePath(`/admin/${eventSlug}/communications`);

  const failed = deliveries.filter((delivery) => delivery.status === "failed");
  return {
    ok: true as const,
    data: {
      sent: deliveries.length - failed.length,
      failed: failed.length,
      /** 0 on a first send; higher on every update — what makes it an update. */
      sequence: Math.max(...deliveries.map((delivery) => delivery.sequence), 0),
      recipients: deliveries.filter((d) => d.status === "sent").map((d) => d.to),
    },
  };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/**
 * Sends this event's task digests on demand — the same `runReminderJob` the
 * cron calls (decisions.md D-013, D-039), so the button can never send
 * something the schedule wouldn't.
 *
 * `manual: true` is the only difference: it lifts the Monday 07:00 UTC window
 * (an admin pressing a button means "now"), and swaps the six-day cooldown for
 * a 24-hour one. Everything else still protects the speaker — a double-click
 * sends nothing the second time, and a cleared checklist sends nothing at all.
 */
export async function sendRemindersNow(eventSlug: string) {
  const auth = await authorize(eventSlug);
  if (!auth.ok) return fail(auth.error);

  const comms = await getCommsContext({
    repos: auth.repos,
    organizerName: organizerNameFor(auth.viewer),
    organizerEmail: organizerEmailFor(auth.viewer),
  });

  let result;
  try {
    result = await runReminderJob({ ...comms, eventId: auth.event.id, manual: true });
  } catch {
    return fail("Couldn't send the digests — try again");
  }

  revalidatePath(`/admin/${eventSlug}/communications`);

  const skipNotes = (Object.entries(result.skippedByReason) as Array<[ReminderSkipReason, number]>)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${REMINDER_SKIP_LABELS[reason]}`);

  return {
    ok: true as const,
    data: {
      sent: result.remindersSent,
      failed: result.remindersFailed,
      skipped: result.skipped,
      /** "3 nothing outstanding, 2 already emailed recently" */
      skipSummary: skipNotes.join(", "),
      recipients: result.sentTo,
    },
  };
}
