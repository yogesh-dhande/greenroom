"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FormProvider, useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { FormField } from "@/db/entities";
import { buildFormValidator, visibleFields, type FormValues } from "@/domain/forms";
import { Button } from "@/components/ui/button";
import { FieldControl } from "./field-control";
import type { SchemaFormAction, UploadAction } from "./types";

export interface SchemaFormProps {
  /** Already resolved for the audience — see `publicFields` in domain/forms. */
  fields: FormField[];
  defaultValues: FormValues;
  submitLabel: string;
  pendingLabel: string;
  /** Bound server action that saves the answers. */
  action: SchemaFormAction;
  /** Bound server action that puts a picked file in R2. */
  uploadAction: UploadAction;
  /** Namespaces uploaded object keys, e.g. the form slug. */
  uploadScope: string;
  /**
   * Bound server action that saves an unfinished proposal (decisions.md D-034,
   * D-038). Omitted where drafts make no sense — editing something already
   * sent.
   */
  draftAction?: SchemaFormAction;
  draftLabel?: string;
  /** Rendered under the submit button (legal copy, edit hints…). */
  footnote?: React.ReactNode;
}

/**
 * Renders and validates a submission against a form's JSON field schema
 * (spec.md §2, §3; decisions.md D-009).
 *
 * One component serves all three places a submission is filled in — the
 * public CFP page, the same page after a validation failure, and the
 * submitter's own edit view in the portal — because all three are the same
 * job: schema in, answers out.
 *
 * The Zod validator is generated from the schema by `buildFormValidator`, so
 * required-field rules exist in exactly one place and the server re-runs the
 * identical check on the payload it receives. `showIf` is evaluated against
 * live form state, so a conditional question appears and disappears as the
 * submitter types — and a question that isn't on screen is never validated
 * and never saved.
 */
export function SchemaForm({
  fields,
  defaultValues,
  submitLabel,
  pendingLabel,
  action,
  uploadAction,
  uploadScope,
  draftAction,
  draftLabel = "Save draft",
  footnote,
}: SchemaFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  /**
   * A draft deliberately skips the browser's validation pass: the whole point
   * is to keep an answer that isn't finished yet. The server validates it
   * against the same schema with `required` relaxed, so a genuinely broken
   * answer (a malformed URL, an over-long abstract) still comes back as a
   * field error here.
   */
  async function onSaveDraft() {
    if (!draftAction) return;
    setFormError(null);
    methods.clearErrors();
    setSavingDraft(true);
    try {
      const result = await draftAction(methods.getValues());
      if (result.ok) {
        if (result.message) toast.success(result.message);
        if (result.redirectTo) router.push(result.redirectTo);
        return;
      }
      for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
        methods.setError(name, { message });
      }
      setFormError(result.error);
      toast.error(result.error);
    } finally {
      setSavingDraft(false);
    }
  }

  const resolver = useMemo(
    () => zodResolver(buildFormValidator(fields)) as unknown as Resolver<FormValues>,
    [fields],
  );

  const methods = useForm<FormValues>({
    resolver,
    defaultValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  return (
    <FormProvider {...methods}>
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={methods.handleSubmit(async (values) => {
          setFormError(null);
          const result = await action(values);
          if (result.ok) {
            if (result.message) toast.success(result.message);
            if (result.redirectTo) router.push(result.redirectTo);
            return;
          }
          for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
            methods.setError(name, { message });
          }
          setFormError(result.error);
          toast.error(result.error);
        })}
      >
        <VisibleFields fields={fields} uploadAction={uploadAction} uploadScope={uploadScope} />

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-border pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="lg"
              disabled={methods.formState.isSubmitting || savingDraft}
            >
              {methods.formState.isSubmitting ? pendingLabel : submitLabel}
            </Button>
            {draftAction ? (
              <Button
                type="button"
                size="lg"
                variant="outline"
                disabled={methods.formState.isSubmitting || savingDraft}
                onClick={onSaveDraft}
              >
                {savingDraft ? "Saving…" : draftLabel}
              </Button>
            ) : null}
          </div>
          {footnote}
        </div>
      </form>
    </FormProvider>
  );
}

/** Separated so the `useWatch` subscription re-renders only the field list. */
function VisibleFields({
  fields,
  uploadAction,
  uploadScope,
}: {
  fields: FormField[];
  uploadAction: UploadAction;
  uploadScope: string;
}) {
  const values = useWatch<FormValues>() as FormValues;
  const shown = visibleFields(fields, values ?? {});

  return (
    <div className="flex flex-col gap-6">
      {shown.map((field) => (
        <FieldControl
          key={field.id}
          field={field}
          uploadAction={uploadAction}
          uploadScope={uploadScope}
        />
      ))}
    </div>
  );
}
