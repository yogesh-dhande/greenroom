import type { Form, FormField } from "@/db/entities";
import { fileUrl, filenameFromKey } from "@/lib/uploads";

/**
 * One submitted answer as plain text, or `null` when the speaker left it
 * blank — blank answers are dropped rather than rendered as empty rows.
 *
 * Deliberately total over the stored shape: `responseJson` is
 * `Record<string, unknown>` (src/db/entities.ts), so every branch has to cope
 * with a value that doesn't match its field's type — a form edited after the
 * answers were filed is the normal way that happens.
 */
export function answerText(field: FormField, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (field.type === "checkbox") return value ? "Yes" : "No";

  if (field.type === "file") {
    return typeof value === "string" ? filenameFromKey(value) : null;
  }

  if (field.type === "co_speakers" && Array.isArray(value)) {
    const rows = value
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .map((row) =>
        [row.name, row.email, [row.title, row.company].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" — "),
      )
      .filter(Boolean);
    return rows.length === 0 ? null : rows.join("\n");
  }

  // Multiselects and checkbox groups arrive as arrays; one line of choices
  // reads better here than a bullet list inside a table-dense card.
  if (Array.isArray(value)) {
    const items = value.map(String).filter(Boolean);
    return items.length === 0 ? null : items.join(", ");
  }

  if (typeof value === "object") return null;
  return String(value);
}

function AnswerValue({ field, value }: { field: FormField; value: unknown }) {
  if (field.type === "file" && typeof value === "string" && value !== "") {
    // The Uploads card below lists the same file with its date; this link is
    // so the answer reads as an answer rather than as a missing one.
    return (
      <a
        href={fileUrl(value)}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline-offset-4 hover:underline"
      >
        {filenameFromKey(value)}
      </a>
    );
  }

  if (field.type === "url" && typeof value === "string") {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="break-all text-primary underline-offset-4 hover:underline"
      >
        {value}
      </a>
    );
  }

  return <>{answerText(field, value)}</>;
}

/**
 * What a speaker actually sent in through a form task — hotel preferences,
 * flight details, dietary needs (spec.md §6).
 *
 * Rendered from the linked form's own field schema, like the submission
 * detail page's answer list (decisions.md D-009), so a question an organizer
 * added shows up here with no code change. Without this the answers were
 * collected and stored on the assignment but readable nowhere in the admin —
 * only the file-type fields surfaced, in the Uploads card.
 */
export function TaskResponse({
  form,
  response,
}: {
  form: Form;
  response: Record<string, unknown>;
}) {
  const answered = form.fields.filter((field) => answerText(field, response[field.id]) !== null);
  if (answered.length === 0) return null;

  return (
    <dl className="grid gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5 sm:grid-cols-2">
      {answered.map((field) => (
        <div key={field.id} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
            {field.label}
          </dt>
          <dd className="text-sm whitespace-pre-line text-foreground">
            <AnswerValue field={field} value={response[field.id]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
