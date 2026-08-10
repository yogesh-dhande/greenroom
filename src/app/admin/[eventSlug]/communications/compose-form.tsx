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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PeoplePicker, SelectionSummary } from "@/components/people-picker/people-picker";
import type { GroupDefinition } from "@/components/people-picker/selection";
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
   * `previewData` for how it overlays the generic placeholders. */
  eventMergeData: MergeData;
  speakers: SpeakerOption[];
  onSent: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, startSend] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  /**
   * What the preview renders with: this event's real fields, overlaid with the
   * first picked recipient's own (decisions.md D-053 — a preview that shows a
   * different person's name than the send will use is a lie the organizer only
   * catches after sending). Nobody picked yet leaves `templatePreviewData`'s
   * sample person in place, which is honest: no recipient has been chosen.
   */
  const previewData = useMemo(() => {
    const first = speakers.find((speaker) => speaker.id === selected[0]);
    return templatePreviewData({ ...eventMergeData, ...(first?.mergeData ?? {}) });
  }, [speakers, selected, eventMergeData]);

  const check = useMemo(
    () => checkTemplateDraft(subject, body, MANUAL_MERGE_FIELDS, previewData),
    [subject, body, previewData],
  );

  const ready = selected.length > 0 && check.errors.length === 0;

  /** Rows for the picker: the speaker, plus the badge its list renders. */
  const rows = useMemo(
    () =>
      speakers.map((speaker) => ({
        ...speaker,
        note: speaker.confirmed ? "On the program" : null,
      })),
    [speakers],
  );

  /**
   * The groups an organizer actually writes to, each a predicate over data
   * already on this page (decisions.md D-068 for confirmation, D-039 for the
   * task reading). Groups nobody is in never render, so the chip row stays
   * the shape of *this* event.
   */
  const groups = useMemo<Array<GroupDefinition<(typeof rows)[number]>>>(() => {
    const trackNames = [...new Set(speakers.flatMap((speaker) => speaker.trackNames))].sort(
      (a, b) => a.localeCompare(b),
    );
    return [
      { id: "all", label: "All speakers", matches: () => true },
      { id: "confirmed", label: "On the program", matches: (person) => person.confirmed },
      {
        id: "unconfirmed",
        label: "Not confirmed",
        matches: (person) => !person.confirmed,
        tone: "warning",
      },
      {
        id: "behind",
        label: "Behind on tasks",
        matches: (person) => person.pendingTasks > 0,
        tone: "warning",
      },
      ...trackNames.map((name) => ({
        id: `track:${name}`,
        label: name,
        matches: (person: (typeof rows)[number]) => person.trackNames.includes(name),
      })),
    ];
  }, [speakers]);

  const selectedNames = useMemo(
    () => rows.filter((person) => selected.includes(person.id)).map((person) => person.name),
    [rows, selected],
  );

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

        {/* The count sits next to the button that acts on it, and opens to the
            names — where a wrong recipient is still catchable. */}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={send} disabled={!ready || sending}>
            <SendIcon />
            {sending
              ? "Sending…"
              : `Send to ${selected.length || "…"} ${selected.length === 1 ? "person" : "people"}`}
          </Button>
          <SelectionSummary
            names={selectedNames}
            words={{ empty: "Nobody picked yet — tick who this goes to." }}
          />
        </div>
      </div>

      <PeoplePicker
        heading="Recipients"
        people={rows}
        groups={groups}
        selected={selected}
        onSelectedChange={setSelected}
        searchLabel="Search recipients"
        searchPlaceholder="Name, email, or company"
        groupsLabel="Recipient groups"
        emptyMessage="Nobody has submitted to this event yet, so there's nobody to write to."
      />
    </div>
  );
}

