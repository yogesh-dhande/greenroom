"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { PlusIcon, Trash2Icon } from "lucide-react";
import type { FormField } from "@/db/entities";
import { coSpeakerRows, type CoSpeakerValue, type FormValues } from "@/domain/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMPTY_ROW: CoSpeakerValue = { name: "", email: "", title: "", company: "" };

function rowError(
  errors: Record<string, unknown>,
  fieldId: string,
  index: number,
  key: keyof CoSpeakerValue,
): string | undefined {
  const list = errors[fieldId] as unknown;
  if (!list || typeof list !== "object") return undefined;
  const row = (list as Record<number, unknown>)[index];
  if (!row || typeof row !== "object") return undefined;
  const entry = (row as Record<string, { message?: string }>)[key];
  return entry?.message;
}

/**
 * The co-speaker repeater (spec.md §2 — "speaker and co-speaker info,
 * multi-speaker supported, **never required**").
 *
 * Rows are plain values on the form state rather than a `useFieldArray`, so
 * the whole schema-driven renderer keeps one uniform value shape: an array of
 * `{name, email, title, company}` that the submit action turns into
 * `submission_speakers` rows. Blank rows are dropped on save, so "clicked add
 * and changed my mind" never blocks a submission.
 */
export function CoSpeakersField({ field }: { field: FormField }) {
  const { control, setValue, register, formState } = useFormContext<FormValues>();
  const raw = useWatch({ control, name: field.id });
  const rows = coSpeakerRows(raw);

  function update(next: Array<Partial<CoSpeakerValue>>) {
    setValue(field.id, next, { shouldDirty: true, shouldValidate: formState.isSubmitted });
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium text-foreground">{field.label}</legend>
      {field.helpText ? (
        <p className="-mt-1 text-sm text-muted-foreground">{field.helpText}</p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No co-speakers yet — that&apos;s completely fine.
        </p>
      ) : null}

      {rows.map((row, index) => (
        <div
          key={index}
          role="group"
          aria-label={`Co-speaker ${index + 1}`}
          className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Co-speaker {index + 1}</p>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove co-speaker ${index + 1}`}
              onClick={() => update(rows.filter((_, i) => i !== index))}
            >
              <Trash2Icon />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${field.id}-${index}-name`}>Name</Label>
              <Input
                id={`${field.id}-${index}-name`}
                defaultValue={row.name ?? ""}
                {...register(`${field.id}.${index}.name`)}
              />
              {rowError(formState.errors as Record<string, unknown>, field.id, index, "name") ? (
                <p className="text-sm text-destructive">
                  {rowError(formState.errors as Record<string, unknown>, field.id, index, "name")}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${field.id}-${index}-email`}>Email</Label>
              <Input
                id={`${field.id}-${index}-email`}
                type="email"
                defaultValue={row.email ?? ""}
                {...register(`${field.id}.${index}.email`)}
              />
              {rowError(formState.errors as Record<string, unknown>, field.id, index, "email") ? (
                <p className="text-sm text-destructive">
                  {rowError(formState.errors as Record<string, unknown>, field.id, index, "email")}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${field.id}-${index}-title`}>Job title (optional)</Label>
              <Input
                id={`${field.id}-${index}-title`}
                defaultValue={row.title ?? ""}
                {...register(`${field.id}.${index}.title`)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${field.id}-${index}-company`}>Company (optional)</Label>
              <Input
                id={`${field.id}-${index}-company`}
                defaultValue={row.company ?? ""}
                {...register(`${field.id}.${index}.company`)}
              />
            </div>
          </div>
        </div>
      ))}

      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => update([...rows, { ...EMPTY_ROW }])}
        >
          <PlusIcon />
          Add a co-speaker
        </Button>
      </div>
    </fieldset>
  );
}
