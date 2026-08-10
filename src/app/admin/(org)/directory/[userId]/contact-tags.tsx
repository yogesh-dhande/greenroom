"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import { TAG_MAX_LENGTH } from "@/domain/crm";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addContactTag, removeContactTag } from "../actions";

/**
 * Free-form tags on one contact (spec.md "Org-level speaker CRM"; D-077
 * excludes custom-field builders — tags are the whole vocabulary).
 *
 * Tags are normalized server-side (trim, collapse whitespace, casefold), so
 * "AI " and "ai" are one tag and re-adding one is a no-op rather than a
 * duplicate. The length cap is enforced here as well as in the action, so an
 * organizer sees the limit while typing instead of after submitting.
 */
export function ContactTags({ userId, tags }: { userId: string; tags: string[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [isPending, startTransition] = useTransition();

  function add() {
    const value = label.trim();
    if (value === "") return;
    startTransition(async () => {
      const result = await addContactTag({ userId, label: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLabel("");
      toast.success(result.data.message);
      router.refresh();
    });
  }

  function remove(tag: string) {
    startTransition(async () => {
      const result = await removeContactTag({ userId, label: tag });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.message);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {tags.length === 0 ? (
        <EmptyState
          variant="inline"
          title="No tags yet."
          description="Tags are yours, not the speaker's — use them to slice the directory."
        />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="outline" className="gap-1 pr-1">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                disabled={isPending}
                onClick={() => remove(tag)}
                className="rounded-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-tag">Add tag</Label>
        <div className="flex items-center gap-2">
          <Input
            id="contact-tag"
            value={label}
            maxLength={TAG_MAX_LENGTH}
            placeholder="ai"
            className="h-8 w-48"
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              add();
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || label.trim() === ""}
            onClick={add}
          >
            {isPending ? "Saving…" : "Add tag"}
          </Button>
        </div>
      </div>
    </div>
  );
}
