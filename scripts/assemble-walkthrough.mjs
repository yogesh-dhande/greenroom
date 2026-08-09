#!/usr/bin/env node
/**
 * Turns the recorded acts into the finished demo video.
 *
 *   npx playwright test --config playwright.demo.config.ts   # records the acts
 *   node scripts/assemble-walkthrough.mjs                    # this script
 *
 * Reads demo-recording/manifest.json (written by e2e/demo-walkthrough.record.ts),
 * normalises each act's .webm clip to an h264 segment, concatenates them in act
 * order into walkthrough/walkthrough.mp4, and writes walkthrough/walkthrough.srt from the narration
 * beats the recording captured.
 *
 * The two-pass shape (normalise -> ffprobe -> concat) is what makes the
 * subtitles land: a cue's absolute time is the sum of the *encoded* durations
 * of every preceding segment, which is only knowable after the transcode.
 * Playwright's webm clips have no reliable container duration of their own.
 *
 * Video only — there is no audio track anywhere in the pipeline; the narration
 * lives in the .srt.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORDING_DIR = path.join(ROOT, "demo-recording");
const MANIFEST = path.join(RECORDING_DIR, "manifest.json");
const SEGMENT_DIR = path.join(RECORDING_DIR, "segments");
const OUT_MP4 = path.join(ROOT, "walkthrough", "walkthrough.mp4");
const OUT_SRT = path.join(ROOT, "walkthrough", "walkthrough.srt");

/** A cue never lingers longer than this, even with dead air after it. */
const MAX_CUE_MS = 5_000;
/** …and never flashes shorter than this, even when beats are stacked. */
const MIN_CUE_MS = 1_200;

// ---------------------------------------------------------------------------

async function main() {
  for (const tool of [FFMPEG, FFPROBE]) {
    if (!existsSync(tool)) throw new Error(`Missing ${tool}. Set FFMPEG/FFPROBE to override.`);
  }
  if (!existsSync(MANIFEST)) {
    throw new Error(
      `No ${path.relative(ROOT, MANIFEST)}. Record the acts first:\n` +
        "  npx playwright test --config playwright.demo.config.ts",
    );
  }

  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const acts = [...manifest.acts].sort((a, b) => a.act - b.act);
  if (acts.length === 0) throw new Error("The manifest has no acts in it.");

  await rm(SEGMENT_DIR, { recursive: true, force: true });
  await mkdir(SEGMENT_DIR, { recursive: true });

  // --- pass 1: normalise each act into a concat-safe segment ---------------
  const segments = [];
  for (const act of acts) {
    const clip = await resolveClip(act);
    const segment = path.join(SEGMENT_DIR, `act-${String(act.act).padStart(2, "0")}.mp4`);
    process.stdout.write(`act ${act.act}: ${path.relative(ROOT, clip)} -> `);
    await encode(clip, segment);
    const durationMs = Math.round((await probeDuration(segment)) * 1000);
    console.log(`${formatClock(durationMs)}`);
    segments.push({ act, segment, durationMs });
  }

  // --- pass 2: concatenate, stream-copying the already-uniform segments ----
  const listFile = path.join(SEGMENT_DIR, "concat.txt");
  await writeFile(
    listFile,
    `${segments.map((s) => `file '${s.segment.replace(/'/g, "'\\''")}'`).join("\n")}\n`,
    "utf8",
  );
  await run(FFMPEG, [
    "-y",
    "-loglevel", "error",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-c", "copy",
    "-movflags", "+faststart",
    OUT_MP4,
  ]);

  // --- subtitles ------------------------------------------------------------
  const totalMs = segments.reduce((sum, s) => sum + s.durationMs, 0);
  const cues = buildCues(segments, manifest, totalMs);
  await writeFile(OUT_SRT, renderSrt(cues), "utf8");

  const finalMs = Math.round((await probeDuration(OUT_MP4)) * 1000);
  console.log(
    `\n${path.relative(ROOT, OUT_MP4)}  ${formatClock(finalMs)}  ` +
      `(${segments.length} clips, sum ${formatClock(totalMs)})`,
  );
  console.log(`${path.relative(ROOT, OUT_SRT)}  ${cues.length} cues`);
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/**
 * Playwright names a test's video `video.webm` in its output dir, but moves it
 * there only once the context closes — so trust the directory over the path the
 * recording predicted, and fall back to whatever .webm is actually in it.
 */
async function resolveClip(act) {
  if (act.clip && existsSync(act.clip)) return act.clip;
  const dir = act.outputDir;
  if (dir && existsSync(dir)) {
    const webm = (await readdir(dir)).filter((name) => name.endsWith(".webm")).sort();
    if (webm.length > 0) return path.join(dir, webm[0]);
  }
  throw new Error(`No clip found for act ${act.act} (${act.title}). Looked in ${dir}`);
}

/**
 * One codec, one frame rate, one pixel format, one SAR across every segment —
 * the concat demuxer can only stream-copy if the segments already agree, and
 * Playwright's webm frame timing varies with how busy the page was.
 */
async function encode(input, output) {
  await run(FFMPEG, [
    "-y",
    "-loglevel", "error",
    "-i", input,
    "-vf",
      "scale=1280:720:force_original_aspect_ratio=decrease," +
      "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-an",
    output,
  ]);
}

async function probeDuration(file) {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe gave no duration for ${file}`);
  return seconds;
}

// ---------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------

/**
 * Absolute cue times = the act's offset in the concatenated video + the beat's
 * offset within its own clip. The cold open and the close were spoken during
 * act 1 and act 9 respectively and carry offsets into those clips, so they
 * anchor to the same bases.
 */
function buildCues(segments, manifest, totalMs) {
  const offsets = new Map();
  let running = 0;
  for (const segment of segments) {
    offsets.set(segment.act.act, running);
    running += segment.durationMs;
  }

  const raw = [];
  for (const segment of segments) {
    const base = offsets.get(segment.act.act);
    for (const line of segment.act.lines ?? []) {
      raw.push({ startMs: base + line.atMs, text: line.text });
    }
  }
  const first = segments[0].act.act;
  const last = segments[segments.length - 1].act.act;
  for (const line of manifest.coldOpen ?? []) {
    raw.push({ startMs: offsets.get(first) + line.atMs, text: line.text });
  }
  for (const line of manifest.close ?? []) {
    raw.push({ startMs: offsets.get(last) + line.atMs, text: line.text });
  }

  raw.sort((a, b) => a.startMs - b.startMs);

  // Keep starts strictly ordered — two beats can share a millisecond, and an
  // SRT with a cue that starts before its predecessor is a broken file.
  let previous = -1;
  for (const cue of raw) {
    if (cue.startMs <= previous) cue.startMs = previous + 1;
    previous = cue.startMs;
  }

  return raw.map((cue, index) => {
    const next = raw[index + 1]?.startMs ?? totalMs;
    let end = Math.min(cue.startMs + MAX_CUE_MS, next);
    if (end - cue.startMs < MIN_CUE_MS) end = cue.startMs + MIN_CUE_MS;
    return { ...cue, endMs: Math.min(end, totalMs) };
  });
}

function renderSrt(cues) {
  return `${cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}\n`,
    )
    .join("\n")}`;
}

function srtTime(ms) {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return (
    `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`
  );
}

function formatClock(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
