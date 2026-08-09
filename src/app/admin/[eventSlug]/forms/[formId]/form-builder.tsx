"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { RESERVED_FIELD_IDS, type FormField } from "@/db/entities";
import {
  CONFIRMATION_MERGE_FIELDS,
  FORM_STATE_LABELS,
  allowsCoSpeakers,
  checkConfirmationEmail,
  fieldSchemaProblems,
  formWindowState,
  fromZonedInputValue,
  publicFields,
} from "@/domain/forms";
import { slugify } from "@/lib/slug";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { FieldEditor } from "./field-editor";
import { saveForm, setFormPublished } from "../actions";

export interface FormDraft {
  id: string;
  name: string;
  slug: string;
  welcomeCopy: string;
  fields: FormField[];
  /** "YYYY-MM-DDTHH:MM" wall clock in the event's timezone. */
  opensAt: string;
  closesAt: string;
  confirmationPageContent: string;
  confirmationEmailSubject: string;
  confirmationEmailBody: string;
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
  const [slugTouched, setSlugTouched] = useState(true);
  const [isSaving, startSaving] = useTransition();
  const [isPublishing, startPublishing] = useTransition();

  const problems = useMemo(() => fieldSchemaProblems(draft.fields), [draft.fields]);
  const emailCheck = useMemo(
    () => checkConfirmationEmail(draft.confirmationEmailSubject, draft.confirmationEmailBody),
    [draft.confirmationEmailSubject, draft.confirmationEmailBody],
  );
  const state = useMemo(
    () =>
      formWindowState({
        isPublished: draft.isPublished,
        opensAt: fromZonedInputValue(draft.opensAt, eventTimezone),
        closesAt: fromZonedInputValue(draft.closesAt, eventTimezone),
      }),
    [draft.isPublished, draft.opensAt, draft.closesAt, eventTimezone],
  );
  const preview = useMemo(
    () => publicFields(draft.fields, trackNames),
    [draft.fields, trackNames],
  );

  function patch(changes: Partial<FormDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function setFields(next: FormField[]) {
    patch({ fields: next });
  }

  async function persist(): Promise<boolean> {
    const result = await saveForm(eventSlug, draft.id, {
      name: draft.name,
      slug: draft.slug,
      welcomeCopy: draft.welcomeCopy,
      fields: draft.fields,
      opensAt: draft.opensAt,
      closesAt: draft.closesAt,
      confirmationPageContent: draft.confirmationPageContent,
      confirmationEmailSubject: draft.confirmationEmailSubject,
      confirmationEmailBody: draft.confirmationEmailBody,
    });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
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

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={isSaving || isPublishing}
            onClick={() => startSaving(async () => {
              if (await persist()) toast.success("Form saved");
            })}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            disabled={isSaving || isPublishing}
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
                Lowercase letters, numbers, and hyphens. Changing this breaks links you already
                shared.
              </p>
            </div>
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
              <Input
                id="closes-at"
                type="datetime-local"
                value={draft.closesAt}
                onChange={(event) => patch({ closesAt: event.target.value })}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Times are in the event&apos;s timezone ({eventTimezone}). Leave either blank for no
            limit — a published form with no dates accepts submissions immediately and
            indefinitely.
          </p>

          <Separator />

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">Publishing</p>
            <p className="text-sm text-muted-foreground">
              An unpublished form is invisible to the public — the link 404s, even for someone who
              guesses it. Publishing makes it live subject to the window above.
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
