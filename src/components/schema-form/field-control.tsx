"use client";

import { useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { LoaderCircleIcon, PaperclipIcon, XIcon } from "lucide-react";
import type { FormField } from "@/db/entities";
import type { FormValues } from "@/domain/forms";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { checkUpload, filenameFromKey, fileUrl, UPLOAD_ACCEPT_ATTRIBUTE, uploadProblemMessage } from "@/lib/uploads";
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

  return (
    <Controller
      control={control}
      name={field.id}
      render={({ field: controlled }) => {
        const key = typeof controlled.value === "string" ? controlled.value : "";
        return (
          <div className="flex flex-col gap-2">
            {key ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <PaperclipIcon className="size-4 shrink-0 text-muted-foreground" />
                <a
                  href={fileUrl(key)}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm text-primary underline-offset-4 hover:underline"
                >
                  {filenameFromKey(key)}
                </a>
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
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  id={field.id}
                  type="file"
                  accept={UPLOAD_ACCEPT_ATTRIBUTE}
                  disabled={busy}
                  className="file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium file:text-secondary-foreground"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setProblem(null);
                    const invalid = checkUpload(file);
                    if (invalid) {
                      setProblem(uploadProblemMessage(invalid));
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
                  }}
                />
                {busy ? (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <LoaderCircleIcon className="size-4 animate-spin" />
                    Uploading…
                  </span>
                ) : null}
              </div>
            )}
            {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
          </div>
        );
      }}
    />
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
}: {
  field: FormField;
  uploadAction: UploadAction;
  uploadScope: string;
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
                  <p className="text-sm text-muted-foreground">No options are set up yet.</p>
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
      {control_}
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  );
}
