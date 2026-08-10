"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcwIcon, SaveIcon } from "lucide-react";
import { toast } from "sonner";
import { checkTemplateDraft, templatePreviewData, type MergeData, type MergeField } from "@/domain/comms-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resetTemplateOverride, saveTemplateOverride } from "./actions";
import { BlankFieldNote, DraftProblems, MergeFieldPalette, MessagePreview } from "./merge-fields";
import type { TemplateRow } from "./types";

/**
 * Per-event wording for the messages Greenroom sends on its own (spec.md §7's
 * "templated messages with merge fields").
 *
 * An event that edits nothing uses Greenroom's copy; saving stores an
 * override row and "Use Greenroom's wording" deletes it, so there's always a
 * working message underneath and an organizer can never paint themselves into
 * a broken confirmation email.
 *
 * A save with a bad merge field is refused outright rather than warned about
 * — this copy is used for every future send of its kind, so the moment of
 * saving is the last time a human looks at it.
 */
export function TemplateEditor({
  eventSlug,
  templates,
  eventMergeData,
}: {
  eventSlug: string;
  templates: TemplateRow[];
  /** This event's real dates/URLs/organizer name (decisions.md D-053) — see
   * ComposeForm for how it overlays `templatePreviewData`'s generic
   * defaults, so this editor's preview shows the signed-in organizer's own
   * name instead of the generic sample. */
  eventMergeData: MergeData;
}) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id);
  const selected = templates.find((template) => template.id === selectedId) ?? templates[0];

  if (!selected) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav className="flex flex-col gap-1" aria-label="Message templates">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => setSelectedId(template.id)}
            aria-current={template.id === selected.id}
            className={
              template.id === selected.id
                ? "rounded-md bg-muted px-3 py-2 text-left text-sm font-medium text-foreground"
                : "rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/60"
            }
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{template.name}</span>
              {template.isOverride ? (
                <Badge variant="outline" className="shrink-0">
                  Edited
                </Badge>
              ) : null}
            </span>
          </button>
        ))}
      </nav>

      {/* Keyed so switching templates resets the draft rather than carrying
          one message's half-finished copy into another's editor. */}
      <TemplateForm
        key={selected.id}
        eventSlug={eventSlug}
        template={selected}
        eventMergeData={eventMergeData}
      />
    </div>
  );
}

function TemplateForm({
  eventSlug,
  template,
  eventMergeData,
}: {
  eventSlug: string;
  template: TemplateRow;
  eventMergeData: MergeData;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [saving, startSave] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const check = useMemo(
    () =>
      checkTemplateDraft(
        subject,
        body,
        template.availableFields,
        templatePreviewData(eventMergeData),
      ),
    [subject, body, template.availableFields, eventMergeData],
  );

  const dirty = subject !== template.subject || body !== template.body;

  function insert(field: MergeField) {
    const token = `{{${field}}}`;
    const textarea = bodyRef.current;
    if (!textarea) {
      setBody((current) => current + token);
      return;
    }
    const { selectionStart, selectionEnd } = textarea;
    setBody((current) => current.slice(0, selectionStart) + token + current.slice(selectionEnd));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart + token.length, selectionStart + token.length);
    });
  }

  function save() {
    startSave(async () => {
      const result = await saveTemplateOverride(eventSlug, {
        templateId: template.id,
        subject,
        body,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Saved “${template.name}”`);
      router.refresh();
    });
  }

  function revert() {
    startSave(async () => {
      const result = await resetTemplateOverride(eventSlug, template.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSubject(result.data.subject);
      setBody(result.data.body);
      toast.success("Back to Greenroom's wording");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-medium text-foreground">{template.name}</h2>
        <p className="text-sm text-muted-foreground">{template.description}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`subject-${template.id}`}>Subject</Label>
        <Input
          id={`subject-${template.id}`}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`body-${template.id}`}>Message</Label>
        <Textarea
          id={`body-${template.id}`}
          ref={bodyRef}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={16}
          className="font-mono text-sm"
        />
      </div>

      <MergeFieldPalette fields={template.availableFields} onInsert={insert} />
      <DraftProblems errors={check.errors} />
      <BlankFieldNote blank={check.blank} />
      <MessagePreview preview={check.preview} />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty || check.errors.length > 0 || saving}>
          <SaveIcon />
          {saving ? "Saving…" : "Save wording"}
        </Button>
        {template.isOverride || dirty ? (
          <Button variant="outline" onClick={revert} disabled={saving}>
            <RotateCcwIcon />
            Use Greenroom&apos;s wording
          </Button>
        ) : null}
        {check.errors.length > 0 ? (
          <p className="text-sm text-destructive">Fix the problems above before saving.</p>
        ) : null}
      </div>
    </div>
  );
}
