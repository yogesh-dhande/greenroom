"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import {
  MANUAL_MERGE_FIELDS,
  checkTemplateDraft,
  templatePreviewData,
  type MergeData,
  type MergeField,
} from "@/domain/comms-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sendComposedEmail } from "./actions";
import { BlankFieldNote, DraftProblems, MergeFieldPalette, MessagePreview } from "./merge-fields";
import type { SpeakerOption } from "./types";

/**
 * A one-off message to some or all of the event's speakers (spec.md §7).
 *
 * The merge fields matter more here than in the templates: this is where an
 * organizer writes "the shuttle leaves at 7" to forty people at once, and the
 * difference between a mail merge and a mass email is whether it opens with
 * their name. Each recipient gets their own send, so each one shows up in
 * their own communication log.
 *
 * Validation runs on every keystroke against the same `checkTemplateDraft`
 * the server action re-runs — the button is disabled rather than the send
 * being rejected, because finding out after pressing Send is too late for a
 * message that goes to everyone.
 */
export function ComposeForm({
  eventSlug,
  eventMergeData,
  speakers,
  onSent,
}: {
  eventSlug: string;
  /** This event's real dates/URLs/organizer name (decisions.md D-053) — see
   * `previewData` below for how it overlays the generic placeholders. */
  eventMergeData: MergeData;
  speakers: SpeakerOption[];
  onSent: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, startSend] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const check = useMemo(
    () => checkTemplateDraft(subject, body, MANUAL_MERGE_FIELDS, previewData(eventMergeData)),
    [subject, body, eventMergeData],
  );

  const ready = selected.length > 0 && check.errors.length === 0;

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  }

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

  function send() {
    startSend(async () => {
      const result = await sendComposedEmail(eventSlug, {
        recipientIds: selected,
        subject,
        body,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { sent, failed, failures } = result.data;
      if (failed > 0) {
        toast.warning(`Sent to ${sent}, ${failed} failed`, { description: failures[0] });
      } else {
        toast.success(`Sent to ${sent} ${sent === 1 ? "person" : "people"}`);
      }
      setSubject("");
      setBody("");
      setSelected([]);
      onSent();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="compose-subject">Subject</Label>
          <Input
            id="compose-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Shuttle times for Tuesday"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="compose-body">Message</Label>
          <Textarea
            id="compose-body"
            ref={bodyRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={14}
            placeholder={"Hi {{speakerFirstName}},\n\n…"}
            className="font-mono text-sm"
          />
        </div>

        <MergeFieldPalette fields={MANUAL_MERGE_FIELDS} onInsert={insert} />
        <DraftProblems errors={check.errors} />
        <BlankFieldNote blank={check.blank} />

        {subject.trim() || body.trim() ? <MessagePreview preview={check.preview} /> : null}

        <div className="flex items-center gap-3">
          <Button onClick={send} disabled={!ready || sending}>
            <SendIcon />
            {sending
              ? "Sending…"
              : `Send to ${selected.length || "…"} ${selected.length === 1 ? "person" : "people"}`}
          </Button>
          {selected.length === 0 ? (
            <p className="text-sm text-muted-foreground">Pick who this goes to.</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>Recipients</Label>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(speakers.map((speaker) => speaker.id))}
              disabled={selected.length === speakers.length}
            >
              All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected([])}
              disabled={selected.length === 0}
            >
              None
            </Button>
          </div>
        </div>

        {speakers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody has submitted to this event yet, so there&apos;s nobody to write to.
          </p>
        ) : (
          <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
            {speakers.map((speaker) => (
              <li key={speaker.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-muted">
                  <Checkbox
                    checked={selected.includes(speaker.id)}
                    onCheckedChange={() => toggle(speaker.id)}
                    className="mt-0.5"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span className="truncate">{speaker.name}</span>
                      {speaker.confirmed ? (
                        <Badge variant="outline" className="shrink-0">
                          On the program
                        </Badge>
                      ) : null}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{speaker.email}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Preview data with this event's real dates, URLs and organizer name laid
 * over `templatePreviewData`'s generic defaults, so the on-screen preview
 * reads like the real thing (decisions.md D-053) rather than "June 16–18,
 * 2026" and "hello@example.com" for an event with different dates. Fields
 * this composer doesn't know yet — who the recipient is — stay placeholders
 * ("Priya Raman").
 */
function previewData(eventMergeData: MergeData) {
  return templatePreviewData(eventMergeData);
}
