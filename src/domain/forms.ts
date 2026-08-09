/**
 * CFP form domain logic (spec.md §2 Call-for-speakers forms, §3 Public
 * submission flow; decisions.md D-009).
 *
 * Pure TypeScript: no datastore imports, no I/O. Everything here works on the
 * JSON field schema (`FormField[]` from src/db/entities.ts) plus a plain
 * values object, so the same code runs in the browser (react-hook-form
 * validation, live conditional visibility) and on the server (re-validating a
 * submitted payload before it reaches a repository).
 *
 * Three jobs:
 *  1. **Visibility** — evaluate `showIf` (spec.md §2 "basic conditional
 *     logic — no arbitrary rules engine"), including the chain case where a
 *     conditional field depends on another conditional field.
 *  2. **Validation** — build a Zod validator *from* the field schema, so
 *     required-field rules and per-type formats live in one place.
 *  3. **Window** — decide whether the public page accepts submissions.
 *
 * It also owns the builder's sensible defaults: a brand-new form starts as a
 * working standard CFP rather than a blank canvas.
 */
import { z } from "zod";
import {
  RESERVED_FIELD_IDS,
  type FormField,
  type FormFieldCondition,
  type FormFieldType,
} from "@/db/entities";
import {
  MERGE_FIELDS,
  type MergeData,
  type MergeField,
  type RenderedEmail,
  mergeFieldsUsed,
  missingMergeFields,
  renderMessage,
} from "@/domain/comms-templates";
import { zonedWallClockToInstant } from "@/lib/event-time";

// ---------------------------------------------------------------------------
// Value shapes
// ---------------------------------------------------------------------------

/** One submission's answers, keyed by `FormField.id`. */
export type FormValues = Record<string, unknown>;

/** A row of the `co_speakers` repeater — never required (spec.md §2). */
export interface CoSpeakerValue {
  name: string;
  email: string;
  title?: string;
  company?: string;
}

export const coSpeakerValueSchema = z.object({
  name: z.string(),
  email: z.string(),
  title: z.string().optional(),
  company: z.string().optional(),
});

/** A co-speaker row the submitter started and abandoned; dropped on save. */
export function isBlankCoSpeaker(row: Partial<CoSpeakerValue> | undefined): boolean {
  if (!row) return true;
  return ![row.name, row.email, row.title, row.company].some((v) => (v ?? "").trim() !== "");
}

export function coSpeakerRows(value: unknown): Array<Partial<CoSpeakerValue>> {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Partial<CoSpeakerValue> => typeof row === "object" && row !== null);
}

/** Non-blank co-speaker rows, trimmed. */
export function cleanCoSpeakers(value: unknown): CoSpeakerValue[] {
  return coSpeakerRows(value)
    .filter((row) => !isBlankCoSpeaker(row))
    .map((row) => ({
      name: (row.name ?? "").trim(),
      email: (row.email ?? "").trim().toLowerCase(),
      title: (row.title ?? "").trim() || undefined,
      company: (row.company ?? "").trim() || undefined,
    }));
}

// ---------------------------------------------------------------------------
// Field-type helpers
// ---------------------------------------------------------------------------

/** Types whose value is a list rather than a scalar. */
const LIST_TYPES = new Set<FormFieldType>(["multiselect", "co_speakers"]);

export function fieldTakesOptions(type: FormFieldType): boolean {
  return type === "select" || type === "multiselect";
}

export function isReservedFieldId(id: string): boolean {
  return (Object.values(RESERVED_FIELD_IDS) as string[]).includes(id);
}

/** Human labels for the builder's type picker. `co_speakers` is deliberately
 * absent: it's driven by the co-speaker toggle, not chosen as a question type. */
export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  email: "Email address",
  url: "Link",
  select: "Choose one",
  multiselect: "Choose any",
  checkbox: "Checkbox",
  file: "File upload",
  co_speakers: "Co-speakers",
};

export const SELECTABLE_FIELD_TYPES: FormFieldType[] = [
  "text",
  "textarea",
  "email",
  "url",
  "select",
  "multiselect",
  "checkbox",
  "file",
];

// ---------------------------------------------------------------------------
// Conditional visibility (`showIf`)
// ---------------------------------------------------------------------------

/**
 * A field's value as a list of comparable strings, so one condition
 * evaluator covers scalars, multiselects, and checkboxes.
 */
function comparableValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "boolean") return value ? ["true"] : [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  }
  const text = String(value).trim();
  return text === "" ? [] : [text];
}

function expectedValues(condition: FormFieldCondition): string[] {
  return Array.isArray(condition.value) ? condition.value : [condition.value];
}

/**
 * Does the condition hold for these values?
 *
 * `eq` means "the field has this value" — for a scalar that's equality, for a
 * multiselect it's membership, which is what an organizer means when they
 * pick "only show this when Format is Workshop".
 */
export function conditionHolds(condition: FormFieldCondition, values: FormValues): boolean {
  const actual = comparableValues(values[condition.fieldId]);
  const expected = expectedValues(condition);
  switch (condition.op) {
    case "eq":
      return expected.length > 0 && expected.every((v) => actual.includes(v));
    case "neq":
      return !expected.some((v) => actual.includes(v));
    case "in":
      return expected.some((v) => actual.includes(v));
  }
}

/**
 * Is this field shown, given the current answers?
 *
 * A conditional field that depends on a *hidden* field is itself hidden: the
 * answer it keys off can't have been given. Cycles (which the builder won't
 * produce — it only offers earlier fields) terminate by evaluating the
 * condition alone rather than recursing forever.
 */
export function isFieldVisible(
  field: FormField,
  values: FormValues,
  fields: FormField[] = [field],
): boolean {
  const byId = new Map(fields.map((f) => [f.id, f]));

  function visible(current: FormField, seen: Set<string>): boolean {
    if (!current.showIf) return true;
    if (!conditionHolds(current.showIf, values)) return false;
    const parent = byId.get(current.showIf.fieldId);
    if (!parent || seen.has(parent.id)) return true;
    return visible(parent, new Set([...seen, current.id]));
  }

  return visible(field, new Set([field.id]));
}

/** The fields the submitter can actually see right now, in schema order. */
export function visibleFields(fields: FormField[], values: FormValues): FormField[] {
  return fields.filter((field) => isFieldVisible(field, values, fields));
}

/**
 * Drops answers to hidden fields — and to fields the form no longer has —
 * so a value typed before a condition flipped is never saved or reviewed.
 * This is what makes "answer, change your mind, submit" behave the way a
 * submitter expects.
 */
export function pruneHiddenValues(fields: FormField[], values: FormValues): FormValues {
  const result: FormValues = {};
  for (const field of visibleFields(fields, values)) {
    if (field.id in values) result[field.id] = values[field.id];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation — a Zod schema built from the field schema
// ---------------------------------------------------------------------------

function isEmailAddress(value: string): boolean {
  return z.email().safeParse(value).success;
}

const URL_RE = /^https?:\/\/[^\s.]+\.[^\s]+$/i;

function isUrl(value: string): boolean {
  return URL_RE.test(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/** "Talk title is required" reads better than a generic message. */
function requiredMessage(field: FormField): string {
  return field.type === "checkbox"
    ? `Please confirm "${field.label}"`
    : `${field.label} is required`;
}

function addIssue(ctx: z.RefinementCtx, path: PropertyKey[], message: string): void {
  ctx.addIssue({ code: "custom", path, message });
}

function checkField(field: FormField, value: unknown, ctx: z.RefinementCtx): void {
  switch (field.type) {
    case "checkbox": {
      if (field.required && value !== true) addIssue(ctx, [field.id], requiredMessage(field));
      return;
    }
    case "multiselect": {
      const list = asList(value);
      if (field.required && list.length === 0) {
        addIssue(ctx, [field.id], `Choose at least one option for ${field.label}`);
        return;
      }
      if (field.options) {
        for (const item of list) {
          if (!field.options.includes(item)) {
            addIssue(ctx, [field.id], `"${item}" isn't one of the choices`);
          }
        }
      }
      return;
    }
    case "co_speakers": {
      // Never required (spec.md §2: co-speakers are supported, never
      // mandatory) — but a row someone started must be complete enough to
      // become a speaker record.
      coSpeakerRows(value).forEach((row, index) => {
        if (isBlankCoSpeaker(row)) return;
        const name = (row.name ?? "").trim();
        const email = (row.email ?? "").trim();
        if (!name) addIssue(ctx, [field.id, index, "name"], "Name is required");
        if (!email) addIssue(ctx, [field.id, index, "email"], "Email is required");
        else if (!isEmailAddress(email)) {
          addIssue(ctx, [field.id, index, "email"], "Enter a valid email address");
        }
      });
      return;
    }
    default: {
      const text = asText(value);
      if (!text) {
        if (field.required) addIssue(ctx, [field.id], requiredMessage(field));
        return;
      }
      if (field.type === "email" && !isEmailAddress(text)) {
        addIssue(ctx, [field.id], "Enter a valid email address");
      }
      if (field.type === "url" && !isUrl(text)) {
        addIssue(ctx, [field.id], "Enter a full link, starting with https://");
      }
      if (field.type === "select" && field.options && !field.options.includes(text)) {
        addIssue(ctx, [field.id], `"${text}" isn't one of the choices`);
      }
    }
  }
}

/**
 * Builds the Zod validator for a form's field schema.
 *
 * Every field is accepted loosely and then checked in one `superRefine`, so
 * that (a) conditional visibility is evaluated against the *whole* value
 * object rather than field by field, and (b) hidden fields are skipped
 * entirely — a required question nobody was shown can never block a
 * submission. Issues are reported at the field's own path, which is what
 * react-hook-form needs to put the message under the right input.
 */
export function buildFormValidator(fields: FormField[]) {
  // `.optional()` is load-bearing: an unanswered question simply isn't a key
  // on the values object, and a missing key must reach the refinement below
  // (which produces the readable "X is required") rather than failing the
  // object parse with a type error nobody can render.
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) shape[field.id] = z.unknown().optional();

  return z.object(shape).superRefine((values, ctx) => {
    const current = values as FormValues;
    for (const field of fields) {
      if (!isFieldVisible(field, current, fields)) continue;
      checkField(field, current[field.id], ctx);
    }
  });
}

export interface FormValidationResult {
  ok: boolean;
  /** First message per field id, ready to show next to the input. */
  errors: Record<string, string>;
  /** Answers with hidden/unknown fields removed. */
  values: FormValues;
}

/** Server-side counterpart to the client validator: validate, then prune. */
export function validateSubmissionValues(
  fields: FormField[],
  values: FormValues,
): FormValidationResult {
  const parsed = buildFormValidator(fields).safeParse(values);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  return { ok: parsed.success, errors, values: pruneHiddenValues(fields, values) };
}

// ---------------------------------------------------------------------------
// Submission window (spec.md §2 "submission open/close behavior")
// ---------------------------------------------------------------------------

export type FormWindowState = "unpublished" | "scheduled" | "open" | "closed";

export interface FormWindow {
  isPublished: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
}

/**
 * Where a form sits in its lifecycle. The boundaries are inclusive on both
 * ends — a form with `closesAt` at 23:59 is still open *at* 23:59 — matching
 * `isFormOpen` in src/db/entities.ts.
 */
export function formWindowState(form: FormWindow, now: Date = new Date()): FormWindowState {
  if (!form.isPublished) return "unpublished";
  if (form.opensAt && now.getTime() < form.opensAt.getTime()) return "scheduled";
  if (form.closesAt && now.getTime() > form.closesAt.getTime()) return "closed";
  return "open";
}

/** Only an open form takes submissions — everything else shows a friendly page. */
export function acceptsSubmissions(form: FormWindow, now: Date = new Date()): boolean {
  return formWindowState(form, now) === "open";
}

export const FORM_STATE_LABELS: Record<FormWindowState, string> = {
  unpublished: "Draft",
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
};

// ---------------------------------------------------------------------------
// Datetime <-> `datetime-local` in the event's timezone
// ---------------------------------------------------------------------------

/**
 * Renders an instant as the `YYYY-MM-DDTHH:MM` a `datetime-local` input
 * wants, in the event's own zone — an organizer sets "closes 1 March at
 * 23:59" meaning *their* event's clock, never the browser's.
 */
export function toZonedInputValue(instant: Date | null, timeZone: string): string {
  if (!instant) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  // Some ICU builds render midnight as hour "24" under hour12:false.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** Inverse of `toZonedInputValue`; returns null for an empty/invalid input. */
export function fromZonedInputValue(value: string, timeZone: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value.trim());
  if (!match) return null;
  return zonedWallClockToInstant(match[1], match[2], timeZone);
}

// ---------------------------------------------------------------------------
// Track selection & co-speaker configuration
// ---------------------------------------------------------------------------

export function findField(fields: FormField[], id: string): FormField | null {
  return fields.find((field) => field.id === id) ?? null;
}

export function trackField(fields: FormField[]): FormField | null {
  return findField(fields, RESERVED_FIELD_IDS.tracks);
}

export function coSpeakerField(fields: FormField[]): FormField | null {
  return findField(fields, RESERVED_FIELD_IDS.coSpeakers);
}

export function allowsCoSpeakers(fields: FormField[]): boolean {
  return coSpeakerField(fields) !== null;
}

/**
 * Keeps the track question's choices in step with the event's actual tracks.
 * Track names are the stored answer, so a rename is picked up here rather
 * than leaving a stale option list frozen in the form's JSON.
 */
export function withTrackOptions(fields: FormField[], trackNames: string[]): FormField[] {
  return fields.map((field) =>
    field.id === RESERVED_FIELD_IDS.tracks ? { ...field, options: [...trackNames] } : field,
  );
}

/** Track names the submitter picked, whether the question is single or multi. */
export function selectedTrackNames(fields: FormField[], values: FormValues): string[] {
  const field = trackField(fields);
  if (!field) return [];
  return comparableValues(values[field.id]);
}

/**
 * Guarantees the form asks for the submitter's name and email.
 *
 * Every submission has to resolve to a person (spec.md §3 — the submitter can
 * come back and edit it, and gets the confirmation email), so if an organizer
 * removed or never added these questions the public form appends them rather
 * than failing at save time.
 */
export function withSpeakerIdentityFields(fields: FormField[]): FormField[] {
  const additions: FormField[] = [];
  if (!findField(fields, RESERVED_FIELD_IDS.speakerName)) {
    additions.push({
      id: RESERVED_FIELD_IDS.speakerName,
      type: "text",
      label: "Your name",
      required: true,
    });
  }
  if (!findField(fields, RESERVED_FIELD_IDS.speakerEmail)) {
    additions.push({
      id: RESERVED_FIELD_IDS.speakerEmail,
      type: "email",
      label: "Your email",
      helpText: "Where we send your confirmation — and how you sign in to edit this later.",
      required: true,
    });
  }
  return additions.length === 0 ? fields : [...fields, ...additions];
}

/**
 * The exact field list the public page renders and validates: identity
 * questions guaranteed, track choices refreshed from the event.
 */
export function publicFields(fields: FormField[], trackNames: string[]): FormField[] {
  return withTrackOptions(withSpeakerIdentityFields(fields), trackNames);
}

// ---------------------------------------------------------------------------
// Builder-side schema checks
// ---------------------------------------------------------------------------

/**
 * Problems an organizer must fix before a field schema can be saved, phrased
 * for someone who has never heard the word "schema". Everything here is
 * something the builder UI also tries to prevent — this is the backstop the
 * save action runs.
 */
export function fieldSchemaProblems(fields: FormField[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let coSpeakerBlocks = 0;

  fields.forEach((field, index) => {
    const name = field.label?.trim() || `Question ${index + 1}`;
    if (!field.id.trim()) problems.push(`${name} has no internal name`);
    if (seen.has(field.id)) problems.push(`Two questions share the internal name "${field.id}"`);
    seen.add(field.id);

    if (!field.label?.trim()) problems.push(`Question ${index + 1} needs a label`);

    if (fieldTakesOptions(field.type) && (field.options ?? []).length === 0) {
      // The track question is the exception: its choices come from the
      // event's tracks at render time, so an empty list here is expected.
      if (field.id !== RESERVED_FIELD_IDS.tracks) {
        problems.push(`"${name}" is a choice question but has no choices`);
      }
    }

    if (field.type === "co_speakers") coSpeakerBlocks += 1;

    if (field.showIf) {
      const targetIndex = fields.findIndex((other) => other.id === field.showIf!.fieldId);
      if (targetIndex === -1) {
        problems.push(`"${name}" is conditional on a question that no longer exists`);
      } else if (targetIndex >= index) {
        problems.push(`"${name}" can only depend on a question that comes before it`);
      }
      if (expectedValues(field.showIf).every((value) => value.trim() === "")) {
        problems.push(`"${name}" needs a value to compare against`);
      }
    }
  });

  if (coSpeakerBlocks > 1) problems.push("A form can only have one co-speaker block");
  return problems;
}

// ---------------------------------------------------------------------------
// Builder defaults — a new form is a working CFP, not a blank canvas
// ---------------------------------------------------------------------------

/** The standard call-for-speakers questions (spec.md §2). */
export const DEFAULT_CFP_FIELDS: FormField[] = [
  {
    id: RESERVED_FIELD_IDS.title,
    type: "text",
    label: "Talk title",
    helpText: "Aim for something a busy attendee understands at a glance.",
    required: true,
  },
  {
    id: RESERVED_FIELD_IDS.description,
    type: "textarea",
    label: "Abstract",
    helpText: "150–400 words. What will attendees be able to do afterwards?",
    required: true,
  },
  {
    id: RESERVED_FIELD_IDS.tracks,
    type: "multiselect",
    label: "Track(s)",
    helpText: "Pick every track this talk fits — it decides who reviews it.",
    required: true,
    options: [],
  },
  {
    id: RESERVED_FIELD_IDS.speakerName,
    type: "text",
    label: "Your name",
    required: true,
  },
  {
    id: RESERVED_FIELD_IDS.speakerEmail,
    type: "email",
    label: "Your email",
    helpText: "Where we send your confirmation — and how you sign in to edit this later.",
    required: true,
  },
  {
    id: RESERVED_FIELD_IDS.speakerBio,
    type: "textarea",
    label: "Speaker biography",
    helpText: "A short third-person bio we can print in the program.",
    required: true,
  },
  {
    id: RESERVED_FIELD_IDS.headshot,
    type: "file",
    label: "Headshot",
    helpText: "Square, at least 800×800. You can add this later if needed.",
  },
  {
    id: RESERVED_FIELD_IDS.coSpeakers,
    type: "co_speakers",
    label: "Co-speakers",
    helpText: "Anyone presenting with you. Leave empty if you're speaking alone.",
  },
];

export const DEFAULT_WELCOME_COPY =
  "We're looking for practitioner talks: things you built, shipped, measured, and would do differently. Tell us what you'd like to present.";

export const DEFAULT_CONFIRMATION_PAGE_CONTENT =
  "Thanks — your proposal is in. You'll get an email confirmation shortly, and you can come back to edit it any time before submissions close.";

export const DEFAULT_CONFIRMATION_EMAIL_SUBJECT =
  "We received your talk proposal — {{submissionTitle}}";

export const DEFAULT_CONFIRMATION_EMAIL_BODY = `Hi {{speakerFirstName}},

Thanks for proposing "{{submissionTitle}}" for {{eventName}}. Our program committee reviews submissions by track, and we'll be in touch as soon as there's news.

You can edit your proposal any time before submissions close:

{{portalUrl}}

— {{organizerName}}`;

/** Freshly-created form, ready to preview and publish. */
export function defaultFormDraft(name: string): {
  name: string;
  welcomeCopy: string;
  fields: FormField[];
  confirmationPageContent: string;
  confirmationEmailSubject: string;
  confirmationEmailBody: string;
} {
  return {
    name,
    welcomeCopy: DEFAULT_WELCOME_COPY,
    fields: DEFAULT_CFP_FIELDS.map((field) => ({ ...field })),
    confirmationPageContent: DEFAULT_CONFIRMATION_PAGE_CONTENT,
    confirmationEmailSubject: DEFAULT_CONFIRMATION_EMAIL_SUBJECT,
    confirmationEmailBody: DEFAULT_CONFIRMATION_EMAIL_BODY,
  };
}

// ---------------------------------------------------------------------------
// Confirmation-email merge fields (spec.md §2, §7)
// ---------------------------------------------------------------------------

/**
 * The merge fields `sendSubmissionConfirmation` (src/domain/comms.ts) has
 * values for at confirmation time. Anything outside this list renders empty
 * (decisions.md D-020), so the builder warns about it before it's saved.
 */
export const CONFIRMATION_MERGE_FIELDS: MergeField[] = [
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
  "changeDueDate",
];

const CONFIRMATION_FIELD_SET = new Set<string>(CONFIRMATION_MERGE_FIELDS);
const ANY_PLACEHOLDER_RE = /\{\{[#^/]?\s*(\w+)\s*\}\}/g;

/** `{{placeholders}}` that aren't merge fields at all — always a typo. */
export function unknownMergePlaceholders(source: string): string[] {
  const known = new Set<string>(MERGE_FIELDS);
  const unknown = new Set<string>();
  for (const match of source.matchAll(ANY_PLACEHOLDER_RE)) {
    if (!known.has(match[1])) unknown.add(match[1]);
  }
  return [...unknown];
}

/** Real merge fields that simply have no value in a confirmation email. */
export function unavailableMergeFields(source: string): MergeField[] {
  return mergeFieldsUsed(source).filter((field) => !CONFIRMATION_FIELD_SET.has(field));
}

/** Sample data so the builder can show what the email will actually look like. */
export function confirmationPreviewData(overrides: MergeData = {}): MergeData {
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
    changeDueDate: "March 1, 2026",
    ...overrides,
  };
}

export interface ConfirmationEmailCheck {
  preview: RenderedEmail;
  /** Merge fields used that a confirmation email can't fill in. */
  unavailable: MergeField[];
  /** `{{placeholders}}` that aren't merge fields at all. */
  unknown: string[];
  /** Fields the preview data itself has no value for. */
  blank: MergeField[];
}

/**
 * Everything the builder needs to tell an organizer whether their custom
 * confirmation email will render properly, plus the rendered preview.
 */
export function checkConfirmationEmail(
  subject: string,
  body: string,
  data: MergeData = confirmationPreviewData(),
): ConfirmationEmailCheck {
  const source = `${subject}\n${body}`;
  return {
    preview: renderMessage({ subject, body }, data),
    unavailable: unavailableMergeFields(source),
    unknown: unknownMergePlaceholders(source),
    blank: missingMergeFields(source, data),
  };
}

// ---------------------------------------------------------------------------
// Prefill (spec.md §3 — submissions stay editable by their submitter)
// ---------------------------------------------------------------------------

export interface PrefillSources {
  /** `submissions.answers`, the record of what was typed. */
  answers: FormValues;
  title: string;
  description: string | null;
  /** Track *names*, resolved from `submission_tracks`. */
  trackNames: string[];
  primarySpeaker: { name: string | null; email: string };
  coSpeakers: CoSpeakerValue[];
}

/**
 * Default values for the schema-driven renderer when editing an existing
 * submission. Reserved fields come from their authoritative home (columns and
 * join tables) rather than from `answers`, so an edit made elsewhere — an
 * admin retitling a talk, say — shows up here instead of being silently
 * overwritten by a stale answer.
 */
export function prefillValues(fields: FormField[], sources: PrefillSources): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    switch (field.id) {
      case RESERVED_FIELD_IDS.title:
        values[field.id] = sources.title;
        break;
      case RESERVED_FIELD_IDS.description:
        values[field.id] = sources.description ?? "";
        break;
      case RESERVED_FIELD_IDS.tracks:
        values[field.id] =
          field.type === "multiselect" ? sources.trackNames : (sources.trackNames[0] ?? "");
        break;
      case RESERVED_FIELD_IDS.speakerName:
        values[field.id] = sources.primarySpeaker.name ?? "";
        break;
      case RESERVED_FIELD_IDS.speakerEmail:
        values[field.id] = sources.primarySpeaker.email;
        break;
      case RESERVED_FIELD_IDS.coSpeakers:
        values[field.id] = sources.coSpeakers;
        break;
      default:
        values[field.id] = sources.answers[field.id] ?? emptyValueFor(field);
    }
  }
  return values;
}

/** The empty value a control of this type expects (never `undefined`, so
 * react-hook-form treats the input as controlled from the first render). */
export function emptyValueFor(field: FormField): unknown {
  if (field.type === "checkbox") return false;
  if (LIST_TYPES.has(field.type)) return [];
  return "";
}

/** A blank answer set for a brand-new submission. */
export function emptyValues(fields: FormField[]): FormValues {
  return Object.fromEntries(fields.map((field) => [field.id, emptyValueFor(field)]));
}
