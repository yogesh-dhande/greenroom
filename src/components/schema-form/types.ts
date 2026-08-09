import type { FormValues } from "@/domain/forms";

/** What an upload server action gives back to the file control. */
export type UploadResult =
  | { ok: true; key: string; filename: string }
  | { ok: false; error: string };

/** Server action signature the file control calls (bound in a page). */
export type UploadAction = (formData: FormData) => Promise<UploadResult>;

/** What a save/submit server action gives back to the renderer. */
export type SchemaFormResult =
  | { ok: true; message?: string; redirectTo?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Server action signature the renderer submits to (bound in a page). */
export type SchemaFormAction = (values: FormValues) => Promise<SchemaFormResult>;
