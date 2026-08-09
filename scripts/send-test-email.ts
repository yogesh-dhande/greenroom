/**
 * Verification harness for the communications layer (spec.md §7).
 *
 * Exercises every built-in template and the full calendar-invite lifecycle
 * against the **dev** email transport, so nothing is actually delivered and
 * every rendered message can be opened and read. Run it after `npm run seed`:
 *
 *     npx tsx scripts/send-test-email.ts
 *
 * Output lands in `.dev-emails/` (gitignored):
 *   templates/*.txt|.html   every built-in template rendered with sample data
 *   NN-<kind>.txt           the transcript of each message the domain layer sent
 *   NN-<kind>.html          its HTML body
 *   NN-calendar_invite.ics  the attached iCalendar object
 *
 * Like scripts/seed.ts this talks to D1 exclusively through the
 * storage-agnostic repository layer, and gets its binding from wrangler's
 * `getPlatformProxy` — which resolves `configPath` relative to the calling
 * file, so this script has to stay inside the project tree.
 *
 * Exits non-zero if any generated .ics fails RFC validation, or if a template
 * renders with an unresolved merge field.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { getPlatformProxy } from "wrangler";
import { createD1Repos } from "@/db/repos/d1";
import type { Repos } from "@/db/repos";
import type { Event, Session, Submission } from "@/db/entities";
import {
  COMMS_TEMPLATE_IDS,
  type CommsContext,
  type CommsDelivery,
  COMMS_TEMPLATES,
  type MergeData,
  missingMergeFields,
  renderCommsTemplate,
  sendCalendarInvite,
  sendChangeRequest,
  sendDecisionEmail,
  sendSubmissionConfirmation,
  sendTaskDigest,
} from "@/domain/comms";
import { createDevEmailSender, DEV_EMAIL_DIR } from "@/lib/email";
import { inspectIcs, unfoldIcs } from "@/lib/ics";

const APP_URL = "http://localhost:3000";
const OUT_DIR = DEV_EMAIL_DIR;

let failures = 0;

function fail(message: string): void {
  failures += 1;
  console.error(`  ✗ ${message}`);
}

function ok(message: string): void {
  console.log(`  ✓ ${message}`);
}

function reportDeliveries(label: string, deliveries: CommsDelivery[]): void {
  for (const delivery of deliveries) {
    if (delivery.status === "sent") {
      ok(`${label} → ${delivery.to} — "${delivery.subject}"`);
    } else {
      fail(`${label} → ${delivery.to} failed: ${delivery.error}`);
    }
  }
  if (deliveries.length === 0) fail(`${label} produced no deliveries`);
}

// ---------------------------------------------------------------------------
// Phase A — render every built-in template with a complete sample dataset
// ---------------------------------------------------------------------------

const SAMPLE: MergeData = {
  speakerName: "Priya Raman",
  speakerFirstName: "Priya",
  eventName: "AI Engineer Summit 2026",
  eventDates: "June 16–18, 2026",
  eventLocation: "Moscone West, San Francisco",
  eventTimezone: "PDT",
  eventUrl: `${APP_URL}/e/ai-engineer-summit-2026`,
  organizerName: "The program team",
  organizerEmail: "hello@greenroom.dev",
  portalUrl: `${APP_URL}/portal`,
  submissionTitle: "Retrieval that survives production traffic",
  decisionNote: "Best retrieval submission this year. We'd like to open the track with it.",
  changeRequest:
    "Your abstract is currently 620 words; we print at 400. Could you trim it, and add one sentence on what attendees will be able to do afterwards?",
  changeDueDate: "Friday, May 1, 2026 at 5:00 PM PDT",
  sessionTitle: "Retrieval that survives production traffic",
  sessionWhen: "Tuesday, June 16, 2026, 10:00 AM – 10:45 AM PDT",
  sessionRoom: "Main Stage",
  sessionDuration: "45 minutes",
  taskTitle: "Upload your headshot",
  taskInstructions: "Square image, at least 800×800, on a plain background if possible.",
  taskDueDate: "Friday, June 5, 2026 at 5:00 PM PDT",
  outstandingTasks: "- Upload your headshot (due June 5)\n- Complete the A/V form (due June 12)",
};

async function renderAllTemplates(): Promise<void> {
  console.log("\nPhase A — built-in templates");
  await mkdir(`${OUT_DIR}/templates`, { recursive: true });

  for (const id of COMMS_TEMPLATE_IDS) {
    const template = COMMS_TEMPLATES[id];
    const rendered = renderCommsTemplate(id, SAMPLE);

    const missing = missingMergeFields(`${template.subject}\n${template.body}`, SAMPLE);
    if (missing.length) fail(`${id}: unresolved merge fields ${missing.join(", ")}`);

    if (/\{\{|\}\}/.test(rendered.text) || /\{\{|\}\}/.test(rendered.subject)) {
      fail(`${id}: template markup survived rendering`);
    }
    if (!rendered.text.trim()) fail(`${id}: empty text body`);
    if (!rendered.html.includes("<p")) fail(`${id}: HTML body has no paragraphs`);

    await writeFile(
      `${OUT_DIR}/templates/${id}.txt`,
      `Subject: ${rendered.subject}\nMerge fields: ${template.fields.join(", ")}\n\n${rendered.text}\n`,
      "utf8",
    );
    await writeFile(`${OUT_DIR}/templates/${id}.html`, rendered.html, "utf8");
    if (missing.length === 0) ok(`${id} — "${rendered.subject}"`);
  }

  // The conditional form has to read correctly in both directions: the
  // calendar-invite copy is sent before a room exists and again after.
  const withoutRoom = renderCommsTemplate("calendar_invite", { ...SAMPLE, sessionRoom: "" });
  if (!withoutRoom.text.includes("to be confirmed")) {
    fail("calendar_invite: the no-room variant lost its fallback copy");
  } else if (withoutRoom.text.includes("Room: Main Stage")) {
    fail("calendar_invite: the no-room variant still names a room");
  } else {
    ok("calendar_invite renders a sensible no-room variant");
  }
  await writeFile(`${OUT_DIR}/templates/calendar_invite.no-room.txt`, `${withoutRoom.text}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Phase B — the domain functions, end to end through the dev transport
// ---------------------------------------------------------------------------

interface Fixtures {
  event: Event;
  approved: Submission;
  waitlisted: Submission | undefined;
  declined: Submission | undefined;
  submitted: Submission | undefined;
  unscheduled: Session | undefined;
}

async function loadFixtures(repos: Repos): Promise<Fixtures> {
  const [event] = await repos.events.listAll();
  if (!event) throw new Error("No events found — run `npm run seed` first.");

  const [approvedList, waitlistedList, declinedList, submittedList, unscheduledList] =
    await Promise.all([
      repos.submissions.listByStatus(event.id, "approved"),
      repos.submissions.listByStatus(event.id, "maybe"),
      repos.submissions.listByStatus(event.id, "denied"),
      repos.submissions.listByStatus(event.id, "submitted"),
      repos.sessions.listUnscheduled(event.id),
    ]);
  if (!approvedList[0]) throw new Error("No approved submission in the database.");

  return {
    event,
    approved: approvedList[0],
    waitlisted: waitlistedList[0],
    declined: declinedList[0],
    submitted: submittedList[0],
    unscheduled: unscheduledList[0],
  };
}

async function exerciseDomain(ctx: CommsContext, fixtures: Fixtures): Promise<void> {
  console.log("\nPhase B — domain send functions (seeded data, dev transport)");

  if (fixtures.submitted) {
    reportDeliveries(
      "submission confirmation",
      await sendSubmissionConfirmation(ctx, { submissionId: fixtures.submitted.id }),
    );
  }
  reportDeliveries(
    "acceptance",
    await sendDecisionEmail(ctx, { submissionId: fixtures.approved.id }),
  );
  if (fixtures.waitlisted) {
    reportDeliveries(
      "waitlist",
      await sendDecisionEmail(ctx, { submissionId: fixtures.waitlisted.id }),
    );
  }
  if (fixtures.declined) {
    reportDeliveries(
      "decline",
      await sendDecisionEmail(ctx, { submissionId: fixtures.declined.id }),
    );
  }
  reportDeliveries(
    "change request",
    await sendChangeRequest(ctx, {
      submissionId: fixtures.submitted?.id ?? fixtures.approved.id,
      request: SAMPLE.changeRequest!,
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
  );

  // The weekly digest (D-039): one email per speaker, not one per task, so
  // the fixture is a speaker with anything still open rather than an
  // assignment.
  const [pending] = await ctx.repos.taskAssignments.listPendingByEvent(fixtures.event.id);
  if (pending) {
    reportDeliveries(
      "task digest",
      await sendTaskDigest(ctx, { eventId: fixtures.event.id, speakerId: pending.speakerId }),
    );
  } else {
    fail("no pending task assignment to build a digest from");
  }
}

// ---------------------------------------------------------------------------
// Phase C — the calendar-invite lifecycle
// ---------------------------------------------------------------------------

function icsProperty(ics: string, name: string): string[] {
  return unfoldIcs(ics)
    .filter((line) => line.toUpperCase().startsWith(`${name};`) || line.toUpperCase().startsWith(`${name}:`))
    .map((line) => line.slice(line.search(/[;:]/) + 1));
}

function validate(label: string, ics: string): void {
  const inspection = inspectIcs(ics, { method: "REQUEST" });
  for (const error of inspection.errors) fail(`${label}: ${error}`);
  for (const warning of inspection.warnings) console.log(`  ! ${label}: ${warning}`);
  if (inspection.ok) ok(`${label}: RFC 5545/5546 checks pass`);
}

async function exerciseCalendarInvite(ctx: CommsContext, fixtures: Fixtures): Promise<void> {
  console.log("\nPhase C — calendar invite: initial send, then room + time change");

  const session = fixtures.unscheduled;
  if (!session) {
    fail("no unscheduled session available for the invite lifecycle test");
    return;
  }
  const rooms = await ctx.repos.rooms.listByEvent(fixtures.event.id);
  if (!rooms[0]) {
    fail("event has no rooms");
    return;
  }

  // 1. Scheduled, but no room assigned yet (spec.md §7 explicitly requires
  //    being able to invite before a room exists).
  await ctx.repos.sessions.update(session.id, {
    day: fixtures.event.startDate ?? "2026-06-16",
    startTime: "15:00",
    endTime: "15:30",
    roomId: null,
  });
  const first = await sendCalendarInvite(ctx, { sessionId: session.id });
  reportDeliveries("invite (no room)", first);
  for (const delivery of first) {
    validate(`invite v${delivery.sequence}`, delivery.ics);
    // The venue is known before the room is, so LOCATION is the event venue
    // at this point; what must *not* be there yet is the room name.
    const location = icsProperty(delivery.ics, "LOCATION")[0] ?? "";
    if (location.includes(rooms[0].name)) {
      fail(`invite v0 names a room before one is assigned (LOCATION "${location}")`);
    } else {
      ok(`invite v0 LOCATION is the venue only: "${location || "(none)"}"`);
    }
  }

  // 2. Room assigned and the slot moved — the classic reason to re-send.
  await ctx.repos.sessions.update(session.id, {
    roomId: rooms[0].id,
    startTime: "16:00",
    endTime: "16:30",
  });
  const second = await sendCalendarInvite(ctx, { sessionId: session.id });
  reportDeliveries("invite (room assigned, time moved)", second);
  for (const delivery of second) validate(`invite v${delivery.sequence}`, delivery.ics);

  // 3. The property that makes it an *update* rather than a duplicate.
  for (const [index, updated] of second.entries()) {
    const original = first[index];
    if (!original) continue;
    if (original.uid !== updated.uid) {
      fail(`UID changed between sends (${original.uid} → ${updated.uid})`);
    } else if (updated.sequence <= original.sequence) {
      fail(`SEQUENCE did not advance (${original.sequence} → ${updated.sequence})`);
    } else if (icsProperty(updated.ics, "LOCATION").length === 0) {
      fail("the updated invite has no LOCATION even though a room is assigned");
    } else {
      ok(
        `${updated.to}: same UID ${updated.uid}, SEQUENCE ${original.sequence} → ${updated.sequence}, LOCATION "${icsProperty(updated.ics, "LOCATION")[0]}"`,
      );
    }
  }

  await writeFile(`${OUT_DIR}/invite-v0-no-room.ics`, first[0]?.ics ?? "", "utf8");
  await writeFile(`${OUT_DIR}/invite-v1-with-room.ics`, second[0]?.ics ?? "", "utf8");

  // A CANCEL for completeness — the withdrawal path uses the same UID.
  const cancelled = await sendCalendarInvite(ctx, { sessionId: session.id, method: "CANCEL" });
  for (const delivery of cancelled) {
    const inspection = inspectIcs(delivery.ics, { method: "CANCEL" });
    for (const error of inspection.errors) fail(`cancel: ${error}`);
    if (inspection.ok) ok(`cancel: METHOD:CANCEL, same UID ${delivery.uid}`);
  }
  await writeFile(`${OUT_DIR}/invite-cancel.ics`, cancelled[0]?.ics ?? "", "utf8");
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { env, dispose } = await getPlatformProxy<CloudflareEnv>({
    configPath: "./wrangler.jsonc",
  });

  try {
    await rm(OUT_DIR, { recursive: true, force: true });
    await mkdir(OUT_DIR, { recursive: true });

    const repos = createD1Repos(env.DB);
    const ctx: CommsContext = {
      repos,
      // `echo: false` keeps the report readable; every message is on disk.
      sender: createDevEmailSender({
        from: { name: "AI Engineer Summit", email: "hello@greenroom.dev" },
        directory: OUT_DIR,
        echo: false,
      }),
      appUrl: APP_URL,
      uidDomain: "greenroom.dev",
    };

    await renderAllTemplates();
    const fixtures = await loadFixtures(repos);
    await exerciseDomain(ctx, fixtures);
    await exerciseCalendarInvite(ctx, fixtures);

    const logged = await repos.emailLog.listRecent(100);
    console.log(`\nemail_log now holds ${logged.length} recent rows (all sends were recorded).`);
    console.log(`Rendered messages, HTML bodies and .ics files are in ${OUT_DIR}/`);
  } finally {
    await dispose();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll checks passed.");
  }
}

void main();
