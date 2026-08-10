"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import {
  checkTemplateDraft,
  templatePreviewData,
  type MergeData,
  type MergeField,
} from "@/domain/comms-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PeoplePicker, SelectionSummary } from "@/components/people-picker/people-picker";
import type { GroupDefinition } from "@/components/people-picker/selection";
import {
  BlankFieldNote,
  DraftProblems,
  MergeFieldPalette,
  MessagePreview,
} from "@/app/admin/[eventSlug]/communications/merge-fields";
import { sendDirectoryEmail } from "./actions";
import { ORG_MERGE_FIELDS, orgSpeakerFields } from "./org-merge-fields";
import type { RecipientOption } from "./types";

interface SendResult {
  sent: number;
  failed: number;
  failures: string[];
}

/**
 * Bulk outreach to selected directory contacts (spec.md "Org-level speaker
 * CRM": select contacts and email them with the merge-tag composer).
 *
 * The event composer's machinery without an event: the same palette, the same
 * live `checkTemplateDraft` validation, the same preview component — over
 * `ORG_MERGE_FIELDS`, which is the honest subset an org-level send can fill.
 * A draft naming `{{eventName}}` is therefore rejected here rather than
 * arriving with a hole in it, since the directory doesn't know which event an
 * organizer had in mind.
 *
 * The preview resolves against the *first selected recipient*, not generic
 * placeholder data, because "does personalization actually work?" is the
 * question a preview exists to answer.
 *
 * Who it goes to is editable here rather than fixed by the table's ticks: the
 * contacts arrive as the starting selection, and the same searchable list,
 * group chips and "Going to N people" disclosure every other picker uses take
 * it from there — a bulk send is exactly where the last chance to notice a
 * wrong name is worth a click.
 *
 * The dialog stays open after sending to show the result: a bulk send that
 * reached nine of ten people is a normal outcome, and the organizer has to be
 * able to see which one failed.
 */
export function BulkEmailDialog({
  open,
  onOpenChange,
  recipients,
  orgFields,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Everyone ticked in the table — the dialog's starting selection. */
  recipients: RecipientOption[];
  /** organizerName/organizerEmail/portalUrl as the send path will fill them. */
  orgFields: MergeData;
  onSent: () => void;
}) {
  // The table's ticks are the starting point, read once: the dialog is mounted
  // by its opening (see DirectoryTable), so edits made in here survive the
  // table re-rendering underneath instead of being reset by it.
  const [selected, setSelected] = useState<string[]>(() =>
    recipients.map((recipient) => recipient.userId),
  );
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Snapshot the table selection at open time. The parent clears its ticks
  // after a successful send; following that prop live used to replace the
  // completed dialog with "Nobody picked yet" while its success result was
  // still on screen.
  const [initialRecipients] = useState(recipients);

  const rows = useMemo(
    () =>
      initialRecipients.map((recipient) => ({
        ...recipient,
        id: recipient.userId,
        name: recipient.displayName,
      })),
    [initialRecipients],
  );

  /** One chip per tag in use among the ticked contacts, plus "everyone". */
  const groups = useMemo<Array<GroupDefinition<(typeof rows)[number]>>>(() => {
    const tags = [...new Set(rows.flatMap((row) => row.tags))].sort((a, b) => a.localeCompare(b));
    return [
      { id: "all", label: "Everyone ticked", matches: () => true },
      ...tags.map((tag) => ({
        id: `tag:${tag}`,
        label: tag,
        matches: (row: (typeof rows)[number]) => row.tags.includes(tag),
      })),
    ];
  }, [rows]);

  const chosen = useMemo(() => rows.filter((row) => selected.includes(row.id)), [rows, selected]);

  const previewData = useMemo(() => {
    const first = chosen[0];
    return templatePreviewData({
      ...orgFields,
      ...(first ? orgSpeakerFields(first) : {}),
    });
  }, [chosen, orgFields]);

  const check = useMemo(
    () => checkTemplateDraft(subject, body, ORG_MERGE_FIELDS, previewData),
    [subject, body, previewData],
  );

  const ready = chosen.length > 0 && check.errors.length === 0;

  /** Drops a merge field where the cursor is, so it lands mid-sentence. */
  function insert(field: MergeField) {
    const token = `{{${field}}}`;
    const textarea = bodyRef.current;
    if (!textarea) {
      setBody((current) => current + token);
      return;
    }
    const { selectionStart, selectionEnd } = textarea;
    setBody((current) => current.slice(0, selectionStart) + token + current.slice(selectionEnd));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart + token.length, selectionStart + token.length);
    });
  }

  function reset() {
    setSubject("");
    setBody("");
    setResult(null);
    setError(null);
  }

  function send() {
    setError(null);
    startSend(async () => {
      const response = await sendDirectoryEmail({
        recipientIds: selected,
        subject,
        body,
      });
      if (!response.ok) {
        setError(response.error);
        toast.error(response.error);
        return;
      }
      setResult(response.data);
      const { sent, failed, failures } = response.data;
      if (failed > 0) {
        toast.warning(`Sent to ${sent}, ${failed} failed`, { description: failures[0] });
      } else {
        toast.success(`Sent to ${sent} ${sent === 1 ? "person" : "people"}`);
      }
      onSent();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Email selected contacts</DialogTitle>
          <DialogDescription>
            One personalised message per recipient — each one is sent and logged separately, so it
            shows up on that contact&apos;s own activity feed. Merge fields are filled from the
            contact&apos;s record.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {result ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">
                Sent to {result.sent} {result.sent === 1 ? "contact" : "contacts"}
                {result.failed > 0 ? ` · ${result.failed} failed` : ""}
              </p>
              {result.failures.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {result.failures.map((failure) => (
                    <li key={failure} className="text-sm text-destructive">
                      {failure}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Each send is logged against the contact — open a profile to see it on their
                activity feed.
              </p>
            </div>
          ) : (
            <>
              <PeoplePicker
                heading={`Recipients (${chosen.length})`}
                people={rows}
                groups={groups}
                selected={selected}
                onSelectedChange={setSelected}
                searchLabel="Search recipients"
                searchPlaceholder="Name, email, or company"
                groupsLabel="Recipient groups"
                emptyMessage="Nobody is ticked in the directory — close this and pick some contacts."
                listClassName="max-h-56"
              />

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="directory-email-subject">Subject</Label>
                <Input
                  id="directory-email-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Speak at our next event?"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="directory-email-body">Message</Label>
                <Textarea
                  id="directory-email-body"
                  ref={bodyRef}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={10}
                  placeholder={"Hi {{speakerFirstName}},\n\n…"}
                  className="font-mono text-sm"
                />
              </div>

              <MergeFieldPalette fields={ORG_MERGE_FIELDS} onInsert={insert} />
              <DraftProblems errors={check.errors} />
              <BlankFieldNote blank={check.blank} />

              {subject.trim() || body.trim() ? <MessagePreview preview={check.preview} /> : null}

              {error && <p className="text-sm text-destructive">{error}</p>}

              {/* The last read before the button underneath it acts. */}
              <SelectionSummary
                names={chosen.map((row) => row.displayName)}
                words={{ empty: "Nobody picked yet." }}
              />
            </>
          )}
        </div>

        <DialogFooter>
          {result ? (
            <>
              <Button type="button" variant="outline" onClick={reset}>
                Write another
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : (
            <Button type="button" onClick={send} disabled={!ready || sending}>
              <SendIcon />
              {sending
                ? "Sending…"
                : `Send to ${chosen.length} ${chosen.length === 1 ? "person" : "people"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
