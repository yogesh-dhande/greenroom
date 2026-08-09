"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, Trash2Icon } from "lucide-react";
import type { FormField, FormFieldType } from "@/db/entities";
import { RESERVED_FIELD_IDS } from "@/db/entities";
import {
  FIELD_TYPE_LABELS,
  SELECTABLE_FIELD_TYPES,
  fieldTakesMaxLength,
  fieldTakesOptions,
  isReservedFieldId,
} from "@/domain/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Questions whose absence would break the submission pipeline: the title is
 * the submission's own title, and the identity questions are how a proposal
 * resolves to a person who can come back and edit it. */
const UNDELETABLE: string[] = [
  RESERVED_FIELD_IDS.title,
  RESERVED_FIELD_IDS.speakerName,
  RESERVED_FIELD_IDS.speakerEmail,
];

const CONDITION_LABELS: Record<string, string> = {
  eq: "is",
  neq: "is not",
  in: "is any of",
};

export interface FieldEditorProps {
  field: FormField;
  index: number;
  total: number;
  /** Questions above this one — the only valid targets for a condition. */
  earlier: FormField[];
  trackNames: string[];
  onChange: (next: FormField) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

/**
 * One question in the builder (spec.md §2, decisions.md D-009).
 *
 * Collapsed by default so a 10-question form is still readable at a glance,
 * and every control is phrased for an organizer rather than a developer — the
 * word "schema" appears nowhere, "only show this question when…" replaces
 * `showIf`, and the internal answer key is shown but not editable once the
 * form exists (changing it would orphan answers already collected).
 */
export function FieldEditor({
  field,
  index,
  total,
  earlier,
  trackNames,
  onChange,
  onMove,
  onRemove,
}: FieldEditorProps) {
  const [open, setOpen] = useState(false);
  const isTracks = field.id === RESERVED_FIELD_IDS.tracks;
  const isCoSpeakers = field.type === "co_speakers";
  const conditionTarget = field.showIf
    ? (earlier.find((other) => other.id === field.showIf!.fieldId) ?? null)
    : null;

  function patch(changes: Partial<FormField>) {
    onChange({ ...field, ...changes });
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-start gap-3 p-3">
        <div className="flex flex-col">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Move ${field.label} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Move ${field.label} down`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ChevronDownIcon />
          </Button>
        </div>

        <button
          type="button"
          className="flex flex-1 flex-col items-start gap-1 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {field.label || "Untitled question"}
            </span>
            {field.required ? (
              <Badge variant="secondary" className="text-xs">
                Required
              </Badge>
            ) : null}
            {field.showIf ? (
              <Badge variant="outline" className="text-xs">
                Conditional
              </Badge>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {FIELD_TYPE_LABELS[field.type]}
            {isReservedFieldId(field.id) ? " · built-in" : ` · ${field.id}`}
          </span>
        </button>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${field.label}`}
          disabled={UNDELETABLE.includes(field.id)}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>

      {open ? (
        <div className="flex flex-col gap-4 border-t border-border p-4">
          {isCoSpeakers ? (
            <p className="text-sm text-muted-foreground">
              Speakers can add as many co-speakers as they like — name and email each. Co-speakers
              are never required. Turn this block off with the co-speaker switch above.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${field.id}-label`}>Question</Label>
              <Input
                id={`${field.id}-label`}
                value={field.label}
                onChange={(event) => patch({ label: event.target.value })}
              />
            </div>

            {!isCoSpeakers ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${field.id}-type`}>Answer type</Label>
                <Select
                  value={field.type}
                  onValueChange={(value) => {
                    const type = value as FormFieldType;
                    patch({
                      type,
                      options: fieldTakesOptions(type) ? (field.options ?? []) : undefined,
                      maxLength: fieldTakesMaxLength(type) ? field.maxLength : undefined,
                    });
                  }}
                >
                  <SelectTrigger id={`${field.id}-type`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(isTracks
                      ? (["select", "multiselect"] as FormFieldType[])
                      : SELECTABLE_FIELD_TYPES
                    ).map((type) => (
                      <SelectItem key={type} value={type}>
                        {FIELD_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isTracks ? (
                  <p className="text-xs text-muted-foreground">
                    &ldquo;Choose one&rdquo; lets a speaker pick a single track; &ldquo;Choose
                    any&rdquo; lets them tick several.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${field.id}-help`}>Help text (optional)</Label>
            <Input
              id={`${field.id}-help`}
              value={field.helpText ?? ""}
              placeholder="Shown under the question"
              onChange={(event) => patch({ helpText: event.target.value || undefined })}
            />
          </div>

          {isTracks ? (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm text-foreground">Choices come from your event&apos;s tracks</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {trackNames.length > 0
                  ? trackNames.join(", ")
                  : "You have no tracks yet — add them in Settings and they'll appear here automatically."}
              </p>
            </div>
          ) : fieldTakesOptions(field.type) ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${field.id}-options`}>Choices</Label>
              <Textarea
                id={`${field.id}-options`}
                rows={4}
                value={(field.options ?? []).join("\n")}
                placeholder={"One choice per line"}
                onChange={(event) =>
                  patch({
                    options: event.target.value
                      .split("\n")
                      .map((option) => option.trim())
                      .filter(Boolean),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">One choice per line.</p>
            </div>
          ) : null}

          {fieldTakesMaxLength(field.type) ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${field.id}-max`}>Longest answer (optional)</Label>
              <Input
                id={`${field.id}-max`}
                type="number"
                min={1}
                step={1}
                className="max-w-40"
                placeholder="No limit"
                value={field.maxLength === undefined ? "" : String(field.maxLength)}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  const parsed = Number(raw);
                  patch({
                    maxLength:
                      raw === "" || !Number.isInteger(parsed) || parsed < 1 ? undefined : parsed,
                  });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Characters. Speakers see a counter as they approach it, and an answer over the
                limit is refused when they submit.
              </p>
            </div>
          ) : null}

          {!isCoSpeakers ? (
            <div className="flex items-center gap-3">
              <Switch
                id={`${field.id}-required`}
                checked={field.required === true}
                onCheckedChange={(checked) => patch({ required: checked })}
              />
              <Label htmlFor={`${field.id}-required`} className="font-normal">
                Speakers must answer this
              </Label>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex items-center gap-3">
              <Switch
                id={`${field.id}-conditional`}
                checked={Boolean(field.showIf)}
                disabled={earlier.length === 0}
                onCheckedChange={(checked) =>
                  patch(
                    checked
                      ? { showIf: { fieldId: earlier[0].id, op: "eq", value: "" } }
                      : { showIf: undefined },
                  )
                }
              />
              <Label htmlFor={`${field.id}-conditional`} className="font-normal">
                Only show this question sometimes
              </Label>
            </div>

            {earlier.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                A conditional question has to depend on a question above it — move this one down
                first.
              </p>
            ) : null}

            {field.showIf ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${field.id}-cond-field`} className="text-xs">
                    When
                  </Label>
                  <Select
                    value={field.showIf.fieldId}
                    onValueChange={(value) =>
                      patch({ showIf: { ...field.showIf!, fieldId: value, value: "" } })
                    }
                  >
                    <SelectTrigger id={`${field.id}-cond-field`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {earlier.map((other) => (
                        <SelectItem key={other.id} value={other.id}>
                          {other.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${field.id}-cond-op`} className="text-xs">
                    Comparison
                  </Label>
                  <Select
                    value={field.showIf.op}
                    onValueChange={(value) =>
                      patch({
                        showIf: { ...field.showIf!, op: value as "eq" | "neq" | "in" },
                      })
                    }
                  >
                    <SelectTrigger id={`${field.id}-cond-op`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CONDITION_LABELS).map(([op, label]) => (
                        <SelectItem key={op} value={op}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${field.id}-cond-value`} className="text-xs">
                    This answer
                  </Label>
                  <ConditionValue
                    id={`${field.id}-cond-value`}
                    target={conditionTarget}
                    trackNames={trackNames}
                    multiple={field.showIf.op === "in"}
                    value={field.showIf.value}
                    onChange={(value) => patch({ showIf: { ...field.showIf!, value } })}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The right-hand side of a condition: a picker when the question it depends
 * on has fixed choices, free text otherwise. */
function ConditionValue({
  id,
  target,
  trackNames,
  multiple,
  value,
  onChange,
}: {
  id: string;
  target: FormField | null;
  trackNames: string[];
  multiple: boolean;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const choices =
    target?.id === RESERVED_FIELD_IDS.tracks
      ? trackNames
      : target && fieldTakesOptions(target.type)
        ? (target.options ?? [])
        : target?.type === "checkbox"
          ? ["true"]
          : null;

  if (multiple || !choices || choices.length === 0) {
    const text = Array.isArray(value) ? value.join(", ") : value;
    return (
      <>
        <Input
          id={id}
          value={text}
          placeholder={multiple ? "Workshop, Tutorial" : "Type the answer"}
          onChange={(event) =>
            onChange(
              multiple
                ? event.target.value
                    .split(",")
                    .map((part) => part.trim())
                    .filter(Boolean)
                : event.target.value,
            )
          }
        />
        {multiple ? (
          <p className="text-xs text-muted-foreground">Separate answers with commas.</p>
        ) : null}
      </>
    );
  }

  const selected = Array.isArray(value) ? (value[0] ?? "") : value;
  return (
    <Select value={selected} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose an answer…" />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice} value={choice}>
            {target?.type === "checkbox" ? "ticked" : choice}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
