"use client";

import { useId, useState, useTransition } from "react";
import { HistoryIcon, PaperclipIcon } from "lucide-react";
import { toast } from "sonner";
import type { CommentView, FileRef } from "@/domain/files";
import { formatFileMoment, MAX_COMMENT_LENGTH } from "@/domain/files";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SchemaFormResult } from "@/components/schema-form/types";

/**
 * The two surfaces a deliverable carries with it — its superseded uploads and
 * its comment thread (decisions.md D-054) — rendered identically for the
 * speaker (portal task card) and the organizer (Admin > Files), so neither
 * side sees a different history from the other.
 */

/** Everything this deliverable used to be, newest first. Renders nothing
 * when the current file is the only one there has ever been. */
export function FileVersionList({
  versions,
  timeZone,
}: {
  versions: FileRef[];
  timeZone: string;
}) {
  if (versions.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <HistoryIcon className="size-3.5" />
        Earlier versions
      </p>
      <ul className="flex flex-col gap-1">
        {versions.map((version) => (
          <li
            key={`${version.url}-${version.uploadedAt.getTime()}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm"
          >
            <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <a
              href={version.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {version.filename}
            </a>
            <span className="text-xs text-muted-foreground">
              {formatFileMoment(version.uploadedAt, timeZone)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The thread on one deliverable: oldest first, then a box to add to it.
 * `action` is a server action already bound to the assignment — the caller
 * decides who is allowed to post, this only collects the text.
 */
export function FileCommentThread({
  comments,
  timeZone,
  action,
  placeholder = "Add a comment…",
}: {
  comments: CommentView[];
  timeZone: string;
  action: (body: string) => Promise<SchemaFormResult>;
  placeholder?: string;
}) {
  const fieldId = useId();
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  function post() {
    const trimmed = body.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await action(trimmed);
      if (result.ok) {
        setBody("");
        if (result.message) toast.success(result.message);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">
        Comments
      </Label>

      {comments.length === 0 ? (
        <EmptyState variant="inline" title="No comments yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {comment.authorName} — {formatFileMoment(comment.createdAt, timeZone)}
              </p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap text-foreground">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      <Textarea
        id={fieldId}
        rows={2}
        value={body}
        maxLength={MAX_COMMENT_LENGTH}
        placeholder={placeholder}
        onChange={(event) => setBody(event.target.value)}
      />
      <div>
        <Button type="button" size="sm" variant="outline" disabled={isPending || !body.trim()} onClick={post}>
          {isPending ? "Posting…" : "Post comment"}
        </Button>
      </div>
    </div>
  );
}
