/**
 * Built-in speaker email templates and the merge-field renderer behind them
 * (spec.md §7 — "templated messages with merge fields").
 *
 * Pure TypeScript: no datastore imports, no I/O. src/domain/comms.ts
 * assembles the merge data from repository reads and hands it here.
 *
 * Each template is written **once, as plain text**. `renderCommsTemplate`
 * produces the text body verbatim and derives the HTML body from the same
 * copy, so the two can never drift apart. Templating is deliberately tiny
 * (decisions.md D-008 allows a library, but none is installed and none is
 * warranted for `{{field}}` substitution plus one conditional form):
 *
 *   `{{field}}`                 — substitute, empty string when unset
 *   `{{#field}}…{{/field}}`     — include only when the field is non-empty
 *   `{{^field}}…{{/field}}`     — include only when the field is empty
 *
 * The conditional form exists for a real requirement rather than for
 * generality: a calendar invite may go out before a room is assigned
 * (spec.md §7), so the copy has to read well both with and without a room.
 */
import type { EmailKind, EmailTrigger } from "@/db/entities";

// ---------------------------------------------------------------------------
// Merge fields
// ---------------------------------------------------------------------------

/** Every placeholder the built-in copy may reference. Also the list an admin
 * template editor should offer (a later wave). */
export const MERGE_FIELDS = [
  "speakerName",
  "speakerFirstName",
  "eventName",
  "eventDates",
  "eventLocation",
  "eventTimezone",
  "eventUrl",
  "organizerName",
  "organizerEmail",
  "portalUrl",
  "submissionTitle",
  "submissionUrl",
  /** Magic link back into an unfinished draft proposal (D-034, D-038). */
  "resumeUrl",
  "decisionNote",
  "changeRequest",
  "changeDueDate",
  "sessionTitle",
  "sessionWhen",
  "sessionRoom",
  "sessionDuration",
  "taskTitle",
  "taskInstructions",
  "taskDueDate",
  "outstandingTasks",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeData = Partial<Record<MergeField, string>>;

const MERGE_FIELD_SET = new Set<string>(MERGE_FIELDS);

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const TAG_RE = /\{\{\s*(\w+)\s*\}\}/g;
/** An inline section: `{{#room}} in {{room}}{{/room}}` inside a sentence. */
const SECTION_RE = /\{\{([#^])\s*(\w+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g;
/**
 * A section whose opening and closing tags each sit alone on their own line.
 * Both tag *lines* (newline included) are consumed, so blank lines on either
 * side of the block survive — which is what keeps paragraph breaks intact
 * whether the section is kept or dropped. Mustache calls these "standalone"
 * tags and treats them the same way; a naive strip that eats only the tag
 * and leaves its newline silently welds two paragraphs together.
 */
const STANDALONE_SECTION_RE =
  /^[ \t]*\{\{([#^])\s*(\w+)\s*\}\}[ \t]*\r?\n([\s\S]*?)^[ \t]*\{\{\/\s*\2\s*\}\}[ \t]*\r?\n/gm;

function keep(kind: string, key: string, data: MergeData): boolean {
  const present = Boolean(data[key as MergeField]?.trim());
  return (kind === "#") === present;
}

function applySections(source: string, data: MergeData): string {
  let current = source;
  let previous = "";
  // Loop so nested sections resolve outside-in.
  while (current !== previous) {
    previous = current;
    current = current
      .replace(STANDALONE_SECTION_RE, (_match, kind: string, key: string, inner: string) =>
        keep(kind, key, data) ? inner : "",
      )
      .replace(SECTION_RE, (_match, kind: string, key: string, inner: string) =>
        keep(kind, key, data) ? inner : "",
      );
  }
  return current;
}

function substitute(source: string, data: MergeData): string {
  return source.replace(TAG_RE, (_match, key: string) => data[key as MergeField] ?? "");
}

/** Trailing whitespace and runs of blank lines are an artifact of dropped
 * conditional sections, not of the copy. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderText(source: string, data: MergeData): string {
  return tidy(substitute(applySections(source, data), data));
}

/** Subjects are single-line: sections apply, newlines don't. */
export function renderSubject(source: string, data: MergeData): string {
  return substitute(applySections(source, data), data).replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/g;

function autolink(escaped: string): string {
  return escaped.replace(
    URL_RE,
    (url) => `<a href="${url}" style="color:#0f766e;text-decoration:underline">${url}</a>`,
  );
}

const HTML_STYLES = {
  wrapper:
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1917;max-width:560px;margin:0 auto;padding:24px",
  paragraph: "margin:0 0 16px",
  list: "margin:0 0 16px;padding-left:20px",
  item: "margin:0 0 6px",
} as const;

/**
 * Turns the rendered plain-text body into a simple, email-client-safe HTML
 * body: blank-line-separated blocks become paragraphs, `- ` blocks become
 * lists, and bare URLs become links. Styling is inline because every mail
 * client strips `<style>` blocks — this is the one place in the codebase
 * that can't use the shared design tokens (decisions.md D-018).
 */
export function textToHtml(text: string): string {
  const blocks = text.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      const items = lines
        .map(
          (line) =>
            `<li style="${HTML_STYLES.item}">${autolink(escapeHtml(line.replace(/^\s*[-*]\s+/, "")))}</li>`,
        )
        .join("");
      return `<ul style="${HTML_STYLES.list}">${items}</ul>`;
    }
    const body = lines.map((line) => autolink(escapeHtml(line))).join("<br>");
    return `<p style="${HTML_STYLES.paragraph}">${body}</p>`;
  });
  return `<div style="${HTML_STYLES.wrapper}">${blocks.join("")}</div>`;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Renders any `{subject, body}` pair — the built-in templates below, or a
 * row from the `email_templates` table an organizer edited. */
export function renderMessage(
  source: { subject: string; body: string },
  data: MergeData,
): RenderedEmail {
  const text = renderText(source.body, data);
  return { subject: renderSubject(source.subject, data), text, html: textToHtml(text) };
}

/** Placeholders in `source` that `data` has no value for — a template editor
 * would surface these as "this message will have gaps". */
export function missingMergeFields(source: string, data: MergeData): MergeField[] {
  const missing = new Set<MergeField>();
  for (const match of source.matchAll(TAG_RE)) {
    const key = match[1];
    if (MERGE_FIELD_SET.has(key) && !data[key as MergeField]?.trim()) {
      missing.add(key as MergeField);
    }
  }
  return [...missing];
}

/** Merge fields referenced anywhere in a template's copy. */
export function mergeFieldsUsed(source: string): MergeField[] {
  const used = new Set<MergeField>();
  for (const match of source.matchAll(/\{\{[#^/]?\s*(\w+)\s*\}\}/g)) {
    if (MERGE_FIELD_SET.has(match[1])) used.add(match[1] as MergeField);
  }
  return [...used];
}

// ---------------------------------------------------------------------------
// The built-in templates
// ---------------------------------------------------------------------------

export const COMMS_TEMPLATE_IDS = [
  "submission_confirmation",
  "draft_saved",
  "draft_reminder",
  "submission_accepted",
  "submission_waitlisted",
  "submission_declined",
  "change_request",
  "task_reminder",
  "calendar_invite",
] as const;

export type CommsTemplateId = (typeof COMMS_TEMPLATE_IDS)[number];

export interface CommsTemplate {
  id: CommsTemplateId;
  /** Shown in the admin communications UI. */
  name: string;
  description: string;
  /** How the send is classified in `email_log`. */
  kind: EmailKind;
  subject: string;
  body: string;
  /** Derived from the copy at module load so the two never disagree. */
  fields: MergeField[];
}

type TemplateSeed = Omit<CommsTemplate, "fields">;

const SEEDS: TemplateSeed[] = [
  {
    id: "submission_confirmation",
    name: "Submission received",
    description: "Sent to the submitter the moment a proposal comes in through a public CFP form.",
    kind: "submission_confirmation",
    subject: "We've received your proposal — {{submissionTitle}}",
    body: `Hi {{speakerFirstName}},

Thanks for proposing "{{submissionTitle}}" for {{eventName}}. It's in, and it's in front of the right people.

Here's what happens next. Our review committee reads every proposal in the tracks you selected, and we'll email you as soon as there's a decision — whichever way it goes.

{{#changeDueDate}}
You can keep editing your proposal until {{changeDueDate}}.

{{/changeDueDate}}
Review or update it any time from your speaker portal:

{{portalUrl}}

Thanks for offering to share your work with our audience.

{{organizerName}}
{{eventName}}`,
  },
  {
    id: "draft_saved",
    name: "Draft saved",
    description:
      "Carries the link back to an unfinished proposal, saved from the public CFP form (D-034).",
    kind: "draft_saved",
    subject: 'Your draft proposal for {{eventName}} — "{{submissionTitle}}"',
    body: `Hi {{speakerFirstName}},

We've saved your proposal as a draft. Nothing has been submitted yet — the review committee can't see it, and you can change anything you like before you send it.

Pick up where you left off here:

{{resumeUrl}}

Keep this link: it's how you get back in, so there's no password to remember.

{{#changeDueDate}}
Submissions for {{eventName}} close on {{changeDueDate}}. A draft that isn't submitted by then doesn't go to the committee.

{{/changeDueDate}}
{{organizerName}}
{{eventName}}`,
  },
  {
    id: "draft_reminder",
    name: "Draft closing soon",
    description:
      "One nudge when a form with an unsubmitted draft on it is about to close (D-034). Sent by the reminder cron.",
    kind: "draft_reminder",
    subject: 'Submissions close soon — your draft "{{submissionTitle}}" isn\'t in yet',
    body: `Hi {{speakerFirstName}},

You started a proposal for {{eventName}} and saved it as a draft, but it hasn't been submitted{{#changeDueDate}}, and submissions close on {{changeDueDate}}{{/changeDueDate}}.

If you still want it considered, open it and hit submit — it's the same link as before:

{{resumeUrl}}

If you've changed your mind, no action needed; this is the only reminder we'll send.

{{organizerName}}
{{eventName}}`,
  },
  {
    id: "submission_accepted",
    name: "Proposal accepted",
    description: "Acceptance notice; pairs with the onboarding tasks created on acceptance.",
    kind: "decision",
    subject: "Your talk is in — {{eventName}}",
    body: `Hi {{speakerFirstName}},

Good news: "{{submissionTitle}}" has been accepted for {{eventName}}{{#eventDates}}, {{eventDates}}{{/eventDates}}{{#eventLocation}}, {{eventLocation}}{{/eventLocation}}. We'd love to have you on the program.

{{#decisionNote}}
A note from the review committee:

{{decisionNote}}

{{/decisionNote}}
To confirm your place, sign in to your speaker portal and work through the checklist waiting for you there — it covers the bio, headshot, and session details we need before we can publish the schedule.

{{portalUrl}}

{{#outstandingTasks}}
Still outstanding:

{{outstandingTasks}}

{{/outstandingTasks}}
{{#sessionWhen}}
Your session is currently slated for {{sessionWhen}}{{#sessionRoom}} in {{sessionRoom}}{{/sessionRoom}}. We'll send a calendar invitation, and an updated one if anything moves.

{{/sessionWhen}}
{{^sessionWhen}}
We're still building the schedule. You'll get a calendar invitation as soon as your session has a slot.

{{/sessionWhen}}
Congratulations — and welcome to the lineup.

{{organizerName}}
{{eventName}}`,
  },
  {
    id: "submission_waitlisted",
    name: "Proposal waitlisted",
    description: 'For the "maybe" decision: a strong proposal held pending schedule space.',
    kind: "decision",
    subject: "An update on your {{eventName}} proposal",
    body: `Hi {{speakerFirstName}},

Thank you for proposing "{{submissionTitle}}" for {{eventName}}. The committee rated it highly, but we have more strong proposals than slots, so we're holding it on our shortlist while the schedule settles.

{{#decisionNote}}
A note from the review committee:

{{decisionNote}}

{{/decisionNote}}
Practically, that means: nothing is required from you right now, and we'll come back to you with a yes or a no as soon as the schedule settles. If your availability changes in the meantime, just reply to this email.

We know a maybe is the least satisfying answer. Thank you for your patience with it.

{{organizerName}}
{{eventName}}`,
  },
  {
    id: "submission_declined",
    name: "Proposal declined",
    description: "Decline notice. Warm and specific; no false hope.",
    kind: "decision",
    subject: "An update on your {{eventName}} proposal",
    body: `Hi {{speakerFirstName}},

Thank you for proposing "{{submissionTitle}}" for {{eventName}}, and for the work that went into it.

We weren't able to find a place for it on this year's program. That's a reflection of how much we received rather than of your proposal — the committee had to turn down talks it genuinely wanted to run.

{{#decisionNote}}
Feedback from the review committee:

{{decisionNote}}

{{/decisionNote}}
We'd be glad to see you submit again next time{{#eventUrl}}, and you're very welcome to join us as an attendee: {{eventUrl}}{{/eventUrl}}.

Thank you again for thinking of us.

{{organizerName}}
{{eventName}}`,
  },
  {
    id: "change_request",
    name: "Change / missing information request",
    description: "Asks the submitter to fix or supply something before review can continue.",
    kind: "change_request",
    subject: 'A quick change needed on "{{submissionTitle}}"',
    body: `Hi {{speakerFirstName}},

We're reviewing "{{submissionTitle}}" for {{eventName}} and need one thing from you before we can go further:

{{changeRequest}}

You can make the change yourself — this link opens your proposal, ready to edit:

{{submissionUrl}}

{{#changeDueDate}}
Please do it by {{changeDueDate}} so your proposal stays in this review round.

{{/changeDueDate}}
If anything is unclear, just reply to this email and we'll sort it out.

{{organizerName}}
{{eventName}}`,
  },
  {
    id: "task_reminder",
    name: "Task / deadline reminder",
    description: "Nudge for an outstanding onboarding task; sent by the reminder cron (D-013).",
    kind: "task_reminder",
    subject: "Reminder: {{taskTitle}}",
    body: `Hi {{speakerFirstName}},

One item on your {{eventName}} speaker checklist is still open:

{{taskTitle}}{{#taskDueDate}} — due {{taskDueDate}}{{/taskDueDate}}

{{#taskInstructions}}
{{taskInstructions}}

{{/taskInstructions}}
It should take a couple of minutes:

{{portalUrl}}

{{#outstandingTasks}}
While you're there, these are also still open:

{{outstandingTasks}}

{{/outstandingTasks}}
If something is blocking you, reply and tell us — we'd rather know early.

{{organizerName}}
{{eventName}}`,
  },
  {
    id: "calendar_invite",
    name: "Calendar invitation",
    description:
      "Cover note for the .ics invite (D-003). Reads correctly with or without a room assigned.",
    kind: "calendar_invite",
    subject: "Your session at {{eventName}}: {{sessionTitle}}",
    body: `Hi {{speakerFirstName}},

Here are the confirmed details for your session at {{eventName}}. A calendar invitation is attached — accept it and the session will land in your calendar{{#sessionRoom}}, room included{{/sessionRoom}}.

{{sessionTitle}}
{{sessionWhen}}{{#sessionDuration}} ({{sessionDuration}}){{/sessionDuration}}
{{#sessionRoom}}
Room: {{sessionRoom}}
{{/sessionRoom}}
{{^sessionRoom}}
Room: to be confirmed — we'll send an updated invitation as soon as it's assigned, and it will replace this one rather than adding a second entry to your calendar.
{{/sessionRoom}}
{{#eventLocation}}
Venue: {{eventLocation}}
{{/eventLocation}}
{{#eventTimezone}}
All times are {{eventTimezone}}.
{{/eventTimezone}}

Everything else — your bio, headshot, and A/V details — lives in your speaker portal:

{{portalUrl}}

If this time doesn't work, reply and let us know as early as you can.

{{organizerName}}
{{eventName}}`,
  },
];

export const COMMS_TEMPLATES: Record<CommsTemplateId, CommsTemplate> = Object.fromEntries(
  SEEDS.map((seed) => [
    seed.id,
    { ...seed, fields: mergeFieldsUsed(`${seed.subject}\n${seed.body}`) },
  ]),
) as Record<CommsTemplateId, CommsTemplate>;

export function getCommsTemplate(id: CommsTemplateId): CommsTemplate {
  return COMMS_TEMPLATES[id];
}

/** Renders one of the built-in templates. */
export function renderCommsTemplate(id: CommsTemplateId, data: MergeData): RenderedEmail {
  return renderMessage(COMMS_TEMPLATES[id], data);
}

const TEMPLATE_ID_SET = new Set<string>(COMMS_TEMPLATE_IDS);

export function isCommsTemplateId(value: string): value is CommsTemplateId {
  return TEMPLATE_ID_SET.has(value);
}

// ---------------------------------------------------------------------------
// Per-event overrides
// ---------------------------------------------------------------------------

/**
 * An `email_templates` row overrides a built-in template when its **`name`
 * equals the built-in's id**.
 *
 * The shipped `email_templates` table has no "overrides which template"
 * column and schema changes are frozen, so the join key has to be one of the
 * existing columns. `name` is the only stable, per-event-unique candidate —
 * `trigger` is many-to-one (three templates are "manual") and can't identify
 * a template on its own. The admin UI never asks an organizer to type this:
 * it writes the id when it creates the override row and shows the built-in's
 * human `name` in the interface.
 */
export type TemplateOverrideRow = {
  id: string;
  name: string;
  subject: string;
  body: string;
};

/** How an override row is classified in `email_templates.trigger`. */
export const TEMPLATE_TRIGGERS: Record<CommsTemplateId, EmailTrigger> = {
  submission_confirmation: "manual",
  draft_saved: "manual",
  draft_reminder: "deadline_reminder",
  submission_accepted: "on_acceptance",
  submission_waitlisted: "manual",
  submission_declined: "on_denial",
  change_request: "manual",
  task_reminder: "deadline_reminder",
  calendar_invite: "manual",
};

export interface ResolvedTemplate {
  id: CommsTemplateId;
  subject: string;
  body: string;
  /** True when an organizer's per-event copy is in force. */
  isOverride: boolean;
  /** The `email_templates` row id, when overridden. */
  overrideId: string | null;
}

/**
 * The copy that will actually go out for `id`: the event's override when one
 * exists, otherwise the built-in. Pure — callers pass the event's rows in.
 *
 * A row whose `name` isn't a known template id is ignored rather than
 * treated as an override of something: stale rows from a renamed template
 * must never silently replace live copy.
 */
export function resolveCommsTemplate(
  id: CommsTemplateId,
  overrides: readonly TemplateOverrideRow[] = [],
): ResolvedTemplate {
  const builtIn = COMMS_TEMPLATES[id];
  // Last write wins if an event somehow holds two rows for one template.
  const row = [...overrides].reverse().find((candidate) => candidate.name === id);
  if (!row) {
    return { id, subject: builtIn.subject, body: builtIn.body, isOverride: false, overrideId: null };
  }
  return { id, subject: row.subject, body: row.body, isOverride: true, overrideId: row.id };
}

/** Every template's current copy, built-in or overridden — the editor's list. */
export function resolveAllCommsTemplates(
  overrides: readonly TemplateOverrideRow[] = [],
): ResolvedTemplate[] {
  return COMMS_TEMPLATE_IDS.map((id) => resolveCommsTemplate(id, overrides));
}

// ---------------------------------------------------------------------------
// Template validation (decisions.md D-020: "the admin UI validates fields
// before saving")
// ---------------------------------------------------------------------------

/** Fields src/domain/comms.ts fills in for *every* speaker-facing message. */
export const COMMON_MERGE_FIELDS: MergeField[] = [
  "speakerName",
  "speakerFirstName",
  "eventName",
  "eventDates",
  "eventLocation",
  "eventTimezone",
  "eventUrl",
  "organizerName",
  "organizerEmail",
  "portalUrl",
];

const SESSION_MERGE_FIELDS: MergeField[] = [
  "sessionTitle",
  "sessionWhen",
  "sessionRoom",
  "sessionDuration",
];

/**
 * The merge fields each send path actually has a value for, mirroring the
 * merge-data assembly in src/domain/comms.ts. Anything outside a template's
 * list renders empty (D-020), so the editor warns before it can be saved.
 */
export const TEMPLATE_MERGE_FIELDS: Record<CommsTemplateId, MergeField[]> = {
  submission_confirmation: [...COMMON_MERGE_FIELDS, "submissionTitle", "changeDueDate"],
  draft_saved: [...COMMON_MERGE_FIELDS, "submissionTitle", "changeDueDate", "resumeUrl"],
  draft_reminder: [...COMMON_MERGE_FIELDS, "submissionTitle", "changeDueDate", "resumeUrl"],
  submission_accepted: [
    ...COMMON_MERGE_FIELDS,
    "submissionTitle",
    "decisionNote",
    "outstandingTasks",
    ...SESSION_MERGE_FIELDS,
  ],
  submission_waitlisted: [
    ...COMMON_MERGE_FIELDS,
    "submissionTitle",
    "decisionNote",
    ...SESSION_MERGE_FIELDS,
  ],
  submission_declined: [
    ...COMMON_MERGE_FIELDS,
    "submissionTitle",
    "decisionNote",
    ...SESSION_MERGE_FIELDS,
  ],
  change_request: [
    ...COMMON_MERGE_FIELDS,
    "submissionTitle",
    "submissionUrl",
    "changeRequest",
    "changeDueDate",
  ],
  task_reminder: [
    ...COMMON_MERGE_FIELDS,
    "taskTitle",
    "taskInstructions",
    "taskDueDate",
    "outstandingTasks",
  ],
  calendar_invite: [...COMMON_MERGE_FIELDS, ...SESSION_MERGE_FIELDS],
};

/** What an organizer-composed one-off message can reference (src/domain/comms.ts
 * `speakerMergeData`). No submission/session/task context — the composer picks
 * people, not proposals. */
export const MANUAL_MERGE_FIELDS: MergeField[] = [...COMMON_MERGE_FIELDS, "outstandingTasks"];

/** Matches `{{x}}`, `{{#x}}`, `{{^x}}` and `{{/x}}` alike. */
const ANY_PLACEHOLDER_RE = /\{\{[#^/]?\s*(\w+)\s*\}\}/g;

/** `{{placeholders}}` that aren't merge fields at all — always a typo. */
export function unknownMergePlaceholders(source: string): string[] {
  const unknown = new Set<string>();
  for (const match of source.matchAll(ANY_PLACEHOLDER_RE)) {
    if (!MERGE_FIELD_SET.has(match[1])) unknown.add(match[1]);
  }
  return [...unknown];
}

/** Real merge fields this particular message has no value for. */
export function unavailableMergeFields(source: string, available: MergeField[]): MergeField[] {
  const allowed = new Set<string>(available);
  return mergeFieldsUsed(source).filter((field) => !allowed.has(field));
}

/** Realistic values so the editor can show what the copy will look like. */
export function templatePreviewData(overrides: MergeData = {}): MergeData {
  return {
    speakerName: "Priya Raman",
    speakerFirstName: "Priya",
    eventName: "Your event",
    eventDates: "June 16–18, 2026",
    eventLocation: "Moscone West, San Francisco",
    eventTimezone: "PDT",
    eventUrl: "https://example.com/e/your-event",
    organizerName: "The program team",
    organizerEmail: "hello@example.com",
    portalUrl: "https://example.com/portal",
    submissionTitle: "Retrieval that survives production traffic",
    submissionUrl: "https://example.com/portal/submissions/1",
    resumeUrl: "https://example.com/submit/call-for-speakers/resume/8f2c…",
    decisionNote: "The committee loved the production war stories.",
    changeRequest: "Please trim the abstract to 400 words.",
    changeDueDate: "March 1, 2026",
    sessionTitle: "Retrieval that survives production traffic",
    sessionWhen: "Tuesday, June 16, 2026, 10:00 AM – 10:45 AM PDT",
    sessionRoom: "Main Stage",
    sessionDuration: "45 minutes",
    taskTitle: "Upload your headshot",
    taskInstructions: "Square image, at least 800×800.",
    taskDueDate: "June 5, 2026",
    outstandingTasks: "- Upload your headshot (due June 5)\n- Complete the hotel form (due June 1)",
    ...overrides,
  };
}

export interface TemplateCheck {
  preview: RenderedEmail;
  /** `{{placeholders}}` that aren't merge fields at all. */
  unknown: string[];
  /** Merge fields this message can't fill in — they'd render blank. */
  unavailable: MergeField[];
  /** Merge fields used, and available, but empty in the preview data. */
  blank: MergeField[];
  /** Blocking problems, in the words the editor shows. Empty = safe to save. */
  errors: string[];
}

/**
 * Everything the editor needs to tell an organizer whether their copy will
 * render properly, plus the rendered preview.
 *
 * Unknown placeholders and unavailable fields are **errors**, not warnings:
 * a saved template is used for every future send, so a typo would quietly
 * blank out a sentence in mail nobody re-reads. An empty subject or body is
 * an error for the same reason.
 */
export function checkTemplateDraft(
  subject: string,
  body: string,
  available: MergeField[],
  data: MergeData = templatePreviewData(),
): TemplateCheck {
  const source = `${subject}\n${body}`;
  const unknown = unknownMergePlaceholders(source);
  const unavailable = unavailableMergeFields(source, available);

  const errors: string[] = [];
  if (!subject.trim()) errors.push("The subject can't be empty.");
  if (!body.trim()) errors.push("The message body can't be empty.");
  if (unknown.length > 0) {
    errors.push(
      `Not a merge field, so it would arrive blank: ${unknown.map((name) => `{{${name}}}`).join(", ")}`,
    );
  }
  if (unavailable.length > 0) {
    errors.push(
      `This message has no value for ${unavailable
        .map((name) => `{{${name}}}`)
        .join(", ")} — it would arrive blank.`,
    );
  }

  return {
    preview: renderMessage({ subject, body }, data),
    unknown,
    unavailable,
    blank: missingMergeFields(source, data),
    errors,
  };
}
