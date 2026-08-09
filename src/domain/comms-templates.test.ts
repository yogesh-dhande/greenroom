import { describe, expect, it } from "vitest";
import {
  checkTemplateDraft,
  COMMS_TEMPLATES,
  COMMS_TEMPLATE_IDS,
  getCommsTemplate,
  MANUAL_MERGE_FIELDS,
  MERGE_FIELDS,
  mergeFieldsUsed,
  missingMergeFields,
  renderCommsTemplate,
  renderMessage,
  renderSubject,
  renderText,
  resolveAllCommsTemplates,
  resolveCommsTemplate,
  TEMPLATE_MERGE_FIELDS,
  textToHtml,
  type MergeData,
} from "@/domain/comms-templates";

/** A complete merge set — every field the built-in templates can reference. */
const FULL: MergeData = {
  speakerName: "Priya Raman",
  speakerFirstName: "Priya",
  eventName: "AI Engineer Summit 2026",
  eventDates: "June 16–18, 2026",
  eventLocation: "Moscone West, San Francisco",
  eventTimezone: "PDT",
  eventUrl: "https://example.test/e/aie-2026",
  organizerName: "The program team",
  organizerEmail: "hello@greenroom.dev",
  portalUrl: "https://example.test/portal",
  submissionTitle: "Retrieval that survives production traffic",
  decisionNote: "Best retrieval submission this year.",
  changeRequest: "Please trim the abstract to 400 words.",
  changeDueDate: "Friday, May 1, 2026",
  sessionTitle: "Retrieval that survives production traffic",
  sessionWhen: "Tuesday, June 16, 2026, 10:00 AM – 10:45 AM PDT",
  sessionRoom: "Main Stage",
  sessionDuration: "45 minutes",
  taskTitle: "Upload your headshot",
  taskInstructions: "Square image, at least 800×800.",
  taskDueDate: "Friday, June 5, 2026",
  outstandingTasks: "- Upload your headshot\n- Complete the A/V form",
};

describe("renderText — merge fields", () => {
  it("substitutes known fields", () => {
    expect(renderText("Hi {{speakerFirstName}}, welcome to {{eventName}}.", FULL)).toBe(
      "Hi Priya, welcome to AI Engineer Summit 2026.",
    );
  });

  it("renders an absent field as nothing rather than leaving the placeholder", () => {
    expect(renderText("Room: {{sessionRoom}}.", {})).toBe("Room: .");
  });

  it("drops an unknown placeholder rather than showing a speaker raw markup", () => {
    // A typo'd field in organizer-authored copy leaves a gap, not "{{notAField}}";
    // the admin UI catches typos up front with mergeFieldsUsed/missingMergeFields.
    expect(renderText("Hello {{notAField}}", FULL)).toBe("Hello");
  });

  it("tolerates whitespace inside the tag", () => {
    expect(renderText("Hi {{ speakerFirstName }}", FULL)).toBe("Hi Priya");
  });
});

describe("renderText — conditional sections", () => {
  const source = "Before.\n\n{{#sessionRoom}}\nRoom: {{sessionRoom}}\n\n{{/sessionRoom}}\nAfter.";

  it("keeps a section when its field has a value", () => {
    expect(renderText(source, { sessionRoom: "Main Stage" })).toBe(
      "Before.\n\nRoom: Main Stage\n\nAfter.",
    );
  });

  it("drops a section when the field is empty, keeping the paragraph break", () => {
    expect(renderText(source, {})).toBe("Before.\n\nAfter.");
    expect(renderText(source, { sessionRoom: "   " })).toBe("Before.\n\nAfter.");
  });

  it("inverts with {{^field}}", () => {
    const inverted = "{{#sessionRoom}}Room: {{sessionRoom}}{{/sessionRoom}}{{^sessionRoom}}Room: TBC{{/sessionRoom}}";
    expect(renderText(inverted, { sessionRoom: "Main Stage" })).toBe("Room: Main Stage");
    expect(renderText(inverted, {})).toBe("Room: TBC");
  });

  it("handles an inline section inside a sentence", () => {
    const source = "Your talk{{#sessionRoom}} in {{sessionRoom}}{{/sessionRoom}} is confirmed.";
    expect(renderText(source, FULL)).toBe("Your talk in Main Stage is confirmed.");
    expect(renderText(source, {})).toBe("Your talk is confirmed.");
  });

  it("resolves a section nested inside another", () => {
    const source = "{{#sessionWhen}}At {{sessionWhen}}{{#sessionRoom}} in {{sessionRoom}}{{/sessionRoom}}.{{/sessionWhen}}";
    expect(renderText(source, FULL)).toContain("in Main Stage");
    expect(renderText(source, { sessionWhen: "Tuesday" })).toBe("At Tuesday.");
    expect(renderText(source, {})).toBe("");
  });

  it("never welds two paragraphs together when a block is dropped", () => {
    // The regression this guards: a standalone-tag strip that eats the tag but
    // leaves its newline turns two paragraphs into one run-on paragraph.
    for (const id of COMMS_TEMPLATE_IDS) {
      const sparse = renderCommsTemplate(id, {
        speakerFirstName: "Priya",
        eventName: "AI Engineer Summit 2026",
        submissionTitle: "A talk",
        sessionTitle: "A talk",
        sessionWhen: "Tuesday",
        taskTitle: "Upload your headshot",
        changeRequest: "Trim the abstract.",
        portalUrl: "https://example.test/portal",
        organizerName: "The program team",
      });
      expect(sparse.text, id).not.toMatch(/[a-z]\.\n[A-Z]/);
    }
  });
});

describe("renderText — tidying", () => {
  it("collapses the blank-line runs left behind by dropped sections", () => {
    expect(renderText("A.\n\n\n\n\nB.", {})).toBe("A.\n\nB.");
  });

  it("trims leading and trailing whitespace", () => {
    expect(renderText("\n\n  Hello  \n\n", {})).toBe("Hello");
  });
});

describe("renderSubject", () => {
  it("substitutes and flattens to a single line", () => {
    expect(renderSubject("Your talk is in — {{eventName}}", FULL)).toBe(
      "Your talk is in — AI Engineer Summit 2026",
    );
    expect(renderSubject("A\nB   C", {})).toBe("A B C");
  });

  it("applies sections in subjects too", () => {
    expect(renderSubject("Reminder{{#taskTitle}}: {{taskTitle}}{{/taskTitle}}", FULL)).toBe(
      "Reminder: Upload your headshot",
    );
    expect(renderSubject("Reminder{{#taskTitle}}: {{taskTitle}}{{/taskTitle}}", {})).toBe(
      "Reminder",
    );
  });
});

describe("textToHtml", () => {
  it("turns blank-line-separated blocks into paragraphs", () => {
    expect(textToHtml("One.\n\nTwo.")).toBe(
      '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1917;max-width:560px;margin:0 auto;padding:24px"><p style="margin:0 0 16px">One.</p><p style="margin:0 0 16px">Two.</p></div>',
    );
  });

  it("keeps single newlines inside a block as line breaks", () => {
    expect(textToHtml("One.\nTwo.")).toContain("One.<br>Two.");
  });

  it("turns a dash block into a list", () => {
    const html = textToHtml("- First\n- Second");
    expect(html).toContain("<ul");
    expect(html).toContain("<li style=\"margin:0 0 6px\">First</li>");
    expect(html).not.toContain("- First");
  });

  it("autolinks bare URLs without swallowing trailing punctuation", () => {
    const html = textToHtml("Go to https://example.test/portal.");
    expect(html).toContain('href="https://example.test/portal"');
    expect(html).toContain(">https://example.test/portal</a>.");
  });

  it("escapes HTML in speaker-supplied text", () => {
    const html = textToHtml('Talk: <script>alert("x")</script> & more');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("styles inline, because mail clients strip <style> blocks", () => {
    expect(textToHtml("Hi")).not.toContain("<style");
    expect(textToHtml("Hi")).toContain('style="margin:0 0 16px"');
  });
});

describe("missingMergeFields / mergeFieldsUsed", () => {
  it("lists only the known fields a template references", () => {
    expect(mergeFieldsUsed("{{speakerName}} {{notAField}} {{#sessionRoom}}x{{/sessionRoom}}")).toEqual([
      "speakerName",
      "sessionRoom",
    ]);
  });

  it("reports fields the data cannot fill", () => {
    expect(missingMergeFields("{{speakerName}} at {{eventName}}", { eventName: "AIE" })).toEqual([
      "speakerName",
    ]);
    expect(missingMergeFields("{{speakerName}}", FULL)).toEqual([]);
  });

  it("treats a whitespace-only value as missing", () => {
    expect(missingMergeFields("{{speakerName}}", { speakerName: "  " })).toEqual(["speakerName"]);
  });
});

describe("renderMessage", () => {
  it("renders subject, text and HTML from one source pair", () => {
    const rendered = renderMessage(
      { subject: "Hi {{speakerFirstName}}", body: "Thanks for {{submissionTitle}}." },
      FULL,
    );
    expect(rendered.subject).toBe("Hi Priya");
    expect(rendered.text).toBe("Thanks for Retrieval that survives production traffic.");
    expect(rendered.html).toContain("<p");
  });
});

describe("the built-in templates", () => {
  it("declares fields that match the copy", () => {
    for (const id of COMMS_TEMPLATE_IDS) {
      const template = getCommsTemplate(id);
      expect(template.fields, id).toEqual(
        mergeFieldsUsed(`${template.subject}\n${template.body}`),
      );
      for (const field of template.fields) {
        expect(MERGE_FIELDS, `${id}/${field}`).toContain(field);
      }
    }
  });

  it("renders every template with no leftover markup", () => {
    for (const id of COMMS_TEMPLATE_IDS) {
      const rendered = renderCommsTemplate(id, FULL);
      expect(rendered.subject, id).not.toMatch(/\{\{|\}\}/);
      expect(rendered.text, id).not.toMatch(/\{\{|\}\}/);
      expect(rendered.text.trim(), id).not.toBe("");
      expect(missingMergeFields(COMMS_TEMPLATES[id].body, FULL), id).toEqual([]);
    }
  });

  it("survives an empty merge set without emitting placeholders or stray punctuation", () => {
    for (const id of COMMS_TEMPLATE_IDS) {
      const rendered = renderCommsTemplate(id, {});
      expect(rendered.text, id).not.toMatch(/\{\{|\}\}/);
      expect(rendered.text, id).not.toContain("undefined");
    }
  });

  it("classifies each template for email_log", () => {
    expect(getCommsTemplate("submission_confirmation").kind).toBe("submission_confirmation");
    expect(getCommsTemplate("submission_accepted").kind).toBe("decision");
    expect(getCommsTemplate("submission_declined").kind).toBe("decision");
    expect(getCommsTemplate("task_reminder").kind).toBe("task_reminder");
    expect(getCommsTemplate("calendar_invite").kind).toBe("calendar_invite");
  });

  it("addresses the speaker by first name and signs off as the organizer", () => {
    for (const id of COMMS_TEMPLATE_IDS) {
      const rendered = renderCommsTemplate(id, FULL);
      expect(rendered.text.startsWith("Hi Priya,"), id).toBe(true);
      expect(rendered.text.trimEnd().endsWith("AI Engineer Summit 2026"), id).toBe(true);
    }
  });

  it("reads correctly before a room is assigned and again after", () => {
    const withoutRoom = renderCommsTemplate("calendar_invite", { ...FULL, sessionRoom: "" });
    expect(withoutRoom.text).toContain("to be confirmed");
    expect(withoutRoom.text).not.toContain("Main Stage");

    const withRoom = renderCommsTemplate("calendar_invite", FULL);
    expect(withRoom.text).toContain("Room: Main Stage");
    expect(withRoom.text).not.toContain("to be confirmed");
  });

  it("omits the review note when the committee left none", () => {
    const withNote = renderCommsTemplate("submission_accepted", FULL);
    expect(withNote.text).toContain("A note from the review committee:");
    const withoutNote = renderCommsTemplate("submission_accepted", {
      ...FULL,
      decisionNote: undefined,
    });
    expect(withoutNote.text).not.toContain("A note from the review committee:");
  });

  it("falls back to schedule-pending copy on an acceptance with no slot yet", () => {
    const unscheduled = renderCommsTemplate("submission_accepted", {
      ...FULL,
      sessionWhen: undefined,
      sessionRoom: undefined,
    });
    expect(unscheduled.text).toContain("still building the schedule");
    expect(unscheduled.text).not.toContain("currently slated");
  });
});

// ---------------------------------------------------------------------------
// Per-event overrides
// ---------------------------------------------------------------------------

describe("resolveCommsTemplate", () => {
  it("uses Greenroom's copy when the event hasn't edited anything", () => {
    const resolved = resolveCommsTemplate("task_reminder");
    expect(resolved.subject).toBe(COMMS_TEMPLATES.task_reminder.subject);
    expect(resolved.isOverride).toBe(false);
    expect(resolved.overrideId).toBeNull();
  });

  it("prefers the event's own wording", () => {
    const resolved = resolveCommsTemplate("task_reminder", [
      {
        id: "row-1",
        name: "task_reminder",
        subject: "Nudge: {{taskTitle}}",
        body: "Hi {{speakerFirstName}}",
      },
    ]);
    expect(resolved.subject).toBe("Nudge: {{taskTitle}}");
    expect(resolved.isOverride).toBe(true);
    expect(resolved.overrideId).toBe("row-1");
  });

  it("ignores rows belonging to other templates", () => {
    // The override's `name` is the join key back to the built-in id, so a
    // row for a different template must not leak into this one.
    const resolved = resolveCommsTemplate("task_reminder", [
      { id: "row-1", name: "submission_accepted", subject: "Other", body: "Other" },
    ]);
    expect(resolved.isOverride).toBe(false);
  });

  it("ignores a free-text row that isn't overriding anything", () => {
    const resolved = resolveCommsTemplate("task_reminder", [
      { id: "row-1", name: "Sponsor thank-you", subject: "Thanks", body: "Thanks" },
    ]);
    expect(resolved.isOverride).toBe(false);
  });

  it("takes the last write when an event somehow holds two rows for one template", () => {
    const resolved = resolveCommsTemplate("task_reminder", [
      { id: "row-1", name: "task_reminder", subject: "First", body: "First" },
      { id: "row-2", name: "task_reminder", subject: "Second", body: "Second" },
    ]);
    expect(resolved.overrideId).toBe("row-2");
  });

  it("resolves every built-in, overridden or not", () => {
    const all = resolveAllCommsTemplates([
      { id: "row-1", name: "change_request", subject: "Ours", body: "Ours" },
    ]);
    expect(all).toHaveLength(COMMS_TEMPLATE_IDS.length);
    expect(all.filter((template) => template.isOverride).map((t) => t.id)).toEqual([
      "change_request",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Editing a template
// ---------------------------------------------------------------------------

describe("checkTemplateDraft", () => {
  const available = TEMPLATE_MERGE_FIELDS.task_reminder;

  it("passes the built-in copy it will be editing", () => {
    for (const id of COMMS_TEMPLATE_IDS) {
      const check = checkTemplateDraft(
        COMMS_TEMPLATES[id].subject,
        COMMS_TEMPLATES[id].body,
        TEMPLATE_MERGE_FIELDS[id],
      );
      expect(check.errors, id).toEqual([]);
    }
  });

  it("rejects a misspelled merge field", () => {
    // The whole point of validating on save: {{speakername}} renders as
    // nothing at all, in every future send, with nobody left to notice.
    const check = checkTemplateDraft("Hi {{speakername}}", "Body", available);
    expect(check.unknown).toEqual(["speakername"]);
    expect(check.errors.join(" ")).toContain("{{speakername}}");
  });

  it("rejects a real field this message can't fill in", () => {
    const check = checkTemplateDraft("Subject", "About {{sessionRoom}}", available);
    expect(check.unavailable).toEqual(["sessionRoom"]);
    expect(check.errors.join(" ")).toContain("no value for");
  });

  it("rejects empty copy", () => {
    expect(checkTemplateDraft("  ", "Body", available).errors).toContain(
      "The subject can't be empty.",
    );
    expect(checkTemplateDraft("Subject", "  ", available).errors).toContain(
      "The message body can't be empty.",
    );
  });

  it("checks section tags, not just plain placeholders", () => {
    const check = checkTemplateDraft("Subject", "{{#nonsense}}x{{/nonsense}}", available);
    expect(check.unknown).toEqual(["nonsense"]);
  });

  it("returns a filled-in preview alongside the verdict", () => {
    const check = checkTemplateDraft("Hi {{speakerFirstName}}", "About {{taskTitle}}", available);
    expect(check.errors).toEqual([]);
    expect(check.preview.subject).toBe("Hi Priya");
    expect(check.preview.text).toContain("Upload your headshot");
  });

  it("flags a valid field with no value as blank rather than as an error", () => {
    const check = checkTemplateDraft("Subject", "Due {{taskDueDate}}", available, {
      taskDueDate: "",
    });
    expect(check.errors).toEqual([]);
    expect(check.blank).toEqual(["taskDueDate"]);
  });

  it("keeps every template's field list inside the merge-field vocabulary", () => {
    for (const id of COMMS_TEMPLATE_IDS) {
      for (const field of TEMPLATE_MERGE_FIELDS[id]) {
        expect(MERGE_FIELDS, `${id}/${field}`).toContain(field);
      }
    }
  });

  it("only offers a one-off message fields that don't need a submission", () => {
    // The composer picks people, not proposals — a manual send has no
    // submission or session to draw on.
    for (const field of MANUAL_MERGE_FIELDS) {
      expect(field.startsWith("submission"), field).toBe(false);
      expect(field.startsWith("session"), field).toBe(false);
    }
  });
});
