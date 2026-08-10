"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, PlusIcon, VideoIcon } from "lucide-react";
import { toast } from "sonner";
import { RESERVED_FIELD_IDS, type FormField, type FormType } from "@/db/entities";
import {
  CONFIRMATION_MERGE_FIELDS,
  FORM_STATE_LABELS,
  FORM_TYPE_DESCRIPTIONS,
  FORM_TYPE_LABELS,
  VIDEO_LINK_FIELD,
  allowsCoSpeakers,
  checkConfirmationEmail,
  fieldSchemaProblems,
  formWindowState,
  fromZonedInputValue,
  hasVideoLinkField,
  publicFields,
  toZonedInputValue,
} from "@/domain/forms";
import { slugify } from "@/lib/slug";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { FieldEditor } from "./field-editor";
import { closeFormNow, saveForm, setFormPublished } from "../actions";

export interface FormDraft {
  id: string;
  name: string;
  slug: string;
  /** What a submission becomes: review pipeline, or session on arrival (D-041). */
  type: FormType;
  welcomeCopy: string;
  fields: FormField[];
  /** "YYYY-MM-DDTHH:MM" wall clock in the event's timezone. */
  opensAt: string;
  closesAt: string;
  confirmationPageContent: string;
  confirmationEmailSubject: string;
  confirmationEmailBody: string;
  /** "" = no cap (D-034, D-038). Kept as a string: it's an <input> value. */
  maxSubmissionsPerSpeaker: string;
  isPublished: boolean;
}

export interface FormBuilderProps {
  eventSlug: string;
  eventTimezone: string;
  trackNames: string[];
  responseCount: number;
  form: FormDraft;
}

const CO_SPEAKER_FIELD: FormField = {
  id: RESERVED_FIELD_IDS.coSpeakers,
  type: "co_speakers",
  label: "Co-speakers",
  helpText: "Add anyone presenting with you. Optional — leave blank if you're presenting solo.",
};

/** A new question's answer key, derived from its label and kept unique so
 * existing answers are never overwritten by a same-named question. */
function nextFieldId(fields: FormField[]): string {
  const taken = new Set(fields.map((field) => field.id));
  for (let n = 1; n < 500; n++) {
    const id = `question_${n}`;
    if (!taken.has(id)) return id;
  }
  return `question_${Date.now()}`;
}

/**
 * The CFP form builder (spec.md §2).
 *
 * Everything lives in local state until Save, so an organizer can reorder
 * questions and rewrite copy without a round trip per keystroke — and so the
 * live preview of the confirmation email is instant. The three tabs match the
 * three questions an organizer actually has: what do we ask, what do we say,
 * and when is it open.
 */
export function FormBuilder({
  eventSlug,
  eventTimezone,
  trackNames,
  responseCount,
  form,
}: FormBuilderProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<FormDraft>(form);
  // The last state actually persisted — starts at the loaded form, moves
  // only on a confirmed save. The header badge reads from this, not from
  // `draft`, so a not-yet-saved edit (e.g. a past "Closes" date) can never
  // paint the form as closed before Save is even pressed (eval finding: the
  // badge used to be computed live from the draft).
  const [savedForm, setSavedForm] = useState<FormDraft>(form);
  const [slugTouched, setSlugTouched] = useState(true);
  const [isSaving, startSaving] = useTransition();
  const [isPublishing, startPublishing] = useTransition();
  const [isClosingNow, startClosingNow] = useTransition();
  // Server-rejected save, kept on screen (not just a transient toast) until
  // the user changes something or saves successfully — a failed save used to
  // leave no trace once the toast faded.
  const [saveError, setSaveError] = useState<string | null>(null);

  const problems = useMemo(() => fieldSchemaProblems(draft.fields), [draft.fields]);
  const emailCheck = useMemo(
    () => checkConfirmationEmail(draft.confirmationEmailSubject, draft.confirmationEmailBody),
    [draft.confirmationEmailSubject, draft.confirmationEmailBody],
  );
  const state = useMemo(
    () =>
      formWindowState({
        isPublished: savedForm.isPublished,
        opensAt: fromZonedInputValue(savedForm.opensAt, eventTimezone),
        closesAt: fromZonedInputValue(savedForm.closesAt, eventTimezone),
      }),
    [savedForm.isPublished, savedForm.opensAt, savedForm.closesAt, eventTimezone],
  );
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedForm),
    [draft, savedForm],
  );
  const parsedOpensAt = useMemo(
    () => fromZonedInputValue(draft.opensAt, eventTimezone),
    [draft.opensAt, eventTimezone],
  );
  const parsedClosesAt = useMemo(
    () => fromZonedInputValue(draft.closesAt, eventTimezone),
    [draft.closesAt, eventTimezone],
  );
  // Mirrors the server rule (forms/actions.ts saveForm: "closesAt <=
  // opensAt" is rejected) so the round trip that used to be the only way to
  // find out isn't needed — and so Save can be disabled instead of quietly
  // failing.
  const dateRangeInvalid = Boolean(
    parsedOpensAt && parsedClosesAt && parsedClosesAt <= parsedOpensAt,
  );
  const preview = useMemo(
    () => publicFields(draft.fields, trackNames),
    [draft.fields, trackNames],
  );

  function patch(changes: Partial<FormDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
    // Any edit invalidates a previously reported server error — it was about
    // the form as it stood before this change.
    setSaveError(null);
  }

  function setFields(next: FormField[]) {
    patch({ fields: next });
  }

  async function persist(): Promise<boolean> {
    if (dateRangeInvalid) return false;
    const result = await saveForm(eventSlug, draft.id, {
      name: draft.name,
      slug: draft.slug,
      type: draft.type,
      welcomeCopy: draft.welcomeCopy,
      fields: draft.fields,
      opensAt: draft.opensAt,
      closesAt: draft.closesAt,
      confirmationPageContent: draft.confirmationPageContent,
      confirmationEmailSubject: draft.confirmationEmailSubject,
      confirmationEmailBody: draft.confirmationEmailBody,
      maxSubmissionsPerSpeaker: draft.maxSubmissionsPerSpeaker,
    });
    if (!result.ok) {
      setSaveError(result.error);
      toast.error(result.error);
      return false;
    }
    setSaveError(null);
    setSavedForm(draft);
    if (result.data.unknownPlaceholders.length > 0) {
      toast.warning(
        `Saved, but these placeholders aren't merge fields and will be blank: ${result.data.unknownPlaceholders
          .map((name) => `{{${name}}}`)
          .join(", ")}`,
      );
    }
    router.refresh();
    return true;
  }

  // One click, no confirm - an organizer reaching for this already means it
  // (spec.md section 2: no clean way to close a CFP window early). Goes
  // straight to the server rather than through `persist`, so it can't be
  // blocked by `dateRangeInvalid` on an unrelated unsaved edit elsewhere on
  // the form.
  function closeNow() {
    startClosingNow(async () => {
      const result = await closeFormNow(eventSlug, draft.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const closedAtInput = toZonedInputValue(result.data.closesAt, eventTimezone);
      setDraft((current) => ({ ...current, closesAt: closedAtInput }));
      setSavedForm((current) => ({ ...current, closesAt: closedAtInput }));
      toast.success("Submissions closed");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{draft.name}</h1>
            <Badge
              variant={state === "open" ? "default" : state === "closed" ? "outline" : "secondary"}
            >
              {FORM_STATE_LABELS[state]}
            </Badge>
            {hasUnsavedChanges ? (
              <span className="text-xs font-medium text-muted-foreground">Unsaved changes</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {responseCount} {responseCount === 1 ? "response" : "responses"} ·{" "}
            {draft.isPublished ? (
              <a
                href={`/submit/${draft.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
              >
                /submit/{draft.slug}
                <ExternalLinkIcon className="size-3.5" />
              </a>
            ) : (
              `/submit/${draft.slug} (not live yet)`
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={isSaving || isPublishing || isClosingNow || dateRangeInvalid}
              onClick={() => startSaving(async () => {
                if (await persist()) toast.success("Form saved");
              })}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
            <Button
              disabled={isSaving || isPublishing || isClosingNow || dateRangeInvalid}
              variant={draft.isPublished ? "outline" : "default"}
              onClick={() =>
                startPublishing(async () => {
                  // Publishing an unsaved draft would put the old questions
                  // live, so the save always happens first.
                  if (!(await persist())) return;
                  const next = !draft.isPublished;
                  const result = await setFormPublished(eventSlug, draft.id, next);
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  patch({ isPublished: next });
                  setSavedForm((current) => ({ ...current, isPublished: next }));
                  toast.success(next ? "Form published" : "Form unpublished");
                  router.refresh();
                })
              }
            >
              {isPublishing
                ? "Working…"
                : draft.isPublished
                  ? "Unpublish"
                  : "Save & publish"}
            </Button>
          </div>
          {saveError ? (
            <p role="alert" className="max-w-72 text-right text-sm text-destructive">
              {saveError}
            </p>
          ) : null}
        </div>
      </div>

      {problems.length > 0 ? (
        <div className="rounded-lg border border-warning bg-warning/10 p-4">
          <p className="text-sm font-medium text-foreground">Fix before publishing</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="copy">Welcome &amp; confirmation</TabsTrigger>
          <TabsTrigger value="window">Window &amp; link</TabsTrigger>
        </TabsList>

        {/* --- Questions ------------------------------------------------- */}
        <TabsContent value="questions" className="flex flex-col gap-4 pt-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Co-speakers</p>
              <p className="text-sm text-muted-foreground">
                Let a speaker add other people presenting with them. Never required.
              </p>
            </div>
            <Switch
              aria-label="Allow co-speakers"
              checked={allowsCoSpeakers(draft.fields)}
              onCheckedChange={(checked) =>
                setFields(
                  checked
                    ? [...draft.fields, { ...CO_SPEAKER_FIELD }]
                    : draft.fields.filter((field) => field.type !== "co_speakers"),
                )
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            {draft.fields.map((field, index) => (
              <FieldEditor
                key={field.id}
                field={field}
                index={index}
                total={draft.fields.length}
                earlier={draft.fields.slice(0, index)}
                trackNames={trackNames}
                onChange={(next) =>
                  setFields(draft.fields.map((current, i) => (i === index ? next : current)))
                }
                onMove={(direction) => {
                  const target = index + direction;
                  if (target < 0 || target >= draft.fields.length) return;
                  const next = [...draft.fields];
                  [next[index], next[target]] = [next[target], next[index]];
                  setFields(next);
                }}
                onRemove={() => setFields(draft.fields.filter((_, i) => i !== index))}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setFields([
                  ...draft.fields,
                  {
                    id: nextFieldId(draft.fields),
                    type: "text",
                    label: "New question",
                    required: false,
                  },
                ])
              }
            >
              <PlusIcon />
              Add a question
            </Button>
            {!hasVideoLinkField(draft.fields) ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFields([...draft.fields, { ...VIDEO_LINK_FIELD }])}
              >
                <VideoIcon />
                Accept video pitches
              </Button>
            ) : null}
            {!draft.fields.some((field) => field.id === RESERVED_FIELD_IDS.tracks) &&
            trackNames.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setFields([
                    ...draft.fields,
                    {
                      id: RESERVED_FIELD_IDS.tracks,
                      type: "multiselect",
                      label: "Track",
                      helpText: "Where does this talk fit best?",
                      required: true,
                      options: [...trackNames],
                    },
                  ])
                }
              >
                <PlusIcon />
                Add the track question
              </Button>
            ) : null}
          </div>

          <Separator />

          <div>
            <p className="text-sm font-medium text-foreground">What speakers will see</p>
            <ol className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
              {preview.map((field) => (
                <li key={field.id}>
                  {field.label}
                  {field.required ? " *" : ""}
                  {field.showIf ? " — only sometimes" : ""}
                </li>
              ))}
            </ol>
            {preview.length > draft.fields.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Name and email are added automatically — every proposal has to reach a person.
              </p>
            ) : null}
          </div>
        </TabsContent>

        {/* --- Copy ------------------------------------------------------ */}
        <TabsContent value="copy" className="flex flex-col gap-6 pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="welcome-copy">Welcome copy</Label>
            <Textarea
              id="welcome-copy"
              rows={5}
              value={draft.welcomeCopy}
              onChange={(event) => patch({ welcomeCopy: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Shown above the questions on the public page.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmation-page">Confirmation page</Label>
            <Textarea
              id="confirmation-page"
              rows={4}
              value={draft.confirmationPageContent}
              onChange={(event) => patch({ confirmationPageContent: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              What a speaker reads right after submitting.
            </p>
          </div>

          <Separator />

          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Confirmation email</p>
              <p className="text-sm text-muted-foreground">
                Sent to the submitter (and any co-speakers) the moment a proposal arrives. Leave
                both boxes empty to use Greenroom&apos;s built-in wording.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmation-subject">Subject</Label>
              <Input
                id="confirmation-subject"
                value={draft.confirmationEmailSubject}
                onChange={(event) => patch({ confirmationEmailSubject: event.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmation-body">Body</Label>
              <Textarea
                id="confirmation-body"
                rows={10}
                className="font-mono text-xs"
                value={draft.confirmationEmailBody}
                onChange={(event) => patch({ confirmationEmailBody: event.target.value })}
              />
            </div>

            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium text-foreground">Available merge fields</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Type these anywhere in the subject or body — they&apos;re replaced with the real
                values when the email goes out.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CONFIRMATION_MERGE_FIELDS.map((field) => (
                  <code
                    key={field}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                  >
                    {`{{${field}}}`}
                  </code>
                ))}
              </div>
            </div>

            {emailCheck.unknown.length > 0 || emailCheck.unavailable.length > 0 ? (
              <div className="rounded-lg border border-warning bg-warning/10 p-4 text-sm">
                {emailCheck.unknown.length > 0 ? (
                  <p className="text-foreground">
                    Not a merge field, so it will be blank:{" "}
                    {emailCheck.unknown.map((name) => `{{${name}}}`).join(", ")}
                  </p>
                ) : null}
                {emailCheck.unavailable.length > 0 ? (
                  <p className="mt-1 text-foreground">
                    A confirmation email has no value for:{" "}
                    {emailCheck.unavailable.map((name) => `{{${name}}}`).join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-xs font-medium text-muted-foreground">Preview</p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {emailCheck.preview.subject}
              </p>
              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                {emailCheck.preview.text}
              </p>
            </div>
          </div>
        </TabsContent>

        {/* --- Window ---------------------------------------------------- */}
        <TabsContent value="window" className="flex flex-col gap-6 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="form-name">Form name</Label>
              <Input
                id="form-name"
                value={draft.name}
                onChange={(event) => {
                  const name = event.target.value;
                  patch(slugTouched ? { name } : { name, slug: slugify(name) });
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="form-slug">Public link</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/submit/</span>
                <Input
                  id="form-slug"
                  value={draft.slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    patch({ slug: event.target.value });
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens. Changing this breaks the public link you
                already shared — saved-draft links keep working.
              </p>
            </div>
          </div>

          <Separator />

          {/* What submissions to this form become (decisions.md D-041). */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="form-type">Submissions become</Label>
            <Select
              value={draft.type}
              disabled={responseCount > 0}
              onValueChange={(value) => patch({ type: value as FormType })}
            >
              <SelectTrigger id="form-type" className="max-w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FORM_TYPE_LABELS) as FormType[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {FORM_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {FORM_TYPE_DESCRIPTIONS[draft.type]}
              {responseCount > 0
                ? " Locked — proposals have already come in through this form."
                : ""}
            </p>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="opens-at">Opens</Label>
              <Input
                id="opens-at"
                type="datetime-local"
                value={draft.opensAt}
                onChange={(event) => patch({ opensAt: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="closes-at">Closes</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="closes-at"
                  type="datetime-local"
                  value={draft.closesAt}
                  onChange={(event) => patch({ closesAt: event.target.value })}
                />
                {state === "open" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSaving || isPublishing || isClosingNow}
                    onClick={closeNow}
                  >
                    {isClosingNow ? "Closing..." : "Close now"}
                  </Button>
                ) : null}
              </div>
              {dateRangeInvalid ? (
                <p role="alert" className="text-sm text-destructive">
                  The close date has to be after the open date.
                </p>
              ) : null}
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Times are in the event&apos;s timezone ({eventTimezone}). Leave either blank for no
            limit — a published form with no dates accepts submissions immediately and
            indefinitely.
          </p>

          <Separator />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="max-submissions">Proposals per speaker</Label>
            <Input
              id="max-submissions"
              type="number"
              min={1}
              step={1}
              className="max-w-40"
              placeholder="No limit"
              value={draft.maxSubmissionsPerSpeaker}
              onChange={(event) => patch({ maxSubmissionsPerSpeaker: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank for no limit. Counted per email address across everything they&apos;ve
              sent you here, drafts included; a withdrawn proposal frees a slot. Someone who has
              used their allowance sees an explanation instead of the form.
            </p>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">Publishing</p>
            {/* What the public route actually does with an unpublished form
             * (decisions.md D-063): it renders the closed state, never a 404. */}
            <p className="text-sm text-muted-foreground">
              An unpublished form takes no submissions — anyone with the link sees the event and
              form name, a short note that this call isn&apos;t open, and a link to the public
              program, but never the questions. Publishing makes it live subject to the window
              above.
            </p>
            {responseCount > 0 ? (
              <p className="text-sm text-muted-foreground">
                {responseCount} {responseCount === 1 ? "proposal has" : "proposals have"} already
                come in. Removing or renaming a question won&apos;t delete answers already
                collected, but they&apos;ll stop being shown.
              </p>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
