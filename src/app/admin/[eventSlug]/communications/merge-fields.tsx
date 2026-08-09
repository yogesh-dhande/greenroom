"use client";

import type { MergeField, RenderedEmail } from "@/domain/comms-templates";
import { Badge } from "@/components/ui/badge";

/**
 * Bits shared by the composer and the template editor.
 *
 * Both screens ask the same question of a draft — will this render, and what
 * will it look like — so they share the answer's presentation. Everything here
 * takes already-computed values; the checking itself lives in
 * `checkTemplateDraft` (src/domain/comms-templates.ts) where it's unit-tested
 * and where the server action re-runs it.
 */

/**
 * The merge fields this message can fill in, as click-to-insert chips.
 *
 * Listing them is what makes merge fields usable at all: an organizer can't
 * be expected to remember that it's `{{speakerFirstName}}` and not
 * `{{firstName}}`, and a typo is silent — it renders as empty space.
 */
export function MergeFieldPalette({
  fields,
  onInsert,
}: {
  fields: readonly MergeField[];
  onInsert: (field: MergeField) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Click to insert. Each one is replaced with the recipient&apos;s own details when the
        message is sent.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {fields.map((field) => (
          <button
            key={field}
            type="button"
            onClick={() => onInsert(field)}
            className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            {`{{${field}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Blocking problems with a draft.
 *
 * Rendered as errors rather than warnings on purpose: an unknown placeholder
 * or a field this send path can't fill doesn't degrade the message, it puts a
 * hole in it, and nobody re-reads mail after it's sent.
 */
export function DraftProblems({ errors }: { errors: readonly string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
      {errors.map((error) => (
        <li key={error}>{error}</li>
      ))}
    </ul>
  );
}

/** Merge fields that are valid here but happen to be empty for this preview. */
export function BlankFieldNote({ blank }: { blank: readonly MergeField[] }) {
  if (blank.length === 0) return null;
  return (
    <p className="rounded-md border border-warning bg-warning/10 p-3 text-sm text-warning">
      {blank.map((field) => `{{${field}}}`).join(", ")} will be blank for recipients who
      don&apos;t have one.
    </p>
  );
}

/** What the message will actually look like, with sample details filled in. */
export function MessagePreview({ preview }: { preview: RenderedEmail }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline">Preview</Badge>
        <span className="text-sm font-medium text-foreground">{preview.subject}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{preview.text}</p>
    </div>
  );
}
