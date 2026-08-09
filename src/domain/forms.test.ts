import { describe, expect, it } from "vitest";
import type { FormField, FormFieldCondition } from "@/db/entities";
import {
  acceptsSubmissions,
  buildFormValidator,
  checkConfirmationEmail,
  cleanCoSpeakers,
  conditionHolds,
  DEFAULT_CFP_FIELDS,
  emptyValues,
  fieldSchemaProblems,
  formWindowState,
  fromZonedInputValue,
  isFieldVisible,
  prefillValues,
  pruneHiddenValues,
  publicFields,
  selectedTrackNames,
  toZonedInputValue,
  unavailableMergeFields,
  unknownMergePlaceholders,
  validateSubmissionValues,
  visibleFields,
  withTrackOptions,
  type FormValues,
} from "@/domain/forms";

/** A field with sensible defaults, overridable per test. */
function field(overrides: Partial<FormField> & { id: string }): FormField {
  return { type: "text", label: overrides.id, ...overrides };
}

function errorsFor(fields: FormField[], values: FormValues): Record<string, string> {
  return validateSubmissionValues(fields, values).errors;
}

// ---------------------------------------------------------------------------
// Validator generation
// ---------------------------------------------------------------------------

describe("buildFormValidator — required and optional", () => {
  const fields = [
    field({ id: "title", label: "Talk title", required: true }),
    field({ id: "notes", type: "textarea", label: "Notes" }),
  ];

  it("rejects a missing required field with a field-scoped message", () => {
    const result = buildFormValidator(fields).safeParse({ title: "", notes: "" });
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0];
    expect(issue.path).toEqual(["title"]);
    expect(issue.message).toBe("Talk title is required");
  });

  it("treats whitespace as missing", () => {
    expect(errorsFor(fields, { title: "   " })).toHaveProperty("title");
  });

  it("accepts an optional field left blank", () => {
    expect(buildFormValidator(fields).safeParse({ title: "Ship it", notes: "" }).success).toBe(true);
  });

  it("accepts a form with no fields at all", () => {
    expect(buildFormValidator([]).safeParse({}).success).toBe(true);
  });
});

describe("buildFormValidator — per-type rules", () => {
  it("checks email format, required or not", () => {
    const fields = [field({ id: "email", type: "email", label: "Your email" })];
    expect(errorsFor(fields, { email: "nope" }).email).toBe("Enter a valid email address");
    expect(errorsFor(fields, { email: "priya@example.com" })).toEqual({});
    // Optional and blank stays valid — format only applies to a real answer.
    expect(errorsFor(fields, { email: "" })).toEqual({});
  });

  it("requires a full url", () => {
    const fields = [field({ id: "link", type: "url", label: "Prior talk" })];
    expect(errorsFor(fields, { link: "example.com" }).link).toMatch(/starting with https/);
    expect(errorsFor(fields, { link: "https://example.com/talk" })).toEqual({});
  });

  it("requires a ticked checkbox only when the field is required", () => {
    const required = [field({ id: "coc", type: "checkbox", label: "Code of conduct", required: true })];
    expect(errorsFor(required, { coc: false }).coc).toBe('Please confirm "Code of conduct"');
    expect(errorsFor(required, { coc: true })).toEqual({});
    const optional = [field({ id: "audio", type: "checkbox", label: "Has audio" })];
    expect(errorsFor(optional, { audio: false })).toEqual({});
  });

  it("requires at least one choice for a required multiselect", () => {
    const fields = [
      field({ id: "tracks", type: "multiselect", label: "Track(s)", required: true, options: ["A", "B"] }),
    ];
    expect(errorsFor(fields, { tracks: [] }).tracks).toMatch(/at least one/);
    expect(errorsFor(fields, { tracks: ["A"] })).toEqual({});
  });

  it("rejects choices that aren't on the list", () => {
    const fields = [
      field({ id: "format", type: "select", label: "Format", options: ["Talk", "Workshop"] }),
      field({ id: "tracks", type: "multiselect", label: "Tracks", options: ["A", "B"] }),
    ];
    expect(errorsFor(fields, { format: "Keynote" }).format).toContain("isn't one of the choices");
    expect(errorsFor(fields, { tracks: ["A", "Z"] }).tracks).toContain("isn't one of the choices");
  });

  it("never requires co-speakers, but validates the rows that were started", () => {
    const fields = [field({ id: "co_speakers", type: "co_speakers", label: "Co-speakers" })];
    expect(errorsFor(fields, { co_speakers: [] })).toEqual({});
    // A completely blank row is an abandoned row, not an error.
    expect(errorsFor(fields, { co_speakers: [{ name: "", email: "" }] })).toEqual({});

    const started = buildFormValidator(fields).safeParse({
      co_speakers: [{ name: "Sam", email: "not-an-email" }],
    });
    expect(started.success).toBe(false);
    expect(started.error!.issues[0].path).toEqual(["co_speakers", 0, "email"]);
  });
});

describe("cleanCoSpeakers", () => {
  it("drops blank rows, trims, and lowercases the email", () => {
    expect(
      cleanCoSpeakers([
        { name: "  Sam Ito ", email: " SAM@Example.com ", title: "", company: " Acme " },
        { name: "", email: "", title: "", company: "" },
      ]),
    ).toEqual([{ name: "Sam Ito", email: "sam@example.com", title: undefined, company: "Acme" }]);
  });

  it("tolerates a non-array value", () => {
    expect(cleanCoSpeakers(undefined)).toEqual([]);
    expect(cleanCoSpeakers("nonsense")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// showIf evaluation
// ---------------------------------------------------------------------------

describe("conditionHolds", () => {
  it("matches a scalar with eq and neq", () => {
    const values = { format: "Workshop" };
    expect(conditionHolds({ fieldId: "format", op: "eq", value: "Workshop" }, values)).toBe(true);
    expect(conditionHolds({ fieldId: "format", op: "eq", value: "Talk" }, values)).toBe(false);
    expect(conditionHolds({ fieldId: "format", op: "neq", value: "Talk" }, values)).toBe(true);
  });

  it("treats eq on a multiselect as membership", () => {
    const values = { tracks: ["AI Engineering", "Infrastructure"] };
    expect(conditionHolds({ fieldId: "tracks", op: "eq", value: "Infrastructure" }, values)).toBe(true);
    expect(conditionHolds({ fieldId: "tracks", op: "eq", value: "Design" }, values)).toBe(false);
  });

  it("matches any of a list with in", () => {
    const condition: FormFieldCondition = {
      fieldId: "format",
      op: "in",
      value: ["Workshop", "Tutorial"],
    };
    expect(conditionHolds(condition, { format: "Tutorial" })).toBe(true);
    expect(conditionHolds(condition, { format: "Talk" })).toBe(false);
  });

  it("reads a ticked checkbox as \"true\"", () => {
    expect(conditionHolds({ fieldId: "audio", op: "eq", value: "true" }, { audio: true })).toBe(true);
    expect(conditionHolds({ fieldId: "audio", op: "eq", value: "true" }, { audio: false })).toBe(false);
  });

  it("treats an unanswered field as having no value", () => {
    expect(conditionHolds({ fieldId: "format", op: "eq", value: "Talk" }, {})).toBe(false);
    expect(conditionHolds({ fieldId: "format", op: "neq", value: "Talk" }, {})).toBe(true);
  });
});

describe("isFieldVisible", () => {
  const fields = [
    field({ id: "format", type: "select", label: "Format", options: ["Talk", "Workshop"] }),
    field({
      id: "requirements",
      type: "textarea",
      label: "Workshop requirements",
      required: true,
      showIf: { fieldId: "format", op: "eq", value: "Workshop" },
    }),
    field({
      id: "room_layout",
      type: "text",
      label: "Room layout",
      required: true,
      showIf: { fieldId: "requirements", op: "neq", value: "" },
    }),
  ];

  it("shows an unconditional field always", () => {
    expect(isFieldVisible(fields[0], {}, fields)).toBe(true);
  });

  it("shows a conditional field only when its condition holds", () => {
    expect(isFieldVisible(fields[1], { format: "Talk" }, fields)).toBe(false);
    expect(isFieldVisible(fields[1], { format: "Workshop" }, fields)).toBe(true);
  });

  it("hides a field whose controlling field is itself hidden", () => {
    // room_layout's own condition holds (requirements is non-empty), but the
    // question it depends on was never shown, so neither is this one.
    const values = { format: "Talk", requirements: "leftover text" };
    expect(isFieldVisible(fields[1], values, fields)).toBe(false);
    expect(isFieldVisible(fields[2], values, fields)).toBe(false);

    const workshop = { format: "Workshop", requirements: "leftover text" };
    expect(isFieldVisible(fields[2], workshop, fields)).toBe(true);
  });

  it("terminates on a circular condition instead of recursing forever", () => {
    const cyclic = [
      field({ id: "a", showIf: { fieldId: "b", op: "eq", value: "yes" } }),
      field({ id: "b", showIf: { fieldId: "a", op: "eq", value: "yes" } }),
    ];
    expect(isFieldVisible(cyclic[0], { a: "yes", b: "yes" }, cyclic)).toBe(true);
    expect(isFieldVisible(cyclic[0], { a: "yes", b: "no" }, cyclic)).toBe(false);
  });

  it("lists visible fields in schema order", () => {
    expect(visibleFields(fields, { format: "Workshop", requirements: "Tables" }).map((f) => f.id)).toEqual([
      "format",
      "requirements",
      "room_layout",
    ]);
    expect(visibleFields(fields, { format: "Talk" }).map((f) => f.id)).toEqual(["format"]);
  });
});

describe("pruneHiddenValues", () => {
  const fields = [
    field({ id: "format", type: "select", label: "Format", options: ["Talk", "Workshop"] }),
    field({
      id: "requirements",
      type: "textarea",
      label: "Requirements",
      showIf: { fieldId: "format", op: "eq", value: "Workshop" },
    }),
  ];

  it("drops answers to hidden fields", () => {
    expect(pruneHiddenValues(fields, { format: "Talk", requirements: "Two projectors" })).toEqual({
      format: "Talk",
    });
  });

  it("keeps answers once the field becomes visible", () => {
    expect(pruneHiddenValues(fields, { format: "Workshop", requirements: "Two projectors" })).toEqual({
      format: "Workshop",
      requirements: "Two projectors",
    });
  });

  it("drops answers to fields the form no longer has", () => {
    expect(pruneHiddenValues(fields, { format: "Talk", removed_question: "orphan" })).toEqual({
      format: "Talk",
    });
  });
});

describe("validateSubmissionValues", () => {
  const fields = [
    field({ id: "format", type: "select", label: "Format", options: ["Talk", "Workshop"], required: true }),
    field({
      id: "requirements",
      type: "textarea",
      label: "Requirements",
      required: true,
      showIf: { fieldId: "format", op: "eq", value: "Workshop" },
    }),
  ];

  it("never enforces a required field nobody was shown", () => {
    const result = validateSubmissionValues(fields, { format: "Talk" });
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({ format: "Talk" });
  });

  it("enforces it once the field is shown", () => {
    const result = validateSubmissionValues(fields, { format: "Workshop", requirements: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.requirements).toBe("Requirements is required");
  });

  it("returns pruned values alongside the errors", () => {
    const result = validateSubmissionValues(fields, { format: "Talk", requirements: "stale" });
    expect(result.values).not.toHaveProperty("requirements");
  });
});

// ---------------------------------------------------------------------------
// Submission window
// ---------------------------------------------------------------------------

describe("formWindowState", () => {
  const opensAt = new Date("2026-03-01T00:00:00Z");
  const closesAt = new Date("2026-04-01T00:00:00Z");
  const published = { isPublished: true, opensAt, closesAt };

  it("reports an unpublished form as a draft regardless of dates", () => {
    expect(formWindowState({ ...published, isPublished: false }, new Date("2026-03-15T00:00:00Z"))).toBe(
      "unpublished",
    );
  });

  it("reports scheduled before the open date", () => {
    expect(formWindowState(published, new Date("2026-02-28T23:59:59Z"))).toBe("scheduled");
  });

  it("opens exactly at opensAt", () => {
    expect(formWindowState(published, opensAt)).toBe("open");
  });

  it("is still open exactly at closesAt", () => {
    expect(formWindowState(published, closesAt)).toBe("open");
  });

  it("closes one millisecond later", () => {
    expect(formWindowState(published, new Date(closesAt.getTime() + 1))).toBe("closed");
  });

  it("stays open forever with no dates set", () => {
    const always = { isPublished: true, opensAt: null, closesAt: null };
    expect(formWindowState(always, new Date("2099-01-01T00:00:00Z"))).toBe("open");
    expect(acceptsSubmissions(always)).toBe(true);
  });

  it("handles an open date with no close date and vice versa", () => {
    expect(formWindowState({ isPublished: true, opensAt, closesAt: null }, opensAt)).toBe("open");
    expect(
      formWindowState({ isPublished: true, opensAt: null, closesAt }, new Date(closesAt.getTime() + 1)),
    ).toBe("closed");
  });

  it("only accepts submissions while open", () => {
    expect(acceptsSubmissions(published, new Date("2026-03-15T00:00:00Z"))).toBe(true);
    expect(acceptsSubmissions(published, new Date("2026-02-01T00:00:00Z"))).toBe(false);
    expect(acceptsSubmissions(published, new Date("2026-05-01T00:00:00Z"))).toBe(false);
  });
});

describe("datetime-local round trip in the event's zone", () => {
  it("renders an instant as the event's own wall clock", () => {
    // 2026-03-02T07:59Z is 2026-03-01 23:59 in Los Angeles (PST, UTC-8).
    expect(toZonedInputValue(new Date("2026-03-02T07:59:00Z"), "America/Los_Angeles")).toBe(
      "2026-03-01T23:59",
    );
  });

  it("parses the wall clock back to the same instant", () => {
    const parsed = fromZonedInputValue("2026-03-01T23:59", "America/Los_Angeles");
    expect(parsed?.toISOString()).toBe("2026-03-02T07:59:00.000Z");
  });

  it("round-trips across a DST boundary", () => {
    const instant = new Date("2026-07-15T12:30:00Z");
    const rendered = toZonedInputValue(instant, "Europe/Berlin");
    expect(rendered).toBe("2026-07-15T14:30");
    expect(fromZonedInputValue(rendered, "Europe/Berlin")?.toISOString()).toBe(instant.toISOString());
  });

  it("returns empty/null for missing values", () => {
    expect(toZonedInputValue(null, "UTC")).toBe("");
    expect(fromZonedInputValue("", "UTC")).toBeNull();
    expect(fromZonedInputValue("not a date", "UTC")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Track configuration & public field resolution
// ---------------------------------------------------------------------------

describe("track selection", () => {
  it("refreshes the track question's options from the event", () => {
    const fields = [field({ id: "tracks", type: "multiselect", label: "Tracks", options: ["Old"] })];
    expect(withTrackOptions(fields, ["A", "B"])[0].options).toEqual(["A", "B"]);
  });

  it("reads the picked track names whether the question is single or multi", () => {
    const multi = [field({ id: "tracks", type: "multiselect", label: "Tracks" })];
    expect(selectedTrackNames(multi, { tracks: ["A", "B"] })).toEqual(["A", "B"]);
    const single = [field({ id: "tracks", type: "select", label: "Track" })];
    expect(selectedTrackNames(single, { tracks: "A" })).toEqual(["A"]);
    expect(selectedTrackNames([field({ id: "title" })], { title: "x" })).toEqual([]);
  });
});

describe("publicFields", () => {
  it("appends name/email when an organizer removed them", () => {
    const ids = publicFields([field({ id: "title", label: "Talk title" })], []).map((f) => f.id);
    expect(ids).toEqual(["title", "speaker_name", "speaker_email"]);
  });

  it("leaves the schema alone when they're already there", () => {
    expect(publicFields(DEFAULT_CFP_FIELDS, ["A"]).map((f) => f.id)).toEqual(
      DEFAULT_CFP_FIELDS.map((f) => f.id),
    );
  });

  it("carries the event's tracks into the track question", () => {
    const resolved = publicFields(DEFAULT_CFP_FIELDS, ["AI Engineering", "Infrastructure"]);
    expect(resolved.find((f) => f.id === "tracks")?.options).toEqual([
      "AI Engineering",
      "Infrastructure",
    ]);
  });
});

describe("the default CFP form", () => {
  it("is submittable out of the box once the standard questions are answered", () => {
    const fields = publicFields(DEFAULT_CFP_FIELDS, ["AI Engineering"]);
    const result = validateSubmissionValues(fields, {
      ...emptyValues(fields),
      title: "Retrieval that survives production traffic",
      description: "A practitioner story about rebuilding retrieval three times.",
      tracks: ["AI Engineering"],
      speaker_name: "Priya Raman",
      speaker_email: "priya@example.com",
      speaker_bio: "Builds retrieval systems.",
    });
    expect(result.errors).toEqual({});
    expect(result.ok).toBe(true);
  });

  it("blocks an empty submission with one error per required question", () => {
    const fields = publicFields(DEFAULT_CFP_FIELDS, ["AI Engineering"]);
    const { errors } = validateSubmissionValues(fields, emptyValues(fields));
    expect(Object.keys(errors).sort()).toEqual([
      "description",
      "speaker_bio",
      "speaker_email",
      "speaker_name",
      "title",
      "tracks",
    ]);
  });
});

describe("prefillValues", () => {
  it("takes reserved fields from their authoritative source, not from answers", () => {
    const fields = publicFields(DEFAULT_CFP_FIELDS, ["AI Engineering"]);
    const values = prefillValues(fields, {
      answers: { title: "Stale title", speaker_bio: "Builds things.", headshot: "uploads/a.jpg" },
      title: "Current title",
      description: "The abstract",
      trackNames: ["AI Engineering"],
      primarySpeaker: { name: "Priya Raman", email: "priya@example.com" },
      coSpeakers: [{ name: "Sam Ito", email: "sam@example.com" }],
    });
    expect(values.title).toBe("Current title");
    expect(values.description).toBe("The abstract");
    expect(values.tracks).toEqual(["AI Engineering"]);
    expect(values.speaker_email).toBe("priya@example.com");
    expect(values.co_speakers).toEqual([{ name: "Sam Ito", email: "sam@example.com" }]);
    // Custom fields still come from answers.
    expect(values.speaker_bio).toBe("Builds things.");
  });

  it("gives every field a defined empty value so inputs stay controlled", () => {
    const fields = publicFields(DEFAULT_CFP_FIELDS, []);
    const values = prefillValues(fields, {
      answers: {},
      title: "T",
      description: null,
      trackNames: [],
      primarySpeaker: { name: null, email: "a@example.com" },
      coSpeakers: [],
    });
    for (const f of fields) expect(values[f.id]).toBeDefined();
    expect(values.description).toBe("");
    expect(values.speaker_name).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Builder-side schema checks
// ---------------------------------------------------------------------------

describe("fieldSchemaProblems", () => {
  it("passes the default CFP form", () => {
    expect(fieldSchemaProblems(DEFAULT_CFP_FIELDS)).toEqual([]);
  });

  it("catches duplicate internal names and blank labels", () => {
    const problems = fieldSchemaProblems([
      field({ id: "title", label: "Talk title" }),
      field({ id: "title", label: "" }),
    ]);
    expect(problems.some((p) => p.includes("share the internal name"))).toBe(true);
    expect(problems.some((p) => p.includes("needs a label"))).toBe(true);
  });

  it("catches a choice question with no choices, but not the track question", () => {
    expect(
      fieldSchemaProblems([field({ id: "format", type: "select", label: "Format", options: [] })]),
    ).toEqual(['"Format" is a choice question but has no choices']);
    expect(
      fieldSchemaProblems([field({ id: "tracks", type: "multiselect", label: "Tracks", options: [] })]),
    ).toEqual([]);
  });

  it("requires a condition to point backwards at a question that exists", () => {
    expect(
      fieldSchemaProblems([
        field({ id: "a", label: "A", showIf: { fieldId: "gone", op: "eq", value: "x" } }),
      ]),
    ).toEqual(['"A" is conditional on a question that no longer exists']);

    expect(
      fieldSchemaProblems([
        field({ id: "a", label: "A", showIf: { fieldId: "b", op: "eq", value: "x" } }),
        field({ id: "b", label: "B" }),
      ]),
    ).toEqual(['"A" can only depend on a question that comes before it']);
  });

  it("rejects more than one co-speaker block", () => {
    const problems = fieldSchemaProblems([
      field({ id: "co_speakers", type: "co_speakers", label: "Co-speakers" }),
      field({ id: "co_speakers_2", type: "co_speakers", label: "More" }),
    ]);
    expect(problems).toContain("A form can only have one co-speaker block");
  });
});

// ---------------------------------------------------------------------------
// Confirmation email merge fields
// ---------------------------------------------------------------------------

describe("confirmation email checks", () => {
  it("flags placeholders that aren't merge fields at all", () => {
    expect(unknownMergePlaceholders("Hi {{speakerFirstName}}, see {{talkLink}}")).toEqual(["talkLink"]);
  });

  it("flags real merge fields a confirmation email can't fill in", () => {
    expect(unavailableMergeFields("Your session is {{sessionTitle}} at {{eventName}}")).toEqual([
      "sessionTitle",
    ]);
  });

  it("renders a clean preview for the default copy", () => {
    const check = checkConfirmationEmail(
      "We received your talk proposal — {{submissionTitle}}",
      "Hi {{speakerFirstName}},\n\nThanks for proposing \"{{submissionTitle}}\" for {{eventName}}.",
    );
    expect(check.unknown).toEqual([]);
    expect(check.unavailable).toEqual([]);
    expect(check.blank).toEqual([]);
    expect(check.preview.subject).toContain("Retrieval that survives production traffic");
    expect(check.preview.text).toContain("Hi Priya,");
    expect(check.preview.html).toContain("<p");
  });
});
