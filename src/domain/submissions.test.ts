import { describe, expect, it } from "vitest";
import type {
  Event,
  Form,
  NewSubmission,
  Submission,
  SubmissionSpeaker,
  Track,
  User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import { DEFAULT_CFP_FIELDS, publicFields } from "@/domain/forms";
import { newResumeToken, saveSubmission, speakerLimitState } from "@/domain/submissions";

const NOW = new Date("2026-05-01T17:00:00.000Z");

function timestamps() {
  return { createdAt: NOW, updatedAt: NOW };
}

function event(): Event {
  return {
    id: "event-1",
    name: "AI Engineer Summit 2026",
    slug: "aie-2026",
    description: null,
    startDate: "2026-06-16",
    endDate: "2026-06-18",
    timezone: "America/Los_Angeles",
    location: null,
    ...timestamps(),
  };
}

function form(overrides: Partial<Form> = {}): Form {
  return {
    id: "form-1",
    eventId: "event-1",
    name: "Call for Speakers",
    slug: "aie-2026-cfp",
    type: "abstract",
    welcomeCopy: null,
    fields: DEFAULT_CFP_FIELDS,
    opensAt: null,
    closesAt: null,
    confirmationPageContent: null,
    confirmationEmailSubject: null,
    confirmationEmailBody: null,
    maxSubmissionsPerSpeaker: null,
    isPublished: true,
    ...timestamps(),
    ...overrides,
  };
}

const TRACKS: Track[] = [
  { id: "track-1", eventId: "event-1", name: "AI Engineering", color: null, ...timestamps() },
];

/** A complete set of answers to the default CFP form. */
function answers(overrides: Record<string, unknown> = {}) {
  const fields = publicFields(DEFAULT_CFP_FIELDS, ["AI Engineering"]);
  const values: Record<string, unknown> = {};
  for (const field of fields) values[field.id] = field.type === "checkbox" ? false : "";
  return {
    ...values,
    title: "Retrieval that survives production traffic",
    description: "A practitioner story about rebuilding retrieval three times.",
    tracks: ["AI Engineering"],
    speaker_name: "Priya Raman",
    speaker_email: "priya@example.test",
    speaker_bio: "Builds retrieval systems.",
    code_of_conduct: true,
    ...overrides,
  };
}

/**
 * An in-memory stand-in for the four tables a submission spans. Enough to run
 * the real `saveSubmission` — the point is to exercise the actual create /
 * promote / limit code rather than assert against mocks.
 */
function fakeRepos(seed: { submissions?: Submission[]; users?: User[] } = {}) {
  const submissions: Submission[] = [...(seed.submissions ?? [])];
  const users: User[] = [...(seed.users ?? [])];
  const speakerLinks: SubmissionSpeaker[] = [];
  const trackLinks: Record<string, string[]> = {};

  const repos = {
    users: {
      getById: async (id: string) => users.find((row) => row.id === id) ?? null,
      getByEmail: async (email: string) => users.find((row) => row.email === email) ?? null,
      create: async (input: Omit<User, "id" | "createdAt" | "updatedAt">) => {
        const created: User = { id: `user-${users.length + 1}`, ...input, ...timestamps() };
        users.push(created);
        return created;
      },
      update: async (id: string, patch: Partial<User>) => {
        const index = users.findIndex((row) => row.id === id);
        users[index] = { ...users[index], ...patch };
        return users[index];
      },
    },
    submissions: {
      getById: async (id: string) => submissions.find((row) => row.id === id) ?? null,
      create: async (input: NewSubmission) => {
        const created: Submission = {
          id: `submission-${submissions.length + 1}`,
          ...input,
          ...timestamps(),
        };
        submissions.push(created);
        return created;
      },
      update: async (id: string, patch: Partial<NewSubmission>) => {
        const index = submissions.findIndex((row) => row.id === id);
        submissions[index] = { ...submissions[index], ...patch };
        return submissions[index];
      },
      listByFormAndSpeaker: async (formId: string, userId: string) =>
        submissions.filter(
          (row) =>
            row.formId === formId &&
            speakerLinks.some(
              (link) =>
                link.submissionId === row.id && link.userId === userId && link.role === "primary",
            ),
        ),
      setTracks: async (submissionId: string, trackIds: string[]) => {
        trackLinks[submissionId] = trackIds;
      },
      listSpeakers: async (submissionId: string) =>
        speakerLinks.filter((link) => link.submissionId === submissionId),
      addSpeaker: async (submissionId: string, userId: string, role: "primary" | "co") => {
        if (
          !speakerLinks.some((link) => link.submissionId === submissionId && link.userId === userId)
        ) {
          speakerLinks.push({ submissionId, userId, role });
        }
      },
      removeSpeaker: async (submissionId: string, userId: string) => {
        const index = speakerLinks.findIndex(
          (link) => link.submissionId === submissionId && link.userId === userId,
        );
        if (index >= 0) speakerLinks.splice(index, 1);
      },
    },
  };

  return { repos: repos as unknown as Repos, submissions, users, trackLinks };
}

function save(repos: Repos, values: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return saveSubmission(
    { repos },
    { form: form(), event: event(), tracks: TRACKS, values, ...extra },
  );
}

// ---------------------------------------------------------------------------
// Drafts (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

describe("saving a draft", () => {
  it("keeps a half-finished proposal that the finished form would reject", async () => {
    const { repos } = fakeRepos();
    const result = await save(
      repos,
      { speaker_email: "priya@example.test", title: "Half an idea" },
      { status: "draft" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.submission.status).toBe("draft");
    expect(result.submission.title).toBe("Half an idea");
  });

  it("gives every draft its own resume secret", async () => {
    const { repos } = fakeRepos();
    const first = await save(repos, answers(), { status: "draft" });
    const second = await save(
      repos,
      answers({ title: "Another one" }),
      { status: "draft" },
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.submission.resumeToken).toBeTruthy();
    expect(second.submission.resumeToken).not.toBe(first.submission.resumeToken);
  });

  it("hands a finished submission no resume token at all", async () => {
    const { repos } = fakeRepos();
    const result = await save(repos, answers());
    expect(result.ok && result.submission.resumeToken).toBeNull();
  });

  it("mints tokens long enough to be worth using as authentication", () => {
    // The link *is* the login, so the secret has to be magic-link grade.
    expect(newResumeToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(newResumeToken()).not.toBe(newResumeToken());
  });

  it("promotes a draft to submitted, keeping the link already in the inbox alive", async () => {
    const { repos } = fakeRepos();
    const draft = await save(repos, answers(), { status: "draft" });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const promoted = await save(repos, answers(), {
      submissionId: draft.submission.id,
      status: "submitted",
    });

    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.submission.id).toBe(draft.submission.id);
    expect(promoted.submission.status).toBe("submitted");
    expect(promoted.submission.resumeToken).toBe(draft.submission.resumeToken);
  });

  it("refuses to demote a proposal the committee already has", async () => {
    // The submitter owns exactly one status change — finishing their draft.
    // Editing an approved talk must never pull it back out of the queue.
    const { repos } = fakeRepos();
    const sent = await save(repos, answers());
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const edited = await save(repos, answers({ title: "Retitled" }), {
      submissionId: sent.submission.id,
      status: "draft",
    });

    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.submission.status).toBe("submitted");
    expect(edited.submission.title).toBe("Retitled");
  });

  it("still refuses a draft answer that could never be submitted", async () => {
    const { repos } = fakeRepos();
    const result = await save(repos, { speaker_email: "not-an-address" }, { status: "draft" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors).toHaveProperty("speaker_email");
  });
});

// ---------------------------------------------------------------------------
// Per-speaker limits (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

describe("speakerLimitState", () => {
  it("gives a first-time submitter a clean slate", async () => {
    const { repos } = fakeRepos();
    const state = await speakerLimitState(
      { repos },
      form({ maxSubmissionsPerSpeaker: 1 }),
      "stranger@example.test",
    );
    expect(state).toEqual({ limit: 1, used: 0, remaining: 1, atLimit: false });
  });

  it("counts what this speaker already sent to this form", async () => {
    const { repos } = fakeRepos();
    await save(repos, answers());

    const state = await speakerLimitState(
      { repos },
      form({ maxSubmissionsPerSpeaker: 1 }),
      "priya@example.test",
    );
    expect(state.atLimit).toBe(true);
  });

  it("is blind to case and stray spaces in the address", async () => {
    const { repos } = fakeRepos();
    await save(repos, answers());

    const state = await speakerLimitState(
      { repos },
      form({ maxSubmissionsPerSpeaker: 1 }),
      "  Priya@Example.test ",
    );
    expect(state.atLimit).toBe(true);
  });

  it("doesn't hold a speaker's own draft against them when they finish it", async () => {
    const { repos } = fakeRepos();
    const draft = await save(repos, answers(), { status: "draft" });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const state = await speakerLimitState(
      { repos },
      form({ maxSubmissionsPerSpeaker: 1 }),
      "priya@example.test",
      { excludeId: draft.submission.id },
    );
    expect(state.atLimit).toBe(false);
  });

  it("doesn't spend a slot on being someone else's co-speaker", async () => {
    const { repos } = fakeRepos();
    await save(
      repos,
      answers({
        speaker_email: "dan@example.test",
        speaker_name: "Dan",
        co_speakers: [{ name: "Priya Raman", email: "priya@example.test", title: "", company: "" }],
      }),
    );

    const state = await speakerLimitState(
      { repos },
      form({ maxSubmissionsPerSpeaker: 1 }),
      "priya@example.test",
    );
    expect(state.used).toBe(0);
  });
});
