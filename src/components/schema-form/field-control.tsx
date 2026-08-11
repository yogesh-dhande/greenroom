"use client";

import { useState } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { LoaderCircleIcon, PaperclipIcon, XIcon } from "lucide-react";
import type { FormField } from "@/db/entities";
import {
  effectiveMaxLength,
  showsCharacterCount,
  uploadKindForField,
  type FormValues,
} from "@/domain/forms";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  acceptAttributeForKind,
  checkUpload,
  filenameFromKey,
  fileUrl,
  isImageKey,
  uploadProblemMessage,
} from "@/lib/uploads";
import { CoSpeakersField } from "./co-speakers-field";
import type { UploadAction } from "./types";

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * A file question (headshot, supporting document — spec.md §2). The file goes
 * straight to R2 through a server action as soon as it's picked, and the form
 * value is the returned object key: an upload that succeeded survives a
 * validation error elsewhere on the form, and nothing has to be re-picked.
 */
function FileControl({
  field,
  uploadAction,
  uploadScope,
}: {
  field: FormField;
  uploadAction: UploadAction;
  uploadScope: string;
}) {
  const { control } = useFormContext<FormValues>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A headshot question takes pictures only (decisions.md D-022) — the answer
  // becomes the speaker's photo. Everything else takes the general set.
  const kind = uploadKindForField(field);

  return (
    <Controller
      control={control}
      name={field.id}
      render={({ field: controlled }) => {
        const key = typeof controlled.value === "string" ? controlled.value : "";
        async function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
          const file = event.target.files?.[0];
          if (!file) return;
          setProblem(null);
          const invalid = checkUpload(file, kind);
          if (invalid) {
            setProblem(uploadProblemMessage(invalid, kind));
            event.target.value = "";
            return;
          }
          setBusy(true);
          try {
            const data = new FormData();
            data.set("file", file);
            data.set("scope", uploadScope);
            const result = await uploadAction(data);
            if (result.ok) controlled.onChange(result.key);
            else setProblem(result.error);
          } catch {
            setProblem("That upload didn't go through — try again.");
          } finally {
            setBusy(false);
            event.target.value = "";
          }
        }

        return (
          <div className="flex flex-col gap-2">
            {key ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                {isImageKey(key) ? (
                  // A headshot (or any other image answer) previews as a
                  // thumbnail rather than a bare filename — same idea as the
                  // current-headshot block on /portal/profile, just sized to
                  // sit inline in a single form row.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={fileUrl(key)}
                    alt=""
                    className="size-8 shrink-0 rounded object-cover"
                  />
                ) : (
                  <PaperclipIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <a
                  href={fileUrl(key)}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm text-primary underline-offset-4 hover:underline"
                >
                  {filenameFromKey(key)}
                </a>
                <Button type="button" size="sm" variant="outline" asChild>
                  <label htmlFor={field.id} className="cursor-pointer">
                    Replace
                  </label>
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`Remove ${field.label}`}
                  onClick={() => controlled.onChange("")}
                >
                  <XIcon />
                </Button>
              </div>
            ) : null}
            <Input
              id={field.id}
              type="file"
              accept={acceptAttributeForKind(kind)}
              disabled={busy}
              className={key
                ? "sr-only"
                : "file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium file:text-secondary-foreground"}
              onChange={pickFile}
            />
            {busy ? (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                {key ? "Uploading replacement…" : "Uploading…"}
              </span>
            ) : null}
            {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
          </div>
        );
      }}
    />
  );
}

/**
 * The live character count for a capped question (decisions.md D-034, D-038).
 *
 * It stays out of the way until the answer is close to the cap — a counter
 * sitting under every box from the first keystroke reads as a demand for a
 * long answer. Short caps (a 60-character tagline) show it immediately, since
 * there is no "far from the limit" to speak of.
 *
 * The input is deliberately *not* given a hard `maxlength`: silently swallowing
 * the tail of a pasted abstract is worse than saying it's too long.
 */
function CharacterCount({ field, max }: { field: FormField; max: number }) {
  const value = useWatch({ name: field.id });
  const length = typeof value === "string" ? value.length : 0;
  if (!showsCharacterCount(max, length)) return null;

  const over = length > max;
  return (
    <p
      className={over ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
      aria-live="polite"
    >
      {over ? `${length - max} characters over the ${max} limit` : `${length} / ${max} characters`}
    </p>
  );
}

/**
 * Renders one question from the JSON field schema (decisions.md D-009).
 *
 * Every control is driven by react-hook-form, and every type maps onto a
 * shadcn primitive so the public CFP page inherits the same design tokens as
 * the admin (decisions.md D-018). Multi-choice questions are rendered as a
 * checkbox group rather than a bespoke multiselect widget: it's the most
 * legible option for a public form, and it needs no new dependency.
 */
export function FieldControl({
  field,
  uploadAction,
  uploadScope,
  note,
}: {
  field: FormField;
  uploadAction: UploadAction;
  uploadScope: string;
  /** Runtime note (e.g. "prefilled from your session") - distinct from the
   * schema's own `field.helpText`, which an organizer writes once and every
   * submitter sees. */
  note?: string;
}) {
  const { control, register, formState } = useFormContext<FormValues>();
  const error = formState.errors[field.id] as { message?: string } | undefined;
  const message = typeof error?.message === "string" ? error.message : undefined;

  if (field.type === "co_speakers") {
    return <CoSpeakersField field={field} />;
  }

  if (field.type === "checkbox") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-2.5">
          <Controller
            control={control}
            name={field.id}
            render={({ field: controlled }) => (
              <Checkbox
                id={field.id}
                checked={controlled.value === true}
                onCheckedChange={(checked) => controlled.onChange(checked === true)}
                onBlur={controlled.onBlur}
                aria-invalid={Boolean(message)}
              />
            )}
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor={field.id} className="font-normal">
              {field.label}
              {field.required ? <span className="text-destructive"> *</span> : null}
            </Label>
            {field.helpText ? (
              <p className="text-sm text-muted-foreground">{field.helpText}</p>
            ) : null}
          </div>
        </div>
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
      </div>
    );
  }

  const label = (
    <Label htmlFor={field.id}>
      {field.label}
      {field.required ? <span className="text-destructive"> *</span> : null}
    </Label>
  );
  const help = field.helpText ? (
    <p className="text-sm text-muted-foreground">{field.helpText}</p>
  ) : null;
  const noteText = note ? <p className="text-sm text-muted-foreground">{note}</p> : null;

  const max = effectiveMaxLength(field);

  let control_: React.ReactNode;
  switch (field.type) {
    case "textarea":
      control_ = (
        <Textarea id={field.id} rows={6} aria-invalid={Boolean(message)} {...register(field.id)} />
      );
      break;
    case "select":
      control_ = (
        <Controller
          control={control}
          name={field.id}
          render={({ field: controlled }) => (
            <Select
              value={typeof controlled.value === "string" ? controlled.value : ""}
              onValueChange={controlled.onChange}
            >
              <SelectTrigger id={field.id} aria-invalid={Boolean(message)} className="w-full">
                <SelectValue placeholder="Choose one…" />
              </SelectTrigger>
              <SelectContent>
                {(field.options ?? []).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      );
      break;
    case "multiselect":
      control_ = (
        <Controller
          control={control}
          name={field.id}
          render={({ field: controlled }) => {
            const selected = asStringList(controlled.value);
            return (
              <div
                role="group"
                aria-labelledby={`${field.id}-label`}
                className="flex flex-col gap-2 rounded-md border border-border p-3"
              >
                {(field.options ?? []).length === 0 ? (
                  <EmptyState variant="inline" title="No options are set up yet." />
                ) : null}
                {(field.options ?? []).map((option) => {
                  const optionId = `${field.id}-${option.replace(/\W+/g, "-").toLowerCase()}`;
                  return (
                    <div key={option} className="flex items-center gap-2.5">
                      <Checkbox
                        id={optionId}
                        checked={selected.includes(option)}
                        onCheckedChange={(checked) =>
                          controlled.onChange(
                            checked === true
                              ? [...selected, option]
                              : selected.filter((value) => value !== option),
                          )
                        }
                      />
                      <Label htmlFor={optionId} className="font-normal">
                        {option}
                      </Label>
                    </div>
                  );
                })}
              </div>
            );
          }}
        />
      );
      break;
    case "file":
      control_ = <FileControl field={field} uploadAction={uploadAction} uploadScope={uploadScope} />;
      break;
    default:
      control_ = (
        <Input
          id={field.id}
          type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
          aria-invalid={Boolean(message)}
          {...register(field.id)}
        />
      );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {field.type === "multiselect" ? (
        <span id={`${field.id}-label`} className="text-sm leading-none font-medium">
          {field.label}
          {field.required ? <span className="text-destructive"> *</span> : null}
        </span>
      ) : (
        label
      )}
      {help}
      {noteText}
      {control_}
      {max !== null ? <CharacterCount field={field} max={max} /> : null}
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  );
}
