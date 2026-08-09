/**
 * Seeds the local D1 database with a realistic demo event so every flow can
 * be exercised without setup (decisions.md D-015).
 *
 * Run via `npm run seed`, which resets local D1, applies migrations, then
 * runs this file. It talks to the database **through the storage-agnostic
 * repository layer** (src/db/repos) rather than raw SQL, so seeding
 * doubles as an end-to-end exercise of every repo method the app relies on
 * — if an adapter is broken, `npm run seed` fails.
 *
 * The D1 binding comes from wrangler's `getPlatformProxy`, which reads
 * wrangler.jsonc and attaches to the same local Miniflare state that
 * `next dev` uses.
 */
import { getPlatformProxy } from "wrangler";
import { createD1Repos } from "@/db/repos/d1";
import type { Repos } from "@/db/repos";
import type {
  FormField,
  NewEmailLog,
  NewEvent,
  NewReview,
  NewRoom,
  NewSession,
  NewSubmission,
  NewTask,
  NewTaskAssignment,
  NewTrack,
  NewUser,
  Role,
  Room,
  SubmissionStatus,
  Task,
  Track,
  User,
} from "@/db/entities";
import { VIDEO_LINK_FIELD } from "@/domain/forms";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY);
const hoursFromNow = (hours: number) => new Date(now.getTime() + (hours * DAY) / 24);
/** "YYYY-MM-DD" (UTC-derived) for a day `days` from now — for the date-only
 * columns, which the app renders in UTC (src/components/date-format.ts). */
const dayFromNow = (days: number) => daysFromNow(days).toISOString().slice(0, 10);

function person(
  email: string,
  name: string,
  role: Role,
  extra: Partial<NewUser> = {},
): NewUser {
  return {
    email,
    name,
    role,
    emailVerified: true,
    title: null,
    company: null,
    bio: null,
    headshotUrl: null,
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    socials: null,
    image: null,
    ...extra,
  };
}

/** Deterministic-ish picker so the demo data looks arranged, not random. */
function rotate<T>(items: T[], index: number): T {
  return items[index % items.length];
}

// ---------------------------------------------------------------------------
// Demo content
// ---------------------------------------------------------------------------

// The demo event always sits ~6 weeks out, whenever the seed runs: reminders
// still fire (they stop at event start) and the public program reads as an
// upcoming event, not an archive. e2e/agenda.spec.ts mirrors these offsets.
const EVENT_DAY_1 = dayFromNow(45);
const EVENT_DAY_2 = dayFromNow(46);
const EVENT_DAY_3 = dayFromNow(47);

const EVENT: NewEvent = {
  name: "AI Engineer Summit 2026",
  slug: "ai-engineer-summit-2026",
  description:
    "Three days of practical AI engineering: shipping agents, evaluating models, and running LLM systems in production.",
  startDate: EVENT_DAY_1,
  endDate: EVENT_DAY_3,
  timezone: "America/Los_Angeles",
  location: "Moscone West, San Francisco",
};

const TRACK_SEEDS: Array<Pick<NewTrack, "name" | "color">> = [
  { name: "AI Engineering", color: "#0e7490" },
  { name: "Agents & Tool Use", color: "#7c3aed" },
  { name: "Evals & Reliability", color: "#b45309" },
];

const ROOM_SEEDS: Array<Pick<NewRoom, "name" | "capacity">> = [
  { name: "Main Stage", capacity: 1200 },
  { name: "Workshop A", capacity: 120 },
  { name: "Workshop B", capacity: 120 },
  { name: "Community Hall", capacity: 300 },
];

const SPEAKER_SEEDS: Array<{
  email: string;
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshotUrl: string | null;
}> = [
  {
    email: "priya.raman@example.com",
    name: "Priya Raman",
    title: "Staff ML Engineer",
    company: "Northwind Labs",
    bio: "Builds retrieval systems that survive contact with real users. Previously search infra at a large marketplace.",
    headshotUrl: "https://files.greenroom.dev/demo/priya.jpg",
  },
  {
    email: "tom.beckett@example.com",
    name: "Tom Beckett",
    title: "Principal Engineer",
    company: "Halyard",
    bio: "Spent four years making batch inference cheap enough to be boring.",
    headshotUrl: null,
  },
  {
    email: "aisha.n@example.com",
    name: "Aisha Nwosu",
    title: "Head of AI Platform",
    company: "Meridian Health",
    bio: "Runs the platform team behind a clinical documentation assistant used in 40 hospitals.",
    headshotUrl: "https://files.greenroom.dev/demo/aisha.jpg",
  },
  {
    email: "l.fernandez@example.com",
    name: "Luis Fernández",
    title: "Founding Engineer",
    company: "Tessellate",
    bio: null,
    headshotUrl: null,
  },
  {
    email: "hannah.kim@example.com",
    name: "Hannah Kim",
    title: "Research Engineer",
    company: "Blue Harbor AI",
    bio: "Works on evaluation harnesses and the unglamorous business of measuring regressions.",
    headshotUrl: "https://files.greenroom.dev/demo/hannah.jpg",
  },
  {
    email: "d.oyelaran@example.com",
    name: "Damola Oyelaran",
    title: "Engineering Manager",
    company: "Ravelin",
    bio: "Leads the agents team; has strong opinions about tool schemas.",
    headshotUrl: null,
  },
  {
    email: "sofia.rossi@example.com",
    name: "Sofia Rossi",
    title: "CTO",
    company: "Pomodoro Robotics",
    bio: "Ships embodied agents that have to be right the first time.",
    headshotUrl: "https://files.greenroom.dev/demo/sofia.jpg",
  },
  {
    email: "jw.park@example.com",
    name: "Jae-won Park",
    title: "Developer Advocate",
    company: "Steelthread",
    bio: null,
    headshotUrl: null,
  },
];

/** ~8 fields including one conditional field and the track multiselect. */
function cfpFields(trackNames: string[]): FormField[] {
  return [
    {
      id: "title",
      type: "text",
      label: "Talk title",
      helpText: "Aim for something a busy attendee understands at a glance.",
      required: true,
      maxLength: 80,
    },
    {
      id: "description",
      type: "textarea",
      label: "Abstract",
      helpText: "150–400 words. What will attendees be able to do afterwards?",
      required: true,
      maxLength: 2500,
    },
    {
      id: "tracks",
      type: "multiselect",
      label: "Track(s)",
      helpText: "Pick every track this talk fits — it decides who reviews it.",
      required: true,
      options: trackNames,
    },
    {
      id: "session_format",
      type: "select",
      label: "Session format",
      required: true,
      options: ["30-minute talk", "45-minute talk", "90-minute workshop"],
    },
    {
      // The conditional field: only shown when a workshop is selected.
      id: "workshop_requirements",
      type: "textarea",
      label: "Workshop requirements",
      helpText: "Room layout, hardware, and anything attendees must install.",
      showIf: { fieldId: "session_format", op: "eq", value: "90-minute workshop" },
    },
    {
      id: "speaker_bio",
      type: "textarea",
      label: "Speaker biography",
      required: true,
      maxLength: 600,
    },
    {
      id: "headshot",
      type: "file",
      label: "Headshot",
      helpText: "Square, at least 800×800. You can add this later if needed.",
    },
    {
      id: "prior_talk_url",
      type: "url",
      label: "Link to a previous talk",
      helpText: "Optional, but it helps the review committee a lot.",
    },
    // The video-proposal preset (spec.md §2 "abstracts or videos", D-034).
    { ...VIDEO_LINK_FIELD },
    {
      id: "code_of_conduct",
      type: "checkbox",
      label: "I agree to the code of conduct",
      required: true,
    },
  ];
}

// The two "must-have" onboarding tasks per the organizer's reference video
// are form-style: structured answers rather than a single upload or a plain
// confirmation. Both are linked Form entities, same as the CFP form, just
// reached from a task instead of the public submission listing.
const HOTEL_FORM_FIELDS: FormField[] = [
  {
    id: "needsHotel",
    type: "select",
    label: "Do you need us to book your hotel room?",
    required: true,
    options: ["Yes, book me a room", "No, I'm arranging my own stay"],
  },
  {
    id: "checkIn",
    type: "text",
    label: "Check-in date (YYYY-MM-DD)",
    required: true,
    showIf: { fieldId: "needsHotel", op: "eq", value: "Yes, book me a room" },
  },
  {
    id: "checkOut",
    type: "text",
    label: "Check-out date (YYYY-MM-DD)",
    required: true,
    showIf: { fieldId: "needsHotel", op: "eq", value: "Yes, book me a room" },
  },
  {
    id: "roomPreference",
    type: "select",
    label: "Room preference",
    options: ["One queen bed", "Two beds (sharing with a co-speaker)"],
    showIf: { fieldId: "needsHotel", op: "eq", value: "Yes, book me a room" },
  },
  { id: "notes", type: "textarea", label: "Anything else about your stay?" },
];

const FLIGHT_FORM_FIELDS: FormField[] = [
  {
    id: "reimbursementAmount",
    type: "text",
    label: "Reimbursement amount requested (USD)",
    helpText: "Total from your receipt, e.g. 482.50.",
    required: true,
  },
  { id: "airline", type: "text", label: "Airline and flight number(s)" },
  { id: "receipt", type: "file", label: "Upload your receipt", required: true },
  { id: "notes", type: "textarea", label: "Anything else about your travel?" },
];

interface SubmissionSeed {
  title: string;
  description: string;
  status: SubmissionStatus;
  /** Indexes into SPEAKER_SEEDS; the first is the primary speaker. */
  speakers: number[];
  /** Indexes into TRACK_SEEDS. */
  tracks: number[];
  format: string;
  decisionNote?: string;
}

const SUBMISSION_SEEDS: SubmissionSeed[] = [
  // --- approved (6) -> become sessions ---
  {
    title: "Retrieval that survives production traffic",
    description:
      "Most RAG demos fall over the moment real users show up. We rebuilt our retrieval stack three times; this talk is the version that stuck, including the chunking decisions we regret and the reranker that finally paid for itself.",
    status: "approved",
    speakers: [0],
    tracks: [0],
    format: "45-minute talk",
    decisionNote: "Strong practitioner story, exactly the level our audience wants.",
  },
  {
    title: "Cutting inference spend by 80% without touching quality",
    description:
      "A tour of the batching, caching, and routing changes that took our monthly bill from eye-watering to unremarkable — with the measurements that proved quality held.",
    status: "approved",
    speakers: [1],
    tracks: [0, 2],
    format: "30-minute talk",
    decisionNote: "Numbers are credible and the topic is consistently oversubscribed.",
  },
  {
    title: "Shipping an agent into a hospital",
    description:
      "Clinical settings punish overconfident systems. We walk through the guardrails, escalation paths, and audit trail that let a documentation agent go live in 40 hospitals.",
    status: "approved",
    speakers: [2, 3],
    tracks: [1],
    format: "45-minute talk",
    decisionNote: "Co-presented; confirm both speakers can travel.",
  },
  {
    title: "Evals you'll actually keep running",
    description:
      "Everyone writes an eval suite. Almost nobody maintains one. A practical pattern for evals that stay green, stay fast, and catch the regressions that matter.",
    status: "approved",
    speakers: [4],
    tracks: [2],
    format: "45-minute talk",
  },
  {
    title: "Tool schemas are your real prompt",
    description:
      "Agent reliability is mostly an interface design problem. Concrete before/after schemas, and the failure modes each change removed.",
    status: "approved",
    speakers: [5],
    tracks: [1],
    format: "30-minute talk",
  },
  {
    title: "Hands-on: building a recovery loop for flaky agents",
    description:
      "A workshop where you take a deliberately unreliable agent and add retries, verification, and human handoff until it behaves. Bring a laptop.",
    status: "approved",
    speakers: [6],
    tracks: [1, 2],
    format: "90-minute workshop",
  },

  // --- submitted / unreviewed (4) ---
  {
    title: "What we learned rewriting our prompt library as code",
    description:
      "Prompts drifted across six teams until we treated them like any other artifact: versioned, reviewed, and tested. Here's the migration and what broke.",
    status: "submitted",
    speakers: [7],
    tracks: [0],
    format: "30-minute talk",
  },
  {
    title: "Streaming UIs that don't lie to the user",
    description:
      "Token streaming makes a slow system feel fast — and a wrong system feel confident. Patterns for honest progress, partial results, and graceful correction.",
    status: "submitted",
    speakers: [3],
    tracks: [0],
    format: "30-minute talk",
  },
  {
    title: "Multi-agent systems: when they help and when they're theatre",
    description:
      "We ran the same workload through a single agent and a five-agent committee for six months. The results were not what we pitched internally.",
    status: "submitted",
    speakers: [5, 7],
    tracks: [1],
    format: "45-minute talk",
  },
  {
    title: "Offline evals lied to us for a quarter",
    description:
      "Our benchmark improved every week while user satisfaction fell. A post-mortem on the gap between offline scores and production behaviour.",
    status: "submitted",
    speakers: [4],
    tracks: [2],
    format: "30-minute talk",
  },

  // --- maybe (1) ---
  {
    title: "A field guide to context window budgeting",
    description:
      "How to decide what earns a place in the context window, with a budgeting model you can apply to your own stack.",
    status: "maybe",
    speakers: [1],
    tracks: [0],
    format: "30-minute talk",
    decisionNote: "Good material, overlaps with the retrieval talk. Revisit once the track is full.",
  },

  // --- denied (1) ---
  {
    title: "Introducing our AI platform",
    description:
      "An overview of our company's new AI platform, its architecture, and the roadmap for the coming year.",
    status: "denied",
    speakers: [7],
    tracks: [0],
    format: "30-minute talk",
    decisionNote: "Product pitch rather than a practitioner talk — pointed them at sponsorship.",
  },

  // --- withdrawn (1) ---
  {
    title: "Fine-tuning small models on a budget",
    description:
      "A walkthrough of adapter-based fine-tuning on consumer hardware, with cost and quality comparisons against hosted alternatives.",
    status: "withdrawn",
    speakers: [2],
    tracks: [0],
    format: "45-minute talk",
  },

  // --- drafts, never submitted (2) ---
  {
    title: "Untitled draft — observability for LLM apps",
    description: "Notes toward a talk about tracing multi-step LLM calls without drowning in spans.",
    status: "draft",
    speakers: [6],
    tracks: [2],
    format: "30-minute talk",
  },
  {
    title: "Untitled draft — on-call for AI systems",
    description: "Rough outline: what a pager rotation looks like when the failure mode is 'plausible nonsense'.",
    status: "draft",
    speakers: [0],
    tracks: [2],
    format: "30-minute talk",
  },
];

/** Day/room/time for the three sessions that are placed on the agenda. */
const SCHEDULE: Array<{ day: string; startTime: string; endTime: string; room: number }> = [
  { day: EVENT_DAY_1, startTime: "10:00", endTime: "10:45", room: 0 },
  { day: EVENT_DAY_1, startTime: "11:00", endTime: "11:30", room: 3 },
  { day: EVENT_DAY_2, startTime: "14:00", endTime: "14:45", room: 0 },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(repos: Repos): Promise<void> {
  // --- event, tracks, rooms -------------------------------------------------
  const event = await repos.events.create(EVENT);
  console.log(`event      ${event.name} (/e/${event.slug})`);

  const tracks: Track[] = [];
  for (const t of TRACK_SEEDS) {
    tracks.push(await repos.tracks.create({ eventId: event.id, ...t }));
  }
  const rooms: Room[] = [];
  for (const r of ROOM_SEEDS) {
    rooms.push(await repos.rooms.create({ eventId: event.id, ...r }));
  }
  console.log(`           ${tracks.length} tracks, ${rooms.length} rooms`);

  // --- people ---------------------------------------------------------------
  const admin = await repos.users.create(
    person("admin@greenroom.dev", "Avery Chen", "admin", {
      title: "Head of Programming",
      company: "AI Engineer",
    }),
  );

  const reviewers: User[] = [
    await repos.users.create(
      person("dana@greenroom.dev", "Dana Okoye", "reviewer", {
        title: "Program Committee",
        company: "Northwind Labs",
      }),
    ),
    await repos.users.create(
      person("marco@greenroom.dev", "Marco Silva", "reviewer", {
        title: "Program Committee",
        company: "Halyard",
      }),
    ),
  ];
  // Reviewer routing: reviewers own tracks (spec.md §4).
  await repos.tracks.setReviewerTracks(reviewers[0].id, [tracks[0].id, tracks[2].id]);
  await repos.tracks.setReviewerTracks(reviewers[1].id, [tracks[1].id]);

  const speakers: User[] = [];
  for (const s of SPEAKER_SEEDS) {
    speakers.push(
      await repos.users.create(
        person(s.email, s.name, "speaker", {
          title: s.title,
          company: s.company,
          bio: s.bio,
          headshotUrl: s.headshotUrl,
          // The speakers who look "fully onboarded" in the demo also have the
          // profile links the public gallery renders (spec.md §6); the rest
          // are left blank so the roster shows real gaps.
          websiteUrl: s.headshotUrl ? `https://${s.email.split("@")[1]}` : null,
          linkedinUrl: s.headshotUrl
            ? `https://www.linkedin.com/in/${s.name.toLowerCase().replace(/[^a-z]+/g, "-")}`
            : null,
          twitterUrl: null,
          socials: s.headshotUrl ? { website: `https://${s.email.split("@")[1]}` } : null,
        }),
      ),
    );
  }
  console.log(
    `users      1 admin (${admin.email}), ${reviewers.length} reviewers, ${speakers.length} speakers`,
  );

  // --- forms ----------------------------------------------------------------
  const cfp = await repos.forms.create({
    eventId: event.id,
    name: "Call for Speakers 2026",
    slug: "ai-engineer-summit-2026",
    welcomeCopy:
      "We're looking for practitioner talks: things you built, shipped, measured, and would do differently. Submissions close on 1 March. You can edit your proposal until then.",
    fields: cfpFields(TRACK_SEEDS.map((t) => t.name)),
    opensAt: daysFromNow(-30),
    closesAt: daysFromNow(30),
    confirmationPageContent:
      "Thanks — your proposal is in. You'll get an email confirmation, and you can come back to edit it any time before submissions close.",
    // Merge fields come from the shared vocabulary in
    // src/domain/comms-templates.ts (MERGE_FIELDS).
    confirmationEmailSubject: "We received your talk proposal — {{submissionTitle}}",
    confirmationEmailBody:
      'Hi {{speakerFirstName}},\n\nThanks for proposing "{{submissionTitle}}" for {{eventName}}. Our program committee reviews submissions by track, and you\'ll hear from us by 15 April.\n\nYou can edit your proposal any time before submissions close:\n\n{{portalUrl}}\n\n— The AI Engineer Summit team',
    // Two proposals per speaker (D-034, D-038) — enough to exercise the cap
    // without making the demo feel restrictive.
    maxSubmissionsPerSpeaker: 2,
    isPublished: true,
  });

  const hotelForm = await repos.forms.create({
    eventId: event.id,
    name: "Hotel Stay Requirements",
    slug: "ai-engineer-summit-2026-hotel",
    welcomeCopy:
      "Tell us your dates and preferences so we can book your room — or let us know you're arranging your own stay.",
    fields: HOTEL_FORM_FIELDS,
    opensAt: null,
    closesAt: null,
    confirmationPageContent: "Got it — thanks. We'll follow up by email once your room is booked.",
    confirmationEmailSubject: null,
    confirmationEmailBody: null,
    maxSubmissionsPerSpeaker: null,
    // Onboarding form: reached from a task, not from the public CFP listing.
    isPublished: false,
  });

  const flightForm = await repos.forms.create({
    eventId: event.id,
    name: "Flight Reimbursement",
    slug: "ai-engineer-summit-2026-flight",
    welcomeCopy: "Booked your own flight? Submit the amount and your receipt here for reimbursement.",
    fields: FLIGHT_FORM_FIELDS,
    opensAt: null,
    closesAt: null,
    confirmationPageContent: "Thanks — reimbursements are processed within two weeks of the event.",
    confirmationEmailSubject: null,
    confirmationEmailBody: null,
    maxSubmissionsPerSpeaker: null,
    isPublished: false,
  });
  console.log(
    `forms      "${cfp.name}" (/submit/${cfp.slug}), "${hotelForm.name}" + "${flightForm.name}" (onboarding)`,
  );

  // --- submissions ----------------------------------------------------------
  const approved: Array<{ submissionId: string; seedRow: SubmissionSeed }> = [];
  const submissionByTitle = new Map<string, string>();

  for (const [index, seedRow] of SUBMISSION_SEEDS.entries()) {
    const decided = ["approved", "maybe", "denied"].includes(seedRow.status);
    const primary = speakers[seedRow.speakers[0]];

    const input: NewSubmission = {
      eventId: event.id,
      formId: cfp.id,
      title: seedRow.title,
      description: seedRow.description,
      answers: {
        session_format: seedRow.format,
        speaker_bio: primary.bio ?? "",
        code_of_conduct: true,
        prior_talk_url: index % 3 === 0 ? "https://www.youtube.com/watch?v=example" : "",
        ...(seedRow.format === "90-minute workshop"
          ? {
              workshop_requirements:
                "Classroom layout for 60, power at every seat, and attendees need Node 22 installed.",
            }
          : {}),
      },
      status: seedRow.status,
      // Every draft carries the token behind its emailed resume link (D-034),
      // so the demo can reopen one at /submit/{slug}/resume/{token}.
      resumeToken: seedRow.status === "draft" ? `seed-draft-resume-${index}` : null,
      decidedBy: decided ? admin.id : null,
      decidedAt: decided ? daysFromNow(-7 + (index % 5)) : null,
      decisionNote: seedRow.decisionNote ?? null,
    };

    const submission = await repos.submissions.create(input);
    submissionByTitle.set(seedRow.title, submission.id);

    await repos.submissions.setTracks(
      submission.id,
      seedRow.tracks.map((t) => tracks[t].id),
    );
    for (const [position, speakerIndex] of seedRow.speakers.entries()) {
      await repos.submissions.addSpeaker(
        submission.id,
        speakers[speakerIndex].id,
        position === 0 ? "primary" : "co",
      );
    }

    if (seedRow.status === "approved") approved.push({ submissionId: submission.id, seedRow });
  }
  console.log(`submissions ${SUBMISSION_SEEDS.length} across all six statuses`);

  // --- a second CFP that closes tomorrow, with an unfinished draft on it ----
  // Exercises two D-034 features that the main CFP can't: the one-proposal
  // cap, and the reminder the cron sends when a form with a saved draft is
  // inside its final 48 hours.
  const lightning = await repos.forms.create({
    eventId: event.id,
    name: "Lightning Talks (closing soon)",
    slug: "ai-engineer-summit-2026-lightning",
    welcomeCopy:
      "Five minutes, one idea, no slides required. One proposal per speaker — pick your best one.",
    fields: [
      {
        id: "title",
        type: "text",
        label: "Lightning talk title",
        required: true,
        maxLength: 60,
      },
      {
        id: "description",
        type: "textarea",
        label: "What's the idea?",
        helpText: "Two or three sentences is plenty.",
        required: true,
        maxLength: 400,
      },
      { ...VIDEO_LINK_FIELD },
      { id: "speaker_name", type: "text", label: "Your name", required: true },
      { id: "speaker_email", type: "email", label: "Your email", required: true },
    ],
    opensAt: daysFromNow(-7),
    closesAt: hoursFromNow(30),
    confirmationPageContent: "Got it — five minutes are yours if we can fit you in.",
    confirmationEmailSubject: null,
    confirmationEmailBody: null,
    maxSubmissionsPerSpeaker: 1,
    isPublished: true,
  });

  const lightningDraft = await repos.submissions.create({
    eventId: event.id,
    formId: lightning.id,
    title: "Untitled draft — five things that broke in prod",
    description: "Half-written: the five smallest changes that caused the biggest outages.",
    answers: { video_link: "" },
    status: "draft",
    resumeToken: "seed-draft-resume-lightning",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  });
  await repos.submissions.addSpeaker(lightningDraft.id, speakers[1].id, "primary");
  console.log(
    `forms      "${lightning.name}" (/submit/${lightning.slug}) closes in 30h with 1 draft waiting`,
  );

  // --- a couple of reviewer notes (enhancement tier, but nice for the demo) --
  const reviewSeeds: NewReview[] = [
    {
      submissionId: submissionByTitle.get("Retrieval that survives production traffic")!,
      reviewerId: reviewers[0].id,
      score: 5,
      comment: "Best retrieval submission this year. Would open the track with it.",
      recommendation: "approve",
    },
    {
      submissionId: submissionByTitle.get("Multi-agent systems: when they help and when they're theatre")!,
      reviewerId: reviewers[1].id,
      score: 4,
      comment: "Refreshingly sceptical. Want to see the six-month data before confirming.",
      recommendation: "maybe",
    },
    {
      submissionId: submissionByTitle.get("Introducing our AI platform")!,
      reviewerId: reviewers[0].id,
      score: 1,
      comment: "Vendor pitch.",
      recommendation: "deny",
    },
  ];
  for (const review of reviewSeeds) await repos.reviews.create(review);

  // --- review rounds (spec.md "Important" — multi-round scored evaluations) --
  // Round one is mid-flight, so progress and aggregate scores render non-empty;
  // round two is configured with a different scorecard and a different reviewer
  // pool but hasn't opened yet — which is what makes the plan visibly *multi*
  // round rather than one global review setup.
  const firstPass = await repos.reviewRounds.create({
    eventId: event.id,
    name: "First-pass review",
    description: "Screening pass — anything plausible goes through to the committee round.",
    opensAt: daysFromNow(-14),
    closesAt: daysFromNow(14),
    criteria: [
      {
        id: "originality",
        label: "Originality",
        type: "number",
        min: 1,
        max: 5,
        weight: 2,
        helpText: "Have we heard this talk three times already?",
      },
      { id: "relevance", label: "Relevance", type: "number", min: 1, max: 5, weight: 1 },
      {
        id: "recommendation",
        label: "Recommendation",
        type: "select",
        options: ["Accept", "Maybe", "Decline"],
      },
      { id: "comments", label: "Comments", type: "text" },
    ],
  });

  const finalRound = await repos.reviewRounds.create({
    eventId: event.id,
    name: "Committee final round",
    description: "The shortlist, scored on one number by the program committee.",
    opensAt: daysFromNow(21),
    closesAt: daysFromNow(45),
    criteria: [
      { id: "final_score", label: "Final score", type: "number", min: 1, max: 10, weight: 1 },
      { id: "comments", label: "Comments", type: "text" },
    ],
  });

  interface RoundWorkSeed {
    title: string;
    reviewer: User;
    values?: Record<string, unknown>;
    recusalReason?: string;
  }

  const firstPassWork: RoundWorkSeed[] = [
    {
      title: "Retrieval that survives production traffic",
      reviewer: reviewers[0],
      values: {
        originality: 4,
        relevance: 5,
        recommendation: "Accept",
        comments: "Strongest retrieval submission this year — would open the track with it.",
      },
    },
    {
      title: "Shipping an agent into a hospital",
      reviewer: reviewers[0],
      values: {
        originality: 5,
        relevance: 4,
        recommendation: "Accept",
        comments: "Co-presented and genuinely novel. Confirm both speakers can travel.",
      },
    },
    { title: "Evals you'll actually keep running", reviewer: reviewers[0] },
    {
      title: "Multi-agent systems: when they help and when they're theatre",
      reviewer: reviewers[1],
      values: {
        originality: 3,
        relevance: 4,
        recommendation: "Maybe",
        comments: "Refreshingly sceptical; want the six-month data before confirming.",
      },
    },
    {
      title: "Introducing our AI platform",
      reviewer: reviewers[1],
      recusalReason: "I consult for this company.",
    },
    { title: "Streaming UIs that don't lie to the user", reviewer: reviewers[1] },
  ];

  for (const work of firstPassWork) {
    const submissionId = submissionByTitle.get(work.title);
    if (!submissionId) continue;
    const roundAssignment = await repos.reviewRounds.assign(
      firstPass.id,
      submissionId,
      work.reviewer.id,
    );
    if (work.values) {
      await repos.reviewRounds.saveScore(roundAssignment.id, work.values, daysFromNow(-3));
      await repos.reviewRounds.setAssignmentStatus(roundAssignment.id, "done", null);
    }
    if (work.recusalReason) {
      await repos.reviewRounds.setAssignmentStatus(
        roundAssignment.id,
        "recused",
        work.recusalReason,
      );
    }
  }

  // A different pool for round two: Marco alone, nothing scored yet.
  for (const title of [
    "Retrieval that survives production traffic",
    "Shipping an agent into a hospital",
  ]) {
    const submissionId = submissionByTitle.get(title);
    if (submissionId) await repos.reviewRounds.assign(finalRound.id, submissionId, reviewers[1].id);
  }

  console.log(
    `rounds     2 (${firstPass.name} — open with ${firstPassWork.length} assignments; ${finalRound.name} — not open yet)`,
  );

  // --- sessions (accepted submissions become agenda items) ------------------
  const sessionIds: string[] = [];
  for (const [index, { submissionId, seedRow }] of approved.entries()) {
    // The first few land on the agenda; the rest stay in the parking lot so
    // the agenda builder has something to place.
    const placement = index < SCHEDULE.length ? SCHEDULE[index] : null;

    const input: NewSession = {
      eventId: event.id,
      title: seedRow.title,
      description: seedRow.description,
      submissionId,
      trackId: tracks[seedRow.tracks[0]].id,
      roomId: placement ? rooms[placement.room].id : null,
      day: placement?.day ?? null,
      startTime: placement?.startTime ?? null,
      endTime: placement?.endTime ?? null,
      status: "confirmed",
    };
    const session = await repos.sessions.create(input);
    sessionIds.push(session.id);

    for (const speakerIndex of seedRow.speakers) {
      await repos.sessions.assignSpeaker(session.id, speakers[speakerIndex].id);
    }
  }
  console.log(
    `sessions   ${sessionIds.length} from accepted talks (${SCHEDULE.length} scheduled, ${sessionIds.length - SCHEDULE.length} unscheduled)`,
  );

  // --- onboarding tasks -----------------------------------------------------
  // The six canonical examples from the organizer's reference video: the two
  // "must-have" form tasks (hotel, flight) first, then four confirm/upload
  // tasks. Due dates are spread across past/near/far so the seeded data
  // exercises every TaskState (overdue, due_soon, open, complete) without any
  // code change needed beyond the domain's existing state derivation.
  const taskSeeds: NewTask[] = [
    {
      eventId: event.id,
      title: "Hotel stay requirement form",
      instructions:
        "Tell us your check-in/check-out dates and room preference so we can book your stay — or confirm you're arranging your own.",
      type: "form",
      formId: hotelForm.id,
      dueAt: daysFromNow(14),
      autoAssignOnAccept: true,
    },
    {
      eventId: event.id,
      title: "Flight reimbursement form",
      instructions: "Book your own flight, then submit the amount and your receipt here for reimbursement.",
      type: "form",
      formId: flightForm.id,
      dueAt: daysFromNow(21),
      autoAssignOnAccept: true,
    },
    {
      eventId: event.id,
      title: "Finalize talk description",
      instructions:
        "Check the title and abstract we'll print in the program. Edit anything that's out of date with the organizers, then confirm it's ready.",
      type: "confirm",
      formId: null,
      dueAt: daysFromNow(-3),
      autoAssignOnAccept: true,
    },
    {
      eventId: event.id,
      title: "Finalize bio & photos",
      instructions: "Upload a square headshot — at least 800×800, plain background if possible.",
      type: "file_request",
      formId: null,
      dueAt: daysFromNow(2),
      autoAssignOnAccept: true,
    },
    {
      eventId: event.id,
      title: "Announce participation",
      instructions: "Once you've posted about speaking on social media or your newsletter, confirm here so we can amplify it.",
      type: "confirm",
      formId: null,
      dueAt: daysFromNow(28),
      autoAssignOnAccept: true,
    },
    {
      eventId: event.id,
      title: "Invite colleagues with speaker discount",
      instructions: "Share your speaker discount code with colleagues, then confirm you've sent it.",
      type: "confirm",
      formId: null,
      dueAt: daysFromNow(35),
      autoAssignOnAccept: true,
    },
  ];
  const tasks: Task[] = [];
  for (const t of taskSeeds) tasks.push(await repos.tasks.create(t));

  // Everyone speaking at the event gets every auto-assigned task; leave the
  // states mixed so the admin onboarding view has something to show.
  const speakingIds = new Set<string>();
  for (const sessionId of sessionIds) {
    for (const id of await repos.sessions.listSpeakerIds(sessionId)) speakingIds.add(id);
  }
  // listSpeakerIds() has no explicit ORDER BY, so co-speaker row order for a
  // session isn't guaranteed stable across reseeds — sort by each speaker's
  // fixed position in SPEAKER_SEEDS (via `speakers`, created in that order
  // above) so speakerPos below, and therefore which named speaker lands on
  // which task state, is deterministic run to run.
  const seedOrder = new Map(speakers.map((s, i) => [s.id, i]));
  const orderedSpeakingIds = [...speakingIds].sort(
    (a, b) => (seedOrder.get(a) ?? 0) - (seedOrder.get(b) ?? 0),
  );

  let assignmentCount = 0;
  let completedCount = 0;
  for (const [speakerPos, speakerId] of orderedSpeakingIds.entries()) {
    for (const [taskPos, task] of tasks.entries()) {
      // Roughly two-thirds done, mixed across every task so the overdue and
      // due-soon tasks above still have some speakers who haven't finished
      // them (that's what makes those states show up in the demo).
      const completed = (speakerPos + taskPos) % 3 !== 0;
      const assignment: NewTaskAssignment = {
        taskId: task.id,
        speakerId,
        status: completed ? "completed" : "pending",
        completedAt: completed ? daysFromNow(-(speakerPos % 5) - 1) : null,
        responseJson: completed
          ? task.formId === hotelForm.id
            ? {
                needsHotel: "Yes, book me a room",
                checkIn: "2026-08-10",
                checkOut: "2026-08-13",
                roomPreference: "One queen bed",
                notes: "",
              }
            : task.formId === flightForm.id
              ? {
                  reimbursementAmount: "482.50",
                  airline: "United UA1234 / UA5678",
                  receipt: `https://files.greenroom.dev/demo/receipt-${speakerPos + 1}.pdf`,
                  notes: "",
                }
              : null
          : null,
        fileUrl:
          completed && task.type === "file_request"
            ? `https://files.greenroom.dev/demo/headshot-${speakerPos + 1}.jpg`
            : null,
      };
      await repos.taskAssignments.create(assignment);
      assignmentCount += 1;
      if (completed) completedCount += 1;
    }
  }
  console.log(
    `tasks      ${tasks.length} tasks, ${assignmentCount} assignments (${completedCount} completed, ${assignmentCount - completedCount} outstanding)`,
  );

  // --- communication log ----------------------------------------------------
  const emailSeeds: NewEmailLog[] = [
    {
      to: speakers[0].email,
      subject: "We received your talk proposal — Retrieval that survives production traffic",
      kind: "submission_confirmation",
      relatedType: "submission",
      relatedId: submissionByTitle.get("Retrieval that survives production traffic")!,
      status: "sent",
      error: null,
      sentAt: daysFromNow(-21),
    },
    {
      to: speakers[0].email,
      subject: "Your talk was accepted for AI Engineer Summit 2026",
      kind: "decision",
      relatedType: "submission",
      relatedId: submissionByTitle.get("Retrieval that survives production traffic")!,
      status: "sent",
      error: null,
      sentAt: daysFromNow(-6),
    },
    {
      to: speakers[7].email,
      subject: "An update on your AI Engineer Summit 2026 proposal",
      kind: "decision",
      relatedType: "submission",
      relatedId: submissionByTitle.get("Introducing our AI platform")!,
      status: "sent",
      error: null,
      sentAt: daysFromNow(-6),
    },
    {
      to: rotate(speakers, 2).email,
      subject: "Reminder: upload your headshot",
      kind: "task_reminder",
      relatedType: "user",
      relatedId: rotate(speakers, 2).id,
      status: "sent",
      error: null,
      sentAt: daysFromNow(-2),
    },
    {
      to: "l.fernandez@example.com",
      subject: "Your session details for AI Engineer Summit 2026",
      kind: "calendar_invite",
      relatedType: "session",
      relatedId: sessionIds[2],
      status: "failed",
      error: "550 5.1.1 recipient address rejected",
      sentAt: daysFromNow(-1),
    },
  ];
  for (const email of emailSeeds) await repos.emailLog.create(email);
  console.log(`emails     ${emailSeeds.length} log entries`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { env, dispose } = await getPlatformProxy<CloudflareEnv>({
    configPath: "./wrangler.jsonc",
  });

  try {
    await seed(createD1Repos(env.DB));
    console.log("\nSeed complete. Start the app with `npm run dev`, then sign in at");
    console.log("http://localhost:3000/login as admin@greenroom.dev and open the link");
    console.log("printed in the dev-server console (also in .dev-magic-links.log).");
  } finally {
    await dispose();
  }
}

void main();
