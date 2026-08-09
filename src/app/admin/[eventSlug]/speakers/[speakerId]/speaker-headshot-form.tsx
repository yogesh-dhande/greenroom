"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import {
  checkUpload,
  IMAGE_ACCEPT_ATTRIBUTE,
  isImageUploadType,
  MAX_UPLOAD_LABEL,
  uploadProblemMessage,
} from "@/lib/uploads";
import { Input } from "@/components/ui/input";
import { uploadSpeakerHeadshot } from "../actions";

/**
 * Organizer-supplied headshot (decisions.md D-054(5)) — the same picker as the
 * portal's own headshot control (src/components/schema-form/field-control.tsx
 * `FileControl`, and `/portal/profile`'s current-headshot block above it): a
 * click uploads immediately, no crop or preview beyond the current photo
 * shown next to this control. The picked file goes straight to
 * `uploadSpeakerHeadshot`, which validates it the same way the portal does
 * and writes `headshotUrl` in one step.
 */
export function SpeakerHeadshotForm({
  eventSlug,
  speakerId,
}: {
  eventSlug: string;
  speakerId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);

    // Same pre-check the portal runs client-side before it ever reaches R2.
    const problem = checkUpload(file);
    if (problem) {
      setError(uploadProblemMessage(problem));
      event.target.value = "";
      return;
    }
    if (!isImageUploadType(file.type)) {
      setError("A headshot has to be an image — JPEG, PNG, WebP, GIF, or AVIF.");
      event.target.value = "";
      return;
    }

    setBusy(true);
    try {
      const data = new FormData();
      data.set("file", file);
      const result = await uploadSpeakerHeadshot(eventSlug, speakerId, data);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Headshot updated");
      // The server component above this reads `speaker.headshotUrl` directly,
      // so the new photo needs a fresh render to show up here.
      router.refresh();
    } catch {
      setError("That upload didn't go through — try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          type="file"
          aria-label="Upload headshot"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          disabled={busy}
          onChange={onChange}
          className="file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium file:text-secondary-foreground"
        />
        {busy ? (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" />
            Uploading…
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Square, at least 800×800 — JPEG, PNG, WebP, GIF, or AVIF, up to {MAX_UPLOAD_LABEL}.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
