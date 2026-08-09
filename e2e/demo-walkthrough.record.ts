import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { signIn } from "./helpers";

/**
 * The recorded product demo (walkthrough/walkthrough.md) — a *recording*, not a test.
 *
 *   npx playwright test --config playwright.demo.config.ts
 *   node scripts/assemble-walkthrough.mjs
 *
 * One test per act, so Playwright produces one video clip per act; the clips
 * plus the narration manifest written here are what
 * scripts/assemble-walkthrough.mjs turns into walkthrough/walkthrough.mp4 +
 * walkthrough/walkthrough.srt.
 *
 * Pacing, not assertions, is the point: slowMo is on in the config and every
 * beat holds long enough for a viewer to read the thing being pointed at.
 * Assertions are deliberately thin and shape-only — an over-strict expectation
 * that trips in act 5 would throw away acts 6 through 9 (the file runs
 * `describe.serial`, because each act builds on the previous one's state).
 *
 * Personas, exactly as the script casts them:
 *   Avery Chen   admin@greenroom.dev        organizer   — storageState, acts 1,3,5,7,8
 *   Dana Okoye   dana@greenroom.dev         reviewer    — storageState, act 4
 *   Nadia Farouk nadia.farouk@example.com   speaker     — created live in act 2,
 *                                                         signs in on camera in act 6
 * Acts 2 and 9 are signed out. Avery and Dana are authenticated once, off
 * camera, in the setup test — the script's own call ("show the magic link
 * exactly once, live, in act 6").
 */

const EVENT = "ai-engineer-summit-2026";
const SUBMISSIONS = `/admin/${EVENT}/submissions`;
const FORMS = `/admin/${EVENT}/forms`;
const AGENDA = `/admin/${EVENT}/agenda`;
const COMMS = `/admin/${EVENT}/communications`;
const SPEAKERS_ADMIN = `/admin/${EVENT}/speakers`;
const PROGRAM = `/p/${EVENT}`;
const EMBED_SCHEDULE = `/embed/${EVENT}/schedule`;

const STATE_DIR = "demo-recording/state";
const AVERY_STATE = `${STATE_DIR}/avery.json`;
const DANA_STATE = `${STATE_DIR}/dana.json`;
const MANIFEST = "demo-recording/manifest.json";

const NADIA = "nadia.farouk@example.com";
const OWEN = "owen.diallo@example.com";

const TALK = "Catching silent regressions before your users do";
const RETRIEVAL = "Retrieval that survives production traffic";
const TOOL_SCHEMAS = "Tool schemas are your real prompt";

const ABSTRACT =
  "Our eval suite stayed green for three weeks while support tickets doubled. This talk is the " +
  "instrumentation we added to close that gap: production traces sampled into a golden set, " +
  "per-release diffing, and an alert that fires on behaviour change rather than on a score. " +
  "You'll leave with a checklist you can run against your own stack on Monday.";
const BIO =
  "Runs the reliability team behind a support-automation product used by 2,000 companies. " +
  "Spends most of her week reading traces.";
const CHANGE_REQUEST =
  "Great topic. Two things before we decide: trim the abstract to 100 words, and add one " +
  "concrete before/after number from the regression you caught.";
const REVIEW_COMMENT =
  "Yes. This is the talk our attendees keep asking for, and she has the production numbers to " +
  "back it. Ask her to keep the tooling vendor-neutral.";
const DECISION_NOTE =
  "Congratulations — we'd love this on the Evals & Reliability track. Aim for 45 minutes with " +
  "10 for questions, and please keep the production numbers in.";
const BAD_TEMPLATE_LINE = "See you in {{sessionRoom}}.";
const GOOD_TEMPLATE_LINE = "Our team is around all week if you're stuck, {{speakerFirstName}}.";

// ---------------------------------------------------------------------------
// Narration manifest
// ---------------------------------------------------------------------------

interface Cue {
  text: string;
  /** Offset into this act's clip, in ms. */
  atMs: number;
}

interface ActEntry {
  act: number;
  title: string;
  clip: string;
  outputDir: string;
  lines: Cue[];
}

/** Module state survives across tests: one worker, one file, serial order. */
const acts: ActEntry[] = [];
/** Spoken over the opening shot of act 1 / the closing shot of act 9 — kept
 * apart from the act cues so the assembler can anchor them to those clips. */
const coldOpen: Cue[] = [];
const closing: Cue[] = [];

let bucket: Cue[] = [];
let actStart = 0;

/** The new proposal, discovered in act 2 and used from act 3 on. */
let submissionAdminUrl = "";
/** An Agents & Tool Use submission — the one Dana must *not* be able to open. */
let forbiddenUrl = "";

async function startAct(page: Page, actNumber: number, title: string): Promise<void> {
  // Narration-paced acts run far past any test timeout worth having; the
  // config's 300s is the floor, not the budget.
  test.setTimeout(420_000);
  // Next's dev-tools bubble sits in the corner of every frame otherwise. It
  // belongs to the dev server, not to the product, so it stays out of the take.
  //
  // The style has to go in on DOMContentLoaded, not at init time: a <style>
  // parented to <html> before the parser has built <head> gets discarded when
  // it does, which is why the first take still had the bubble in every frame.
  await page.addInitScript(() => {
    const inject = () => {
      if (document.getElementById("demo-hide-devtools")) return;
      const style = document.createElement("style");
      style.id = "demo-hide-devtools";
      style.textContent =
        "nextjs-portal, nextjs-toast, [data-nextjs-toast] { display: none !important; }";
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", inject, { once: true });
    } else {
      inject();
    }
  });
  actStart = Date.now();
  bucket = [];
  acts.push({ act: actNumber, title, clip: "", outputDir: "", lines: bucket });
}

function endAct(testInfo: TestInfo): void {
  const entry = acts[acts.length - 1];
  entry.clip = testInfo.outputPath("video.webm");
  entry.outputDir = testInfo.outputDir;
}

/** How long a subtitle-sized line stays on screen — roughly reading speed,
 * floored so short lines don't flash and capped so long ones don't stall. */
function holdFor(text: string): number {
  return Math.min(4200, Math.max(1600, Math.round(text.length * 42)));
}

/** Records one narration beat at the current offset, then holds for it. */
async function say(page: Page, ...lines: string[]): Promise<void> {
  for (const text of lines) {
    bucket.push({ text, atMs: Date.now() - actStart });
    await page.waitForTimeout(holdFor(text));
  }
}

/** Same, but the beat belongs to the cold open / close rather than the act. */
async function sayInto(target: Cue[], page: Page, ...lines: string[]): Promise<void> {
  for (const text of lines) {
    target.push({ text, atMs: Date.now() - actStart });
    await page.waitForTimeout(holdFor(text));
  }
}

async function outline(locator: Locator, on: boolean): Promise<void> {
  await locator
    .evaluate((node, enabled) => {
      const el = node as HTMLElement;
      if (enabled) {
        el.style.setProperty("outline", "3px solid #f59e0b", "important");
        el.style.setProperty("outline-offset", "3px", "important");
      } else {
        el.style.removeProperty("outline");
        el.style.removeProperty("outline-offset");
      }
    }, on)
    .catch(() => {
      /* The element went away mid-beat (toasts do). Never fail a take for it. */
    });
}

/**
 * Brings a thing on screen, rings it, narrates it, un-rings it.
 *
 * Every wait here is bounded. Playwright's default action timeout is "none",
 * which in a 300-second act means one missing element silently eats the take —
 * so a thing that isn't there costs eight seconds and the narration carries on.
 */
async function point(page: Page, locator: Locator, ...lines: string[]): Promise<void> {
  const target = locator.first();
  const present = await target
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (present) {
    await target.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
    await outline(target, true);
  }
  await say(page, ...lines);
  if (present) await outline(target, false);
}

// ---------------------------------------------------------------------------
// The dev email transport, on camera
// ---------------------------------------------------------------------------

/**
 * walkthrough.md points at a terminal split showing `>> EMAIL (dev transport)`
 * blocks. A recording has no terminal, so the equivalent proof is rendered in
 * the browser: the *actual* files the dev transport wrote to `.dev-emails/`,
 * headers and all, labelled with their path.
 */
async function transcriptsSince(
  since: number,
  extension: string,
  matching: (body: string) => boolean,
): Promise<Array<{ name: string; body: string }>> {
  const files = await readdir(".dev-emails").catch(() => [] as string[]);
  const found: Array<{ name: string; body: string; mtime: number }> = [];
  for (const name of files) {
    if (!name.endsWith(extension)) continue;
    const file = path.join(".dev-emails", name);
    const info = await stat(file);
    if (info.mtimeMs < since) continue;
    const body = await readFile(file, "utf8");
    if (matching(body)) found.push({ name: file, body, mtime: info.mtimeMs });
  }
  return found.sort((a, b) => a.mtime - b.mtime).map(({ name, body }) => ({ name, body }));
}

/** Waits for the transport to have written what we just triggered. */
async function waitForTranscripts(
  since: number,
  extension: string,
  matching: (body: string) => boolean,
  least = 1,
): Promise<Array<{ name: string; body: string }>> {
  let found: Array<{ name: string; body: string }> = [];
  await expect(async () => {
    found = await transcriptsSince(since, extension, matching);
    expect(found.length).toBeGreaterThanOrEqual(least);
  })
    .toPass({ timeout: 20_000 })
    .catch(() => {
      /* Show whatever did land rather than losing the act over it. */
    });
  return found;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The transcript with the HTML part trimmed off — the readable half. */
function plainPart(body: string, maxLines = 34): string {
  const cut = body.split("--- text/html ---")[0].trimEnd();
  const lines = cut.split("\n");
  return lines.length > maxLines ? `${lines.slice(0, maxLines).join("\n")}\n…` : cut;
}

async function showTranscripts(
  page: Page,
  heading: string,
  transcripts: Array<{ name: string; body: string }>,
  ...lines: string[]
): Promise<void> {
  const blocks = transcripts
    .slice(0, 3)
    .map(
      (item) =>
        `<section><h2>${escapeHtml(item.name)}</h2><pre>${escapeHtml(plainPart(item.body))}</pre></section>`,
    )
    .join("");
  await page.setContent(
    `<style>
       :root { color-scheme: dark; }
       body { margin:0; background:#0b0f14; color:#d6e2ef; font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; padding:20px 24px; }
       h1 { font-size:14px; letter-spacing:.08em; text-transform:uppercase; color:#7dd3a0; margin:0 0 4px; }
       p.sub { margin:0 0 16px; color:#7c8ea0; font-size:12px; }
       h2 { font-size:12px; color:#f0b429; margin:14px 0 6px; font-weight:600; }
       pre { margin:0; white-space:pre-wrap; word-break:break-word; background:#111823; border:1px solid #1e293b; border-radius:6px; padding:12px 14px; }
       section + section { margin-top:10px; }
     </style>
     <h1>&gt;&gt; EMAIL (dev transport)</h1>
     <p class="sub">${escapeHtml(heading)} — written to .dev-emails/ by the running app, exactly as sent</p>
     ${blocks || "<pre>(nothing written yet)</pre>"}`,
  );
  await say(page, ...lines);
}

// ---------------------------------------------------------------------------
// Page helpers lifted from the e2e specs
// ---------------------------------------------------------------------------

function card(page: Page, title: string): Locator {
  return page.locator("[data-session-id]").filter({ hasText: title });
}

function trayCard(page: Page, title: string): Locator {
  return page.getByTestId("unscheduled-tray").locator("[data-session-id]").filter({ hasText: title });
}

function taskRegion(page: Page, title: string): Locator {
  return page.getByRole("region", { name: title });
}

/** Picks an option in a shadcn/Radix select by its visible label. */
async function choose(page: Page, trigger: string, option: string): Promise<void> {
  await page.locator(trigger).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

/** Opens a session's time dialog and sets day/room/start/duration
 * (e2e/agenda.spec.ts's helper, unchanged). */
async function schedule(
  page: Page,
  title: string,
  { day, room, start, duration }: { day?: string; room?: string; start?: string; duration?: string },
): Promise<void> {
  await card(page, title).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (day) await choose(page, "#session-day", day);
  if (room) await choose(page, "#session-room", room);
  if (start) await page.locator("#session-start").fill(start);
  if (duration) await choose(page, "#session-duration", duration);
  await dialog.getByRole("button", { name: "Save time" }).click();
  await expect(dialog).toHaveCount(0);
}

/** Day one in the session dialog, without hard-coding a date the seed owns:
 * the first option that looks like a date rather than "no day yet". */
async function chooseFirstDay(page: Page): Promise<void> {
  await page.locator("#session-day").click();
  const options = page.getByRole("option");
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    const label = (await options.nth(index).textContent()) ?? "";
    if (/\d/.test(label)) {
      await options.nth(index).click();
      break;
    }
  }
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Magic-link lines already logged for `email` — so act 6 grabs the new one. */
async function magicLinkCount(email: string): Promise<number> {
  const log = await readFile(".dev-magic-links.log", "utf8").catch(() => "");
  return log.split("\n").filter((line) => line.split("\t")[1] === email).length;
}

async function newestMagicLink(email: string, seenBefore: number): Promise<string> {
  let url = "";
  await expect(async () => {
    const log = await readFile(".dev-magic-links.log", "utf8");
    const lines = log.split("\n").filter((line) => line.split("\t")[1] === email);
    expect(lines.length).toBeGreaterThan(seenBefore);
    url = lines[lines.length - 1].split("\t")[2];
  }).toPass({ timeout: 20_000 });
  return url;
}

// ---------------------------------------------------------------------------

test.describe.serial("Greenroom demo walkthrough", () => {
  test("setup — pre-authenticate the organizer and the reviewer", async ({ page }) => {
    await mkdir(STATE_DIR, { recursive: true });

    // Off camera, per walkthrough.md's "Prep before recording": the magic link
    // is shown live exactly once, in act 6, where a real speaker would use it.
    await signIn(page, "admin@greenroom.dev");
    await page.context().storageState({ path: AVERY_STATE });

    await signIn(page, "dana@greenroom.dev");
    await page.context().storageState({ path: DANA_STATE });
  });

  // -------------------------------------------------------------------------
  test.describe(() => {
    test.use({ storageState: AVERY_STATE });

    test("Act 1 — The call for speakers is a thing you configure", async ({ page }, testInfo) => {
      await startAct(page, 1, "The call for speakers is a thing you configure, not a thing you file a ticket for");

      // --- cold open, over the organizer's queue -----------------------------
      await page.goto(SUBMISSIONS);
      await expect(page.getByRole("heading", { name: "Submissions" })).toBeVisible();
      await sayInto(
        coldOpen,
        page,
        "This is Greenroom — an open-source replacement for Sessionboard.",
        "Everything you're about to see is one app: the call for speakers, the review queue,",
        "the accept that turns a proposal into a session, the speaker's onboarding checklist,",
      );
      await page.mouse.wheel(0, 320);
      await sayInto(
        coldOpen,
        page,
        "the agenda, the emails, the calendar invites, and the public program.",
        "No Airtable base behind it, no Zapier glue,",
        "no spreadsheet anyone has to remember to update.",
      );
      await page.mouse.wheel(0, -320);
      await sayInto(
        coldOpen,
        page,
        "I'm running the AI Engineer Summit 2026 — three days at Moscone West,",
        "with a call for speakers that's open right now.",
        "In the next ten minutes I'll take one talk from nobody has heard of it,",
        "to it's on the public schedule and the speaker has a calendar invite.",
      );

      // --- act 1 proper ------------------------------------------------------
      await say(
        page,
        "Organizers change their CFP form constantly — a new question, a conditional follow-up,",
        "co-speakers on or off. In Sessionboard that's a support conversation.",
        "Here the form is data: questions, conditions, the welcome copy, the confirmation email,",
        "and the public link all live on one screen.",
      );

      await page.goto(FORMS);
      const formRow = page.getByRole("row").filter({ hasText: "Call for Speakers 2026" });
      await point(
        page,
        formRow,
        "One call for speakers. Status: Open. Its public link and its response count, right there.",
      );
      await page.getByRole("link", { name: "Call for Speakers 2026" }).click();
      await expect(page.getByRole("heading", { name: "Call for Speakers 2026" })).toBeVisible();

      const workshopRow = page
        .locator("button[aria-expanded]")
        .filter({ hasText: "Workshop requirements" })
        .first();
      await point(
        page,
        workshopRow,
        "Scroll to Workshop requirements. Note the Conditional badge on the row.",
      );
      await workshopRow.click();
      await expect(page.locator("#workshop_requirements-cond-field")).toBeVisible();
      await point(
        page,
        page.locator("#workshop_requirements-cond-field").locator(".."),
        "When Session format — is — a 90-minute workshop. That's the whole rule.",
        "That question only exists if you pick workshop.",
        "The organizer built that rule in the UI. Nobody deployed anything.",
      );
      await workshopRow.click();

      const coSpeakers = page.getByRole("switch", { name: "Allow co-speakers" });
      await point(
        page,
        coSpeakers,
        "Most conference talks have two people on stage.",
        "Sessionboard treats the second one as an afterthought.",
      );
      await coSpeakers.click();
      await point(
        page,
        coSpeakers,
        "Here they're a first-class part of the proposal, and every email we send goes to both.",
      );

      await page.getByRole("tab", { name: /Welcome/ }).click();
      await point(
        page,
        page.locator("#confirmation-subject"),
        "The confirmation email is the organizer's own words, not ours — subject and body.",
      );
      await point(
        page,
        page.getByText("Available merge fields"),
        "These merge fields are filled in with the real values when the email goes out.",
      );
      await point(
        page,
        page.getByText("Preview", { exact: true }),
        "And a live preview of exactly what a speaker will read.",
      );

      await page.getByRole("tab", { name: /Window/ }).click();
      await point(
        page,
        page.locator("#form-slug"),
        "The public link — slash submit slash ai-engineer-summit-2026.",
      );
      await point(page, page.locator("#opens-at"), "When it opens. When it closes. Same screen.");

      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Form saved")).toBeVisible({ timeout: 15_000 });
      await say(page, "Save. Nothing was deployed. The form just changed.");

      endAct(testInfo);
    });
  });

  // -------------------------------------------------------------------------
  test.describe(() => {
    // Signed out on purpose: this is the public page, from a stranger's browser.
    test("Act 2 — A speaker submits, with no account, and gets a real email", async ({
      page,
    }, testInfo) => {
      await startAct(page, 2, "A speaker submits, with no account, and gets a real email");
      const startedAt = Date.now();

      await page.goto(`/submit/${EVENT}`);
      await expect(page.getByRole("heading", { name: "Call for Speakers 2026" })).toBeVisible();
      await say(
        page,
        "Here's the speaker's side. No login wall, no create-an-account-to-propose-a-talk —",
        "that's the single biggest reason CFP conversion dies.",
      );
      await point(
        page,
        page.getByText("practitioner talks"),
        "We're looking for practitioner talks: things you built, shipped, measured,",
        "and would do differently.",
      );

      await page.getByLabel("Talk title").click();
      await page.getByLabel("Talk title").pressSequentially(TALK, { delay: 22 });
      await page.getByLabel("Abstract").fill(ABSTRACT);
      await say(page, "A title, an abstract — the questions the organizer asked for, in her order.");

      await page.getByLabel("Evals & Reliability").check();
      await point(
        page,
        page.getByLabel("Evals & Reliability"),
        "Tracks are a real question, because the track is what decides who reviews it.",
      );

      await page.getByLabel("Session format").click();
      await page.getByRole("option", { name: "90-minute workshop" }).click();
      const workshopQuestion = page.getByLabel("Workshop requirements");
      await expect(workshopQuestion).toBeVisible();
      await point(
        page,
        workshopQuestion,
        "Pick 90-minute workshop and the Workshop requirements question appears.",
        "That's the conditional rule from thirty seconds ago, doing its job on the public form.",
      );
      await page.getByLabel("Session format").click();
      await page.getByRole("option", { name: "45-minute talk" }).click();
      await expect(workshopQuestion).toHaveCount(0);
      await say(page, "Change it to a 45-minute talk and the question disappears again.");

      await page.getByLabel("Speaker biography").fill(BIO);
      await page.getByLabel("Link to a previous talk").fill("https://www.youtube.com/watch?v=aie-evals");
      await page.getByLabel("I agree to the code of conduct").check();
      await page.getByLabel("Your name").fill("Nadia Farouk");
      await page.getByLabel("Your email").fill(NADIA);

      await page.getByRole("button", { name: "Add a co-speaker" }).click();
      const coSpeaker = page.getByRole("group", { name: "Co-speaker 1" });
      await coSpeaker.getByLabel("Name").fill("Owen Diallo");
      await coSpeaker.getByLabel("Email").fill(OWEN);
      await coSpeaker.getByLabel("Job title (optional)").fill("Staff Engineer");
      await coSpeaker.getByLabel("Company (optional)").fill("Waypoint");
      await point(
        page,
        coSpeaker,
        "And because we switched co-speakers on a minute ago, Nadia can bring Owen with her.",
      );

      await page.getByRole("button", { name: "Submit proposal" }).click();
      await expect(page).toHaveURL(/\/submit\/.+\/thanks\/.+/, { timeout: 30_000 });
      const thanksUrl = new URL(page.url()).pathname;

      await point(
        page,
        page.getByText("Proposal received", { exact: true }),
        "Proposal received — the talk title, and the organizer's own confirmation copy.",
      );
      await point(
        page,
        page.getByText(NADIA),
        "A confirmation email is on its way to nadia.farouk@example.com.",
      );

      const confirmations = await waitForTranscripts(
        startedAt,
        ".txt",
        (body) => body.includes(TALK) && /^X-Greenroom-Log: submission_confirmation/m.test(body),
        2,
      );
      await showTranscripts(
        page,
        "two confirmations — Nadia and Owen",
        confirmations,
        "And there it is. Two emails: one to Nadia, one to Owen.",
        "The subject is the one the organizer wrote on that Welcome & confirmation tab,",
        "with the merge fields already filled in.",
        "That's not a queue I'm promising to drain later. It's gone.",
      );

      await page.goto(thanksUrl);
      await point(
        page,
        page.getByRole("link", { name: /Sign in to edit/ }),
        "She can come back and edit it, from the same email, with no password.",
      );

      endAct(testInfo);
    });
  });

  // -------------------------------------------------------------------------
  test.describe(() => {
    test.use({ storageState: AVERY_STATE });

    test("Act 3 — It's in the queue, and the organizer can ask for a fix", async ({
      page,
    }, testInfo) => {
      await startAct(page, 3, "It's in the queue, and the organizer can ask for a fix without deciding anything");
      const startedAt = Date.now();

      await page.goto(SUBMISSIONS);
      // Grabbed while the whole queue is on screen — act 4 tries this URL as Dana.
      forbiddenUrl =
        (await page.getByRole("link", { name: TOOL_SCHEMAS }).getAttribute("href").catch(() => null)) ??
        "";

      await say(page, "Back in the organizer's seat. Every proposal, one queue, statuses in organizer language.");

      await page.getByLabel("Filter by status").click();
      await page.getByRole("option", { name: "Unreviewed" }).click();
      await point(
        page,
        page.getByText(/of \d+ submissions/),
        "Filter to Unreviewed and the count line updates. The new talk is at the top,",
      );
      await point(
        page,
        page.getByRole("row").filter({ hasText: TALK }),
        "showing Nadia Farouk and Owen Diallo, on the Evals & Reliability track.",
      );

      await page.getByRole("link", { name: TALK }).click();
      await expect(page.getByRole("heading", { name: TALK })).toBeVisible();
      submissionAdminUrl = new URL(page.url()).pathname;

      await point(
        page,
        page.getByText("The proposal"),
        "Every answer exactly as she gave it —",
      );
      await point(
        page,
        page.getByText("Owen Diallo").first(),
        "including the co-speaker row: Owen Diallo, Staff Engineer at Waypoint.",
      );

      await say(
        page,
        "Now the thing every program chair does forty times a CFP and no tool supports.",
        "The abstract is nearly right. I don't want to accept it, I don't want to reject it —",
        "I want to ask for one change, and I want that ask to be an email, not a note to myself.",
      );

      await page.getByRole("button", { name: "Request changes" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await point(
        page,
        dialog.getByText("keeps its current status"),
        "Emails the speaker what to fix, with a link to edit their proposal.",
        "The submission keeps its current status.",
      );
      await dialog.locator("#change-request").fill(CHANGE_REQUEST);
      await dialog.locator("#change-due").fill(isoDaysFromNow(5));
      await say(page, "What needs changing, and a deadline a few days out.");
      await dialog.getByRole("button", { name: "Send request" }).click();
      await expect(page.getByText("Change request sent")).toBeVisible({ timeout: 30_000 });
      await say(page, "Change request sent.");

      const asked = await waitForTranscripts(
        startedAt,
        ".txt",
        (body) => body.includes(TALK) && body.includes(NADIA) && body.includes("need one thing from you"),
      );
      await showTranscripts(
        page,
        "the change request",
        asked,
        "That went out as a real email — subject: a quick change needed on Catching silent…",
        "It carries the deadline, and a link that opens her proposal ready to edit.",
      );

      await page.goto(submissionAdminUrl);
      await point(
        page,
        page.getByText("Unreviewed", { exact: true }).first(),
        "And look at the status: still Unreviewed.",
        "Asking for a fix isn't a decision, so it doesn't pretend to be one.",
      );

      endAct(testInfo);
    });
  });

  // -------------------------------------------------------------------------
  test.describe(() => {
    test.use({ storageState: DANA_STATE });

    test("Act 4 — The right reviewer sees it, and only the right reviewer", async ({
      page,
    }, testInfo) => {
      await startAct(page, 4, "The right reviewer sees it, and only the right reviewer");

      await page.goto(SUBMISSIONS);
      await say(
        page,
        "Dana Okoye reviews Evals & Reliability and AI Engineering.",
        "Marco Silva reviews Agents & Tool Use.",
        "Routing by track is table stakes, and it has to work in both directions.",
      );
      await point(
        page,
        page.getByText("the tracks you review"),
        "The talks proposed in the tracks you review. Open one to record your recommendation.",
      );
      await point(page, page.getByRole("link", { name: TALK }), "The new Evals talk is in her list.");
      await say(
        page,
        "Tool schemas are your real prompt — an Agents & Tool Use talk — is not.",
        "Here's the hard version: paste that talk's URL straight into Dana's browser.",
      );

      if (forbiddenUrl) {
        await page.goto(forbiddenUrl);
        await say(
          page,
          "Not access denied, not greyed out. For Dana, that talk does not exist.",
        );
        await page.goto(SUBMISSIONS);
      }

      await page.getByRole("link", { name: TALK }).click();
      await expect(page.getByRole("heading", { name: TALK })).toBeVisible();
      await page.getByRole("button", { name: "Approve" }).click();
      await page.locator("#review-comment").fill(REVIEW_COMMENT);
      await say(page, "Her recommendation, and why — in her own words.");
      await page.getByRole("button", { name: "Save review" }).click();
      await expect(page.getByText("Review saved")).toBeVisible({ timeout: 20_000 });

      await page.reload();
      await point(
        page,
        page.getByTestId("review-tally"),
        "One review: one approve.",
      );
      await point(
        page,
        page.getByText("An event admin records the final decision"),
        "An event admin records the final decision. Your recommendation is what feeds it.",
        "Dana can't accept it. Accepting creates a session, assigns onboarding tasks,",
        "and emails a promise to a human being — so that's the organizer's signature.",
      );

      endAct(testInfo);
    });
  });

  // -------------------------------------------------------------------------
  test.describe(() => {
    test.use({ storageState: AVERY_STATE });

    test("Act 5 — One click turns a proposal into a session, a checklist, and a promise", async ({
      page,
    }, testInfo) => {
      await startAct(page, 5, "One click turns a proposal into a session, a checklist, and a promise");
      const startedAt = Date.now();

      await page.goto(submissionAdminUrl);
      await point(
        page,
        page.getByText("Reviewer notes"),
        "Back in the organizer's seat, Dana's recommendation is on the page —",
        "her name, an Approve badge, and her comment.",
      );

      await page.locator("#decision-note").fill(DECISION_NOTE);
      await say(page, "A note to the speakers, which is going into the email.");
      await point(
        page,
        page.getByLabel("Email the speakers"),
        "Email the speakers stays ticked.",
      );
      await page.getByRole("button", { name: "Accept", exact: true }).click();

      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await point(
        page,
        confirmDialog,
        "This creates the session and the speakers' onboarding tasks,",
        "and emails everyone on the talk.",
      );
      await confirmDialog.getByRole("button", { name: "Confirm accept" }).click();
      await expect(confirmDialog).toHaveCount(0, { timeout: 60_000 });
      await say(
        page,
        "Session created. Twelve onboarding tasks assigned across two speakers — six each,",
        "automatically, because we accepted a talk with a co-speaker on it. Two emails out.",
        "That's the entire manual handoff between program committee and speaker ops,",
        "the part every conference runs on a spreadsheet and a prayer, collapsed into one button.",
      );

      await page.reload();
      await point(
        page,
        page.getByTestId("decision-summary"),
        "Accepted by Avery Chen, today, with the note to speakers echoed underneath.",
      );
      await point(
        page,
        page.getByTestId("decision-session"),
        "Session created — not yet placed on the agenda.",
      );
      await point(
        page,
        page.getByTestId("decision-tasks"),
        "Twelve onboarding tasks assigned across two speakers.",
        "Note what it does not do: it doesn't guess a room and a time.",
        "An accepted talk is unscheduled until a human puts it somewhere.",
      );

      const accepted = await waitForTranscripts(
        startedAt,
        ".txt",
        (body) => body.includes(TALK) && body.includes("has been accepted"),
      );
      await showTranscripts(
        page,
        "the acceptance email",
        accepted,
        "A note from the review committee — followed by the exact note I typed.",
        "And a Still outstanding list: all six tasks, with their due dates, in the email itself.",
        "The speaker's checklist is in the email, so it works even for the speaker",
        "who never opens the portal.",
      );

      endAct(testInfo);
    });
  });

  // -------------------------------------------------------------------------
  test.describe(() => {
    // Signed out: act 6 opens with the only magic-link sign-in in the demo.
    test("Act 6 — The speaker portal, and the only magic link in this demo", async ({
      page,
    }, testInfo) => {
      await startAct(page, 6, "The speaker portal, and the only magic link in this demo");

      const seen = await magicLinkCount(NADIA);
      await page.goto("/login");
      await point(
        page,
        page.getByText("magic link", { exact: false }).first(),
        "Admins, reviewers, and speakers all sign in with a magic link — no password.",
      );
      await page.getByLabel("Email").pressSequentially(NADIA, { delay: 45 });
      await page.getByRole("button", { name: "Send magic link" }).click();
      await expect(page.getByText("Check", { exact: false })).toBeVisible({ timeout: 20_000 });
      await say(
        page,
        "In production that's a Resend email.",
        "In this demo the dev transport writes it to a file so you can watch it happen.",
      );

      const link = await newestMagicLink(NADIA, seen);
      await page.goto(link);
      await expect(page.getByRole("heading", { name: "Your speaker home" })).toBeVisible({
        timeout: 30_000,
      });
      await say(page, "And she's in. Your speaker home.");

      await point(
        page,
        page.getByText("Your submissions"),
        "Your submissions — her talk, badged Approved.",
      );
      await point(
        page,
        page.getByText("Your sessions"),
        "Your sessions — her session, not yet scheduled. Honest about the state of the world.",
      );
      await point(
        page,
        page.getByText("Your tasks"),
        "Your tasks — all six, created by that one Accept click.",
        "Hotel stay, flight reimbursement, finalize the talk description, bio and photos,",
        "announce participation, invite colleagues with the speaker discount.",
        "These are the six things every conference chases every speaker for.",
        "They exist because the talk was accepted. Nobody created them.",
      );

      const hotel = taskRegion(page, "Hotel stay requirement form");
      await hotel.scrollIntoViewIfNeeded();
      await hotel.getByLabel("Do you need us to book your hotel room?").click();
      await page.getByRole("option", { name: "Yes, book me a room" }).click();
      await point(
        page,
        hotel,
        "Say yes, and two date fields and a room preference appear.",
        "Same conditional-form engine as the CFP. One form system, used everywhere.",
      );
      await hotel.getByLabel("Check-in date (YYYY-MM-DD)").fill("2026-09-22");
      await hotel.getByLabel("Check-out date (YYYY-MM-DD)").fill("2026-09-26");
      await hotel.getByLabel("Room preference").click();
      await page.getByRole("option", { name: "One queen bed" }).click();
      await hotel
        .getByLabel("Anything else about your stay?")
        .fill("Arriving late Tuesday — a quiet floor would be great.");
      await hotel.getByRole("button", { name: "Submit" }).click();
      await expect(hotel).toContainText("Complete", { timeout: 30_000 });
      await point(page, hotel, "Submitted, inline. No navigation, no separate portal. The task flips to Complete.");

      await point(
        page,
        taskRegion(page, "Finalize talk description"),
        "The other task types are just as blunt: this one has Mark as done,",
      );
      await point(
        page,
        taskRegion(page, "Finalize bio & photos"),
        "and this one wants a file.",
      );

      // Cut back to Window A — the organizer's side of the same moment.
      const avery = JSON.parse(await readFile(AVERY_STATE, "utf8")) as {
        cookies: Parameters<BrowserContext["addCookies"]>[0];
      };
      await page.context().clearCookies();
      await page.context().addCookies(avery.cookies);
      await page.goto(SPEAKERS_ADMIN);
      await point(
        page,
        page.getByRole("row").filter({ hasText: "Nadia Farouk" }),
        "And on the organizer's side, that submission is already visible —",
        "Nadia's completion, her overdue count, and her outstanding tasks listed.",
      );
      await point(
        page,
        page.getByRole("table"),
        "The seeded speakers sit anywhere from nothing done to everything done.",
        "This is the screen that replaces the who-still-hasn't-sent-a-headshot spreadsheet.",
      );

      endAct(testInfo);
    });
  });

  // -------------------------------------------------------------------------
  test.describe(() => {
    test.use({ storageState: AVERY_STATE });

    test("Act 7 — The agenda: cause a conflict on purpose, then fix it", async ({
      page,
    }, testInfo) => {
      await startAct(page, 7, "The agenda: cause a conflict on purpose, then fix it");

      await page.goto(AGENDA);
      await expect(page.getByTestId("unscheduled-tray")).toBeVisible();
      await point(
        page,
        page.getByText("Drag sessions from the tray"),
        "Drag sessions from the tray onto a room and time.",
        "Conflicts are flagged, never blocked.",
      );
      await point(
        page,
        page.getByText("No scheduling conflicts"),
        "Top right: no scheduling conflicts. Let's fix that.",
      );
      await point(
        page,
        trayCard(page, TALK),
        "The unscheduled tray holds four cards, including the new talk,",
        "with Nadia Farouk and Owen Diallo on it.",
      );
      await point(
        page,
        card(page, RETRIEVAL),
        "Day 1 already has Priya's talk on Main Stage at ten.",
      );

      // dnd-kit needs a real pointer path (e2e/agenda.spec.ts).
      await page.evaluate(() => window.scrollTo(0, 0));
      const columns = await page.evaluate(() => [
        ...new Set(
          [...document.querySelectorAll<HTMLElement>("[data-slot-id]")].map(
            (el) => el.dataset.slotId!.split("|")[1],
          ),
        ),
      ]);
      // Rooms are listed alphabetically: Community Hall, Main Stage, … — and
      // 10:00 is minute 600 of the day.
      const target = page.locator(`[data-slot-id="slot|${columns[1]}|600"]`);
      const source = await trayCard(page, TALK).boundingBox();
      const drop = await target.boundingBox();

      if (source && drop) {
        await page.mouse.move(source.x + source.width / 2, source.y + 8);
        await page.mouse.down();
        // Past dnd-kit's 5px activation threshold first, then across.
        await page.mouse.move(source.x + source.width / 2 + 20, source.y + 24, { steps: 5 });
        await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 25 });
        // The board auto-scrolls horizontally while you drag across it, which
        // slides the columns out from under a pre-computed coordinate — so
        // re-read the slot and re-aim until the slot itself lights up.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const highlighted = await target
            .evaluate((el) => el.className.includes("bg-accent"))
            .catch(() => false);
          if (highlighted) break;
          const box = await target.boundingBox();
          if (!box) break;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
          await page.waitForTimeout(250);
        }
        await page.mouse.up();
        await page.waitForTimeout(1500);
      }

      // Fallback from walkthrough.md's own cheat sheet. The drag is the beat
      // worth filming, but the point of the act is the *conflict* — so if the
      // card didn't land on top of Priya's talk, put it there with the dialog
      // and carry on.
      if ((await page.getByTestId("conflict-summary").count()) === 0) {
        const stillUnscheduled = (await trayCard(page, TALK).count()) > 0;
        await card(page, TALK).first().click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        if (stillUnscheduled) await chooseFirstDay(page);
        await choose(page, "#session-room", "Main Stage");
        await page.locator("#session-start").fill("10:00");
        await choose(page, "#session-duration", "45 minutes");
        await dialog.getByRole("button", { name: "Save time" }).click();
        await expect(dialog).toHaveCount(0);
      }

      await say(
        page,
        "Straight on top of Priya's talk. Watch what it does not do.",
        "It doesn't refuse the drop. Organizers double-book on purpose all the time",
        "while they're still thinking. It takes the placement, then tells the truth about it.",
      );

      await point(
        page,
        card(page, TALK),
        "Both cards are outlined in red. The new one reads: room double-booked.",
      );
      const summary = page.getByTestId("conflict-summary");
      await point(page, summary, "And top right, the summary button reads one conflict.");
      await summary.click();
      const popover = page.locator('[data-slot="popover-content"]');
      await expect(popover).toBeVisible();
      await point(
        page,
        popover,
        "Catching silent regressions and Retrieval that survives production traffic",
        "are in the same room at the same time — with a link straight to the day it's on.",
      );
      await page.keyboard.press("Escape");

      await page.reload();
      await point(
        page,
        page.getByTestId("conflict-summary"),
        "Reload. The conflict is still there.",
        "A conflict is never a reason to drop your change.",
      );

      await schedule(page, TALK, { room: "Workshop B", start: "13:00", duration: "45 minutes" });
      await expect(page.getByText("No scheduling conflicts")).toBeVisible({ timeout: 20_000 });
      await point(
        page,
        card(page, TALK),
        "Workshop B, one o'clock, forty-five minutes. The red clears,",
        "the card reads 1:00 to 1:45, and the top right is quiet again.",
      );
      await say(
        page,
        "Speaker double-bookings and room double-bookings are hard conflicts.",
        "Two talks from the same track opposite each other is an amber advisory —",
        "flagged, because attendees hate it, but not treated as an error.",
      );

      endAct(testInfo);
    });
  });

  // -------------------------------------------------------------------------
  test.describe(() => {
    test.use({ storageState: AVERY_STATE });

    test("Act 8 — Real email, on a cadence, in the organizer's own words", async ({
      page,
    }, testInfo) => {
      await startAct(page, 8, "Real email, on a cadence, in the organizer's own words");

      await page.goto(COMMS);
      await point(
        page,
        page.getByRole("table").first(),
        "The Log tab is the per-speaker correspondence history.",
        "The acceptance email and the change request I just sent are both in it.",
      );
      await point(
        page,
        page.getByLabel("Filter by speaker"),
        "Filter by speaker, filter by message type.",
      );
      await say(page, "Three things here that conferences actually pay for.");

      // (a) reminders that don't spam ----------------------------------------
      await say(page, "First: task reminders that don't spam.");
      await page.getByRole("button", { name: "Send task digest now" }).click();
      const firstRun = page.getByText(/Sent \d+ email|Nothing to send/);
      await expect(firstRun).toBeVisible({ timeout: 60_000 });
      await say(
        page,
        "Each speaker gets one email a week listing everything still open on",
        "their checklist — not one message per task. The toast reports what it",
        "did and what it deliberately didn't: so many sent, and a reason for",
        "every skip. That's the difference between a cron job you trust",
        "and one you turn off.",
      );

      await page.getByRole("button", { name: "Send task digest now" }).click();
      await expect(page.getByText("Nothing to send")).toBeVisible({ timeout: 60_000 });
      await say(
        page,
        "Press it again: nothing to send.",
        "Everyone was just emailed. Press the button as often as you like;",
        "nobody gets nagged twice.",
      );

      // (b) the wording is yours ---------------------------------------------
      await say(page, "Second: the wording is yours.");
      await page.getByRole("tab", { name: "Templates" }).click();
      await point(
        page,
        page.getByRole("navigation", { name: "Message templates" }),
        "Nine built-in messages, from Submission received to Calendar invitation.",
      );
      await page.getByRole("button", { name: "Weekly task digest" }).click();
      const body = page.locator("textarea[id^='body-']");
      const original = await body.inputValue();

      await body.fill(`${original}\n\n${BAD_TEMPLATE_LINE}`);
      await point(
        page,
        page.getByRole("listitem").filter({ hasText: "no value for" }),
        "See you in session room. It's refused.",
        "The merge field is real — a reminder just can't fill it in.",
      );
      await point(
        page,
        page.getByRole("button", { name: "Save wording" }),
        "So Save wording goes disabled.",
        "It would have arrived as a blank space in someone's inbox.",
        "Nobody re-reads sent mail, so we catch it here.",
      );

      await body.fill(`${original}\n\n${GOOD_TEMPLATE_LINE}`);
      await page.getByRole("button", { name: "Save wording" }).click();
      await expect(page.getByText("Saved “Weekly task digest”")).toBeVisible({
        timeout: 30_000,
      });
      await say(
        page,
        "Replace it with something a reminder can actually fill, and it saves.",
        "An Edited badge appears next to it.",
        "That's this event's wording now — an override, not a fork.",
        "Every other event keeps the default.",
      );

      await page.getByRole("button", { name: "Use Greenroom's wording" }).click();
      await expect(page.getByText("Back to Greenroom's wording")).toBeVisible({ timeout: 30_000 });
      await say(page, "One click back. You can never paint yourself into a corner.");

      // (c) calendar invites that update -------------------------------------
      await say(page, "Third: a calendar invite that updates instead of duplicating.");
      const inviteStart = Date.now();
      await page.getByRole("tab", { name: "Calendar invites" }).click();
      const inviteRow = page.getByRole("listitem").filter({ hasText: TALK });
      await point(
        page,
        inviteRow,
        "The row for the new talk shows the slot I just gave it — Workshop B —",
        "and both speakers.",
      );
      await inviteRow.getByRole("button", { name: "Send invitation" }).click();
      await expect(page.getByText(/Invitation sent to \d+ speakers?/)).toBeVisible({
        timeout: 60_000,
      });
      await say(page, "Invitation sent to two speakers.");

      const invites = await waitForTranscripts(inviteStart, ".ics", (ics) => ics.includes(TALK));
      await showTranscripts(
        page,
        "the attached .ics",
        invites,
        "That's a real calendar invitation: method REQUEST, sequence zero,",
        "a stable UID, and the location — Workshop B, Moscone West, San Francisco.",
        "It lands in Google Calendar and Outlook as an event, not as a text file.",
      );

      const resendStart = Date.now();
      await page.goto(COMMS);
      await page.getByRole("tab", { name: "Calendar invites" }).click();
      const sentRow = page.getByRole("listitem").filter({ hasText: TALK });
      await point(page, sentRow, "Reload: the row now reads invites sent, with a last-sent timestamp.");
      await sentRow.getByRole("button", { name: "Re-send invitation" }).click();
      await expect(page.getByText(/Updated invitation sent/)).toBeVisible({ timeout: 60_000 });
      await say(page, "Updated invitation sent. Their existing calendar entry updates in place.");

      const resent = await waitForTranscripts(resendStart, ".ics", (ics) => ics.includes(TALK));
      await showTranscripts(
        page,
        "the second .ics — same UID, higher sequence",
        resent,
        "Same UID, now sequence one.",
        "Rooms change. When they do, the speaker's existing calendar entry moves —",
        "they don't get a second invite to delete.",
      );

      endAct(testInfo);
    });
  });

  // -------------------------------------------------------------------------
  test.describe(() => {
    // Signed out again: this is what the world sees.
    test.use({ permissions: ["clipboard-read", "clipboard-write"] });

    test("Act 9 — The public program, and the embed", async ({ page }, testInfo) => {
      await startAct(page, 9, "The public program, and the embed");

      await page.goto(PROGRAM);
      await point(
        page,
        page.getByRole("heading", { name: "AI Engineer Summit 2026" }),
        "The public program. Event name, the three-day date range,",
        "Moscone West, San Francisco.",
      );
      await point(
        page,
        page.getByText("Want to speak?"),
        "And a link straight to the call for speakers that's still open.",
      );

      await page.getByRole("link", { name: "Schedule", exact: true }).click();
      await expect(page.getByRole("tab").first()).toBeVisible();
      await point(
        page,
        page.getByRole("article").filter({ hasText: TALK }),
        "Day one: Catching silent regressions before your users do.",
        "One o'clock to a quarter to two, Workshop B, Nadia Farouk and Owen Diallo.",
        "Forty seconds ago that was a card I dragged.",
        "There is no publish step, no export, no second CMS.",
      );

      await page.getByRole("link", { name: "Speakers", exact: true }).click();
      await point(
        page,
        page.getByRole("heading", { name: "Nadia Farouk" }),
        "And she's on the speaker wall.",
      );

      await page.getByRole("link", { name: "Schedule", exact: true }).click();
      await page.getByRole("button", { name: /Embed/ }).click();
      const popover = page.locator('[data-slot="popover-content"]');
      await expect(popover).toBeVisible();
      await point(
        page,
        popover,
        "Embed this page. Paste this into any HTML page to show it there, chrome-less.",
        "One iframe. That's the whole integration.",
      );
      await popover.getByRole("button", { name: "Copy code" }).click();
      await expect(page.getByText("Embed code copied")).toBeVisible({ timeout: 15_000 }).catch(() => {});
      await say(page, "Copy code.");

      await page.goto(EMBED_SCHEDULE);
      await point(
        page,
        page.getByText(TALK),
        "And here's the raw embed page: the same schedule, no navigation, no branding.",
        "Every conference wants the schedule on its own marketing site.",
        "This is the whole integration — one iframe, and it stays live.",
      );

      // --- close -------------------------------------------------------------
      await page.goto(`${PROGRAM}/schedule`);
      await sayInto(
        closing,
        page,
        "One talk, ten minutes: proposed by someone with no account,",
        "routed to the right reviewer and hidden from the wrong one, sent back for a fix,",
        "accepted with feedback that reached the speaker's inbox,",
        "turned into a session and twelve onboarding tasks nobody typed,",
        "scheduled through a conflict and out the other side, invited to the calendar,",
        "and published to a public page you can embed anywhere.",
        "Greenroom is open source, it deploys to Cloudflare Workers,",
        "and the whole data layer sits behind a storage-agnostic repository interface —",
        "so this same product runs on D1, Postgres, or anything else you point it at.",
        "Thanks for watching.",
      );

      endAct(testInfo);
    });
  });

  test.afterAll(async () => {
    await mkdir("demo-recording", { recursive: true });
    await writeFile(
      MANIFEST,
      `${JSON.stringify({ acts, coldOpen, close: closing }, null, 2)}\n`,
      "utf8",
    );
  });
});
