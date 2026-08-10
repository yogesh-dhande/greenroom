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
  type FormType,
  type SubmissionStatus,
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
import { isImageKey, uploadProblemMessage, type UploadKind } from "@/lib/uploads";

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

/**
 * The answer types each reserved question may have (decisions.md D-022 — the
 * authoritative id list lives in src/db/entities.ts).
 *
 * A reserved id isn't just a question: its answer is mapped onto a column or a
 * join table when the submission is saved (src/domain/submissions.ts), so the
 * *type* is part of that contract. Retyping "Your email" to Short text or a
 * Checkbox doesn't produce a slightly odd form — it hands `findOrCreateSpeaker`
 * a value that isn't an address and inserts a `users` row the schema rejects
 * only after the write. Locked here, in the builder's type picker, and in
 * `fieldSchemaProblems` (the save-path backstop), so no payload can store one.
 *
 * Where two types are listed, both round-trip to the same stored value and the
 * choice is purely how big the box is.
 */
export const RESERVED_FIELD_TYPES: Record<string, FormFieldType[]> = {
  [RESERVED_FIELD_IDS.title]: ["text", "textarea"],
  [RESERVED_FIELD_IDS.description]: ["textarea", "text"],
  [RESERVED_FIELD_IDS.tracks]: ["select", "multiselect"],
  [RESERVED_FIELD_IDS.speakerName]: ["text"],
  [RESERVED_FIELD_IDS.speakerEmail]: ["email"],
  [RESERVED_FIELD_IDS.speakerBio]: ["textarea", "text"],
  [RESERVED_FIELD_IDS.headshot]: ["file"],
  [RESERVED_FIELD_IDS.coSpeakers]: ["co_speakers"],
};

/** The types this question is allowed to have — null when it's a custom
 * question an organizer may type however they like. `hasOwn` because field ids
 * arrive from a payload, and `"constructor"` is a key every object answers to. */
export function reservedFieldTypes(id: string): FormFieldType[] | null {
  return Object.hasOwn(RESERVED_FIELD_TYPES, id) ? RESERVED_FIELD_TYPES[id] : null;
}

export function reservedTypeIsCompatible(field: FormField): boolean {
  const allowed = reservedFieldTypes(field.id);
  return allowed === null || allowed.includes(field.type);
}

/** `"Email address"`, `"Long text" or "Short text"` — the allowed types of a
 * built-in question, named as the type picker names them. */
export function reservedTypeSummary(id: string): string | null {
  const allowed = reservedFieldTypes(id);
  if (!allowed) return null;
  return allowed.map((type) => `"${FIELD_TYPE_LABELS[type]}"`).join(" or ");
}

/**
 * What a file question accepts. The reserved headshot answer becomes
 * `users.headshotUrl` and is rendered as an `<img>` on the speaker gallery
 * (decisions.md D-022), so a PDF or a .docx there is never a useful answer
 * even though the general upload rules allow them on other file questions.
 */
export function uploadKindForField(field: FormField): UploadKind {
  return field.id === RESERVED_FIELD_IDS.headshot ? "image" : "any";
}

/**
 * Types whose answer is free text, and which can therefore carry a character
 * cap (decisions.md D-034, D-038). A cap on anything else is meaningless — the
 * answer is a choice, a boolean, or a file key — so the builder hides the
 * control and `normalizeFormFields` drops the value.
 */
const MAX_LENGTH_TYPES = new Set<FormFieldType>(["text", "textarea", "email", "url"]);

export function fieldTakesMaxLength(type: FormFieldType): boolean {
  return MAX_LENGTH_TYPES.has(type);
}

/** The cap actually in force for a field — null when there isn't one. */
export function effectiveMaxLength(field: FormField): number | null {
  if (!fieldTakesMaxLength(field.type)) return null;
  return field.maxLength && field.maxLength > 0 ? field.maxLength : null;
}

/**
 * When the public form starts warning about the cap. Showing a counter from
 * the first keystroke turns every question into a typing test; showing it only
 * at the boundary is a surprise. 80% is the compromise — and a short cap
 * (a 60-character title) counts from the start, where every character matters.
 */
export function showsCharacterCount(max: number, length: number): boolean {
  return max <= 120 || length >= Math.floor(max * 0.8);
}

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
      // A picture-only question (the reserved headshot) re-checks the stored
      // key here, not just in the browser's `accept` filter: the answer becomes
      // `users.headshotUrl` and is rendered as an image (D-022), so a PDF would
      // be a broken photo on the public gallery.
      if (field.type === "file" && uploadKindForField(field) === "image" && !isImageKey(text)) {
        addIssue(ctx, [field.id], uploadProblemMessage("unsupported-type", "image"));
      }
      // D-034, D-038: the same cap the browser counts down to is re-checked here,
      // so a form can never accept an answer its own rules reject.
      const max = effectiveMaxLength(field);
      if (max !== null && text.length > max) {
        addIssue(
          ctx,
          [field.id],
          `${field.label} has to be ${max} characters or fewer — that's ${text.length - max} too many`,
        );
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

/**
 * Whether a form being non-submittable is actually the `closesAt` date's
 * doing. `closesAt` is set on plenty of forms that are unpublished or still
 * `scheduled` — attributing the freeze to a date in those states misleads a
 * reader into thinking the form was open and then closed (eval finding: the
 * portal's read-only banner cited `form.closesAt` whenever it was non-null,
 * so an unpublished form with a future close date claimed to have "closed"
 * on that future date).
 */
export function closureIsDateDriven(form: FormWindow, now: Date = new Date()): boolean {
  return formWindowState(form, now) === "closed";
}

export const FORM_STATE_LABELS: Record<FormWindowState, string> = {
  unpublished: "Draft",
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
};

// ---------------------------------------------------------------------------
// Submission type (decisions.md D-041)
// ---------------------------------------------------------------------------

/** What the two form types are called wherever an organizer picks one. */
export const FORM_TYPE_LABELS: Record<FormType, string> = {
  abstract: "Abstract",
  session: "Session",
};

/**
 * The guidance next to the switch, paraphrasing Sessionboard's own wording
 * ("Choose Session if you are collecting proposals that will become sessions
 * directly", with invited proposals as the worked example — D-041).
 */
export const FORM_TYPE_DESCRIPTIONS: Record<FormType, string> = {
  abstract: "Proposals that go through review before becoming sessions.",
  session: "Proposals that become sessions directly — e.g. invited or sponsor slots.",
};

/** The badge an organizer reads on a session-type submission, so it's obvious
 * why it never queued for review. */
export const DIRECT_TO_SESSION_LABEL = "Direct to session";

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
 * The one rule about co-speakers that no configuration may break: they are
 * supported, never mandatory (spec.md §2, decisions.md D-034, D-038).
 *
 * Enforced by removing the possibility rather than by validating against it —
 * `required` is stripped from the co-speaker block on every save, so there is
 * no stored state in which a form demands a co-speaker, whatever a hand-edited
 * payload or an older draft asks for. The validator (`checkField`) never reads
 * `required` for this type either; this keeps the *data* honest as well, so
 * the builder can't render a switch that appears to have taken effect.
 *
 * There is deliberately no minimum-count concept anywhere in `FormField`: a
 * minimum is just "required" with extra steps.
 */
export function normalizeCoSpeakerField(field: FormField): FormField {
  if (field.type !== "co_speakers" && field.id !== RESERVED_FIELD_IDS.coSpeakers) return field;
  if (field.required === undefined) return field;
  const stripped: FormField = { ...field };
  delete stripped.required;
  return stripped;
}

/**
 * Everything the save path should fix silently rather than reject: the
 * co-speaker guard above, plus dropping character caps from field types that
 * can't have one (a cap on a checkbox would be stored forever and never read).
 */
export function normalizeFormFields(fields: FormField[]): FormField[] {
  return fields.map((field) => {
    const next = normalizeCoSpeakerField(field);
    if (next.maxLength === undefined || effectiveMaxLength(next) !== null) return next;
    const stripped: FormField = { ...next };
    delete stripped.maxLength;
    return stripped;
  });
}

// ---------------------------------------------------------------------------
// Question presets (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

export const VIDEO_LINK_FIELD_ID = "video_link";

/**
 * "Proposals may be abstracts or videos" (spec.md §2). A video proposal needs
 * no new field type — a validated link is the whole feature — but an organizer
 * only gets there if the builder offers it, so it ships as a one-click preset
 * with the right label, help text and `url` validation already set.
 */
export const VIDEO_LINK_FIELD: FormField = {
  id: VIDEO_LINK_FIELD_ID,
  type: "url",
  label: "Video pitch or talk recording",
  helpText:
    "Prefer to pitch on camera? Paste a link (YouTube, Loom, Vimeo, Drive) to a recording instead of — or as well as — writing it out.",
  maxLength: 500,
};

export function hasVideoLinkField(fields: FormField[]): boolean {
  return fields.some((field) => field.id === VIDEO_LINK_FIELD_ID);
}

// ---------------------------------------------------------------------------
// Per-form submission limit (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

/**
 * A withdrawn proposal frees its slot; everything else — including a saved
 * draft — occupies one. Drafts have to count, or "one proposal per speaker"
 * would be trivially defeated by saving ten drafts and submitting them all.
 */
export function countsTowardSubmissionLimit(status: SubmissionStatus): boolean {
  return status !== "withdrawn";
}

export interface SubmissionLimitState {
  /** Null when the form sets no cap. */
  limit: number | null;
  /** Proposals this speaker already has here, excluding the one in hand. */
  used: number;
  /** Null when there's no cap. */
  remaining: number | null;
  atLimit: boolean;
}

/**
 * How much room a speaker has left on a form.
 *
 * `excludeId` is the proposal currently being edited or promoted from draft:
 * saving it again must not be blocked by its own existence.
 */
export function submissionLimitState(
  form: { maxSubmissionsPerSpeaker: number | null },
  existing: Array<{ id: string; status: SubmissionStatus }>,
  options: { excludeId?: string } = {},
): SubmissionLimitState {
  const limit = form.maxSubmissionsPerSpeaker;
  const used = existing.filter(
    (submission) =>
      submission.id !== options.excludeId && countsTowardSubmissionLimit(submission.status),
  ).length;
  if (limit === null || limit <= 0) return { limit: null, used, remaining: null, atLimit: false };
  return { limit, used, remaining: Math.max(0, limit - used), atLimit: used >= limit };
}

/** The sentence a speaker who has run out of slots reads. */
export function submissionLimitMessage(limit: number): string {
  return limit === 1
    ? "You've already sent us a proposal on this form, and this call accepts one proposal per speaker. You can edit the one you have — you don't need to start another."
    : `This call accepts up to ${limit} proposals per speaker, and you've used all ${limit}. You can still edit the ones you've sent us.`;
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

/**
 * The same questions with every `required` flag dropped — what a **draft** is
 * validated against (decisions.md D-034, D-038).
 *
 * A half-finished proposal is the entire point of saving a draft, so required
 * questions can't block the save. Everything else still applies: formats,
 * choice membership and character caps are checked on a draft exactly as they
 * are on a submission, because those are answers that are wrong rather than
 * answers that are missing.
 */
export function optionalFields(fields: FormField[]): FormField[] {
  return fields.map((field) => (field.required ? { ...field, required: false } : field));
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

    // A built-in question's answer feeds a column or a join table, so its type
    // is part of that contract (decisions.md D-022) — see RESERVED_FIELD_TYPES.
    if (!reservedTypeIsCompatible(field)) {
      problems.push(
        `"${name}" is a built-in question — its answer type has to be ${reservedTypeSummary(field.id)}`,
      );
    }

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
      // A condition compares by exact string (`conditionHolds`), so an answer
      // the controlling question no longer offers is a rule that can never fire
      // again — renaming or deleting a choice used to kill the condition
      // silently. Only questions with a *fixed* choice list can be checked:
      // the track question's options are resolved from the event at render
      // time (D-022), so what's stored here says nothing about them.
      const target = targetIndex === -1 ? null : fields[targetIndex];
      if (
        target &&
        fieldTakesOptions(target.type) &&
        target.id !== RESERVED_FIELD_IDS.tracks &&
        (target.options ?? []).length > 0
      ) {
        for (const value of expectedValues(field.showIf)) {
          if (value.trim() === "" || target.options!.includes(value)) continue;
          problems.push(
            `"${name}" is conditional on the answer "${value}", which "${target.label}" no longer offers`,
          );
        }
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
    // Images only, enforced in `checkField` and by the file control's `accept`
    // — this answer becomes the speaker's photo on the public gallery (D-022).
    helpText: "A picture — JPG, PNG or WebP. Square, at least 800×800. You can add this later.",
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

/**
 * The same email for a session-type form (decisions.md D-041, D-042).
 *
 * A session form has no review step — the proposal becomes a confirmed session
 * the moment it arrives, and D-042 deliberately sends no decision email — so
 * promising that "our program committee reviews submissions" would be the only
 * thing we ever tell the speaker about a decision that already happened.
 */
export const DEFAULT_SESSION_CONFIRMATION_EMAIL_SUBJECT =
  "Your session is confirmed — {{submissionTitle}}";

export const DEFAULT_SESSION_CONFIRMATION_EMAIL_BODY = `Hi {{speakerFirstName}},

Thanks for sending us "{{submissionTitle}}" for {{eventName}}. This form books sessions directly, so there's no review step — your session is on the program, and we'll be in touch about scheduling.

You can edit the details any time before submissions close:

{{portalUrl}}

— {{organizerName}}`;

/**
 * Freshly-created form, ready to preview and publish.
 *
 * The submission type is picked when the form is created (the New form
 * dialog), which is what lets the stored confirmation copy be honest about
 * what actually happens next (D-041): review, or a confirmed session.
 */
export function defaultFormDraft(
  name: string,
  type: FormType = "abstract",
): {
  name: string;
  welcomeCopy: string;
  fields: FormField[];
  confirmationPageContent: string;
  confirmationEmailSubject: string;
  confirmationEmailBody: string;
} {
  const direct = type === "session";
  return {
    name,
    welcomeCopy: DEFAULT_WELCOME_COPY,
    fields: DEFAULT_CFP_FIELDS.map((field) => ({ ...field })),
    confirmationPageContent: DEFAULT_CONFIRMATION_PAGE_CONTENT,
    confirmationEmailSubject: direct
      ? DEFAULT_SESSION_CONFIRMATION_EMAIL_SUBJECT
      : DEFAULT_CONFIRMATION_EMAIL_SUBJECT,
    confirmationEmailBody: direct
      ? DEFAULT_SESSION_CONFIRMATION_EMAIL_BODY
      : DEFAULT_CONFIRMATION_EMAIL_BODY,
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
