#!/usr/bin/env node
/**
 * smoke-deployed.mjs - standalone diagnostic probe for the deployed Greenroom site.
 *
 * Purpose: characterize the intermittent stalls on authenticated routes (/admin, /portal)
 * while public routes (/p/*) stay fast. Every round hits a public control arm regardless of
 * persona availability, so the auth-vs-public contrast is always measurable.
 *
 * Terminal-status mode: an authenticated request that blows the 5s budget is NOT aborted.
 * It is detached and allowed to ride to a 180s ceiling so its terminal outcome is recorded
 * verbatim (524 / 1101 / 1102 / 500 / eventual 200 / client timeout). Meanwhile the public
 * control arm keeps probing, which brackets the outage window.
 *
 * Personas come from Playwright storage-state JSON files. Only the file PATH is ever handed
 * to Playwright and only the filename stem is ever logged - contents are never read here.
 *
 * Usage:
 *   node scripts/smoke-deployed.mjs [--minutes 30] [--auth-dir ../killmysaas-evals/.auth]
 *   node scripts/smoke-deployed.mjs --once
 *
 * No dependencies beyond `playwright` and node builtins. Requires node 20+.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { request } from "playwright";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  baseUrl: "https://greenroom.usespaces.dev",
  authDir: "../killmysaas-evals/.auth",
  event: "ai-engineer-summit-2026",
  minutes: 30,
  worker: "greenroom",
};

// Budgets (ms).
const WARN_MS = 2_000; // slow, but tolerable
const FAIL_MS = 5_000; // budget failure; for authed routes this also triggers terminal capture
const NORMAL_TIMEOUT_MS = 15_000; // per-request ceiling for non-authed arms
const TERMINAL_TIMEOUT_MS = 180_000; // ceiling for a riding authenticated request
const ROUND_MIN_MS = 20_000;
const ROUND_MAX_MS = 30_000;
const IDLE_GAP_MS = 180_000; // one deliberate cold-isolate gap in the middle of the run

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

let parsed;
try {
  parsed = parseArgs({
    options: {
      "auth-dir": { type: "string" },
      "base-url": { type: "string" },
      event: { type: "string" },
      minutes: { type: "string" },
      out: { type: "string" },
      once: { type: "boolean" },
      "no-gap": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
} catch (err) {
  console.error(`argument error: ${err.message}`);
  process.exit(2);
}
const flags = parsed.values;

if (flags.help) {
  console.log(
    [
      "smoke-deployed.mjs - deployed-site stall diagnostic",
      "",
      "  --minutes <n>     total run length in minutes (default 30)",
      "  --once            run a single round, print the summary, exit",
      "  --auth-dir <dir>  storage-state directory (default ../killmysaas-evals/.auth)",
      "  --base-url <url>  target origin (default https://greenroom.usespaces.dev)",
      "  --event <slug>    event slug used in route matrix (default ai-engineer-summit-2026)",
      "  --out <file>      JSONL output path (default scratch/ if gitignored, else os tmpdir)",
      "  --no-gap          skip the 3-minute mid-run idle gap",
      "  -h, --help        this text",
    ].join("\n"),
  );
  process.exit(0);
}

const BASE_URL = (flags["base-url"] ?? DEFAULTS.baseUrl).replace(/\/+$/, "");
const EVENT = flags.event ?? DEFAULTS.event;
const AUTH_DIR = resolve(REPO_ROOT, flags["auth-dir"] ?? DEFAULTS.authDir);
const ONCE = Boolean(flags.once);
const MINUTES = Number(flags.minutes ?? DEFAULTS.minutes);
if (!Number.isFinite(MINUTES) || MINUTES <= 0) {
  console.error(`--minutes must be a positive number (got ${flags.minutes})`);
  process.exit(2);
}
const TOTAL_MS = MINUTES * 60_000;
// Only worth spending 3 minutes idling if the run is long enough to still gather rounds after.
const WANT_GAP = !ONCE && !flags["no-gap"] && TOTAL_MS > IDLE_GAP_MS * 2;

// ---------------------------------------------------------------------------
// Route matrix
// ---------------------------------------------------------------------------

const PUBLIC_ROUTES = [`/p/${EVENT}/schedule`, `/p/${EVENT}/feed.json`];
const ROOT_ROUTES = ["/"]; // calls getSessionUser -> auth-path class even when cookieless
const COOKIELESS_AUTH_ROUTES = ["/admin", "/portal"];

const PERSONA_ROUTES = {
  organizer: ["/admin", `/admin/${EVENT}`, `/admin/${EVENT}/speakers`],
  reviewer: [`/admin/${EVENT}/rounds`],
  speaker: ["/portal"],
};
const FALLBACK_PERSONA_ROUTES = ["/admin", "/portal"];

/** Map a storage-state filename stem to a persona key without reading the file. */
function personaKeyFromStem(stem) {
  const lower = stem.toLowerCase();
  for (const key of Object.keys(PERSONA_ROUTES)) {
    if (lower.includes(key)) return key;
  }
  return null;
}

function discoverPersonas(dir) {
  if (!existsSync(dir)) return { personas: [], reason: "auth dir not found" };
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return { personas: [], reason: `auth dir unreadable: ${err.code ?? err.message}` };
  }
  const personas = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json") && e.name !== "evalconfig.json")
    .map((e) => {
      const stem = basename(e.name, ".json");
      const key = personaKeyFromStem(stem);
      return {
        stem,
        key,
        path: join(dir, e.name), // PATH ONLY - contents are never read by this script
        routes: key ? PERSONA_ROUTES[key] : FALLBACK_PERSONA_ROUTES,
      };
    })
    .sort((a, b) => a.stem.localeCompare(b.stem));
  if (personas.length === 0) return { personas: [], reason: "no *.json storage states in auth dir" };
  return { personas, reason: null };
}

// ---------------------------------------------------------------------------
// Output file
// ---------------------------------------------------------------------------

function isGitIgnored(absPath) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", absPath], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false; // non-zero exit: not ignored, or not a git repo
  }
}

const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");

function resolveOutPath() {
  if (flags.out) {
    const p = resolve(process.cwd(), flags.out);
    mkdirSync(dirname(p), { recursive: true });
    return { path: p, note: "explicit --out" };
  }
  const preferred = join(REPO_ROOT, "scratch", `smoke-${RUN_STAMP}.jsonl`);
  if (isGitIgnored(preferred)) {
    mkdirSync(dirname(preferred), { recursive: true });
    return { path: preferred, note: "scratch/ is gitignored" };
  }
  const fallbackDir = join(tmpdir(), "greenroom-smoke");
  mkdirSync(fallbackDir, { recursive: true });
  return {
    path: join(fallbackDir, `smoke-${RUN_STAMP}.jsonl`),
    note: "scratch/ is NOT gitignored - falling back to os tmpdir",
  };
}

const OUT = resolveOutPath();

function writeRecord(rec) {
  try {
    appendFileSync(OUT.path, `${JSON.stringify(rec)}\n`);
  } catch (err) {
    console.error(`! could not append to ${OUT.path}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  let timer;
  const promise = new Promise((res) => {
    timer = setTimeout(res, ms);
  });
  promise.cancel = () => clearTimeout(timer);
  return promise;
}

let wakeUp = null;
/** Sleep that can be cut short by SIGINT. */
function idle(ms) {
  return new Promise((res) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      wakeUp = null;
      res();
    }
    wakeUp = finish;
  });
}

function jitteredRoundGap() {
  return Math.round(ROUND_MIN_MS + Math.random() * (ROUND_MAX_MS - ROUND_MIN_MS));
}

function budgetOf(ms) {
  if (ms > FAIL_MS) return "fail";
  if (ms > WARN_MS) return "warn";
  return "ok";
}

function clock(d = new Date()) {
  return d.toISOString().slice(11, 19);
}

function humanDuration(ms) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedValues.length);
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, rank - 1))];
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

const RUN_ID = `smoke-${RUN_STAMP}`;
const records = [];
const riding = new Set();
let stopping = false;
let sigintCount = 0;

/**
 * Fire a single request. Never throws. Resolves with the outcome record body.
 * Response headers are only inspected for cf-ray / cf-cache-status (never cookies).
 */
async function fire(client, route, klass, persona, round) {
  const isAuthed = klass.startsWith("authed:");
  const timeoutMs = isAuthed ? TERMINAL_TIMEOUT_MS : NORMAL_TIMEOUT_MS;
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const probeId = `r${round}:${klass}:${route}`;
  try {
    const res = await client.get(route, {
      timeout: timeoutMs,
      maxRedirects: 0, // record the route's own status, not the status of wherever it redirects
      failOnStatusCode: false,
      headers: {
        // Correlation handles for `wrangler tail` / Workers Logs.
        "x-greenroom-smoke": RUN_ID,
        "x-greenroom-smoke-probe": probeId,
      },
    });
    const body = await res.body();
    const headers = res.headers();
    return {
      ts: new Date().toISOString(),
      started_at: startedAtIso,
      run_id: RUN_ID,
      probe_id: probeId,
      round,
      route,
      class: klass,
      persona,
      outcome: "http",
      status: res.status(),
      ms: Date.now() - startedAt,
      bytes: body.length,
      final_url: res.url(),
      cf_ray: headers["cf-ray"] ?? null,
      cf_cache_status: headers["cf-cache-status"] ?? null,
      error: null,
      timeout_ms: timeoutMs,
      terminal_capture: false,
    };
  } catch (err) {
    const message = String(err?.message ?? err).split("\n")[0];
    const timedOut = /timed?\s*out|timeout/i.test(message);
    return {
      ts: new Date().toISOString(),
      started_at: startedAtIso,
      run_id: RUN_ID,
      probe_id: probeId,
      round,
      route,
      class: klass,
      persona,
      outcome: timedOut ? "client_timeout" : "error",
      status: null,
      ms: Date.now() - startedAt,
      bytes: null,
      final_url: null,
      cf_ray: null,
      cf_cache_status: null,
      error: message,
      timeout_ms: timeoutMs,
      terminal_capture: false,
    };
  }
}

function commit(rec) {
  const withBudget = { ...rec, budget: budgetOf(rec.ms) };
  records.push(withBudget);
  writeRecord(withBudget);
  return withBudget;
}

function isFailure(rec) {
  if (rec.outcome !== "http") return true;
  if (rec.status >= 500) return true;
  return rec.ms > FAIL_MS;
}

function describe(rec) {
  const status = rec.outcome === "http" ? rec.status : rec.outcome.toUpperCase();
  return `${rec.class} ${rec.route} -> ${status} ${rec.ms}ms`;
}

/**
 * Run one round. Non-authed arms are awaited to completion (bounded by the 15s ceiling).
 * Authed arms are awaited for at most FAIL_MS; anything still in flight is detached into
 * terminal-status mode so the round - and the public control arm - can keep going.
 */
async function runRound(round, targets, startedAt) {
  const inFlight = targets.map((t) => {
    const promise = fire(t.client, t.route, t.klass, t.persona, round);
    return { ...t, promise, isAuthed: t.klass.startsWith("authed:") };
  });

  const settled = [];
  let newRides = 0;

  await Promise.all(
    inFlight.map(async (probe) => {
      if (!probe.isAuthed) {
        settled.push(commit(await probe.promise));
        return;
      }
      const watchdog = sleep(FAIL_MS);
      const winner = await Promise.race([
        probe.promise.then(() => "settled"),
        watchdog.then(() => "riding"),
      ]);
      watchdog.cancel();
      if (winner === "settled") {
        settled.push(commit(await probe.promise));
        return;
      }
      // TERMINAL-STATUS MODE: let it ride to the 180s ceiling and record what it becomes.
      newRides += 1;
      const ride = { round, route: probe.route, klass: probe.klass, since: Date.now() };
      riding.add(ride);
      console.log(
        `    [terminal-capture] ${probe.klass} ${probe.route} exceeded ${FAIL_MS}ms - riding to ${TERMINAL_TIMEOUT_MS / 1000}s`,
      );
      probe.promise.then((rec) => {
        riding.delete(ride);
        const committed = commit({ ...rec, terminal_capture: true });
        console.log(
          `    [terminal-capture] resolved (from round ${round}) ${describe(committed)}` +
            (committed.error ? ` err="${committed.error}"` : "") +
            (committed.cf_ray ? ` cf-ray=${committed.cf_ray}` : ""),
        );
      });
    }),
  );

  // One-line round summary.
  const counts = { ok: 0, warn: 0, fail: 0, err: 0 };
  for (const rec of settled) {
    if (rec.outcome !== "http") counts.err += 1;
    else counts[rec.budget] += 1;
  }
  const slowest = settled.reduce((a, b) => (a && a.ms >= b.ms ? a : b), null);
  const publicRecs = settled.filter((r) => r.class === "public");
  const authRecs = settled.filter((r) => r.class.startsWith("authed:"));
  const avg = (list) =>
    list.length ? `${Math.round(list.reduce((s, r) => s + r.ms, 0) / list.length)}ms` : "-";

  console.log(
    `#${String(round).padStart(3, "0")} ${clock()} +${humanDuration(Date.now() - startedAt)} | ` +
      `n=${settled.length} ok=${counts.ok} warn=${counts.warn} fail=${counts.fail} err=${counts.err} | ` +
      `pub~${avg(publicRecs)} auth~${avg(authRecs)} | ` +
      `riding=${riding.size} inflight${newRides ? ` (+${newRides} new)` : ""}` +
      (slowest ? ` | slowest ${describe(slowest)}` : ""),
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function summarize() {
  const byClass = new Map();
  for (const rec of records) {
    if (!byClass.has(rec.class)) byClass.set(rec.class, []);
    byClass.get(rec.class).push(rec);
  }

  const nameWidth = Math.max(14, ...[...byClass.keys()].map((k) => k.length)) + 2;
  const rule = "=".repeat(nameWidth + 62);

  console.log("");
  console.log(rule);
  console.log(`RUN SUMMARY  ${RUN_ID}  target=${BASE_URL}`);
  console.log(`requests=${records.length}  log=${OUT.path}`);
  console.log("-".repeat(rule.length));
  console.log(
    `${"class".padEnd(nameWidth)}${"n".padStart(5)}${"p50".padStart(9)}${"p95".padStart(9)}${"max".padStart(9)}` +
      `${"warn".padStart(7)}${"fail".padStart(7)}${"err".padStart(6)}${"5xx".padStart(6)}${"ride".padStart(6)}`,
  );

  for (const klass of [...byClass.keys()].sort()) {
    const list = byClass.get(klass);
    const times = list.map((r) => r.ms).sort((a, b) => a - b);
    const warn = list.filter((r) => r.outcome === "http" && r.budget === "warn").length;
    const fail = list.filter((r) => r.outcome === "http" && r.budget === "fail").length;
    const err = list.filter((r) => r.outcome !== "http").length;
    const s5xx = list.filter((r) => r.outcome === "http" && r.status >= 500).length;
    const rides = list.filter((r) => r.terminal_capture).length;
    console.log(
      `${klass.padEnd(nameWidth)}${String(list.length).padStart(5)}` +
        `${String(percentile(times, 50) ?? "-").padStart(9)}` +
        `${String(percentile(times, 95) ?? "-").padStart(9)}` +
        `${String(times.at(-1) ?? "-").padStart(9)}` +
        `${String(warn).padStart(7)}${String(fail).padStart(7)}${String(err).padStart(6)}` +
        `${String(s5xx).padStart(6)}${String(rides).padStart(6)}`,
    );
  }
  console.log("-".repeat(rule.length));

  // Status-code census - the terminal outcomes are the point of the exercise.
  const census = new Map();
  for (const rec of records) {
    const key = rec.outcome === "http" ? `HTTP ${rec.status}` : rec.outcome;
    census.set(key, (census.get(key) ?? 0) + 1);
  }
  console.log(
    `outcomes: ${[...census.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join("  ")}`,
  );

  const terminals = records.filter((r) => r.terminal_capture);
  if (terminals.length) {
    console.log("");
    console.log(`terminal captures (${terminals.length}) - authed requests past ${FAIL_MS}ms:`);
    for (const t of terminals) {
      console.log(
        `  r${t.round} ${t.class} ${t.route} -> ` +
          (t.outcome === "http" ? `HTTP ${t.status}` : t.outcome) +
          ` after ${t.ms}ms` +
          (t.error ? ` err="${t.error}"` : "") +
          (t.cf_ray ? ` cf-ray=${t.cf_ray}` : ""),
      );
    }
  }

  // Authenticated vs public failure ratio - the headline signal.
  const authed = records.filter((r) => r.class.startsWith("authed:"));
  const publics = records.filter((r) => r.class === "public");
  const authFails = authed.filter(isFailure).length;
  const pubFails = publics.filter(isFailure).length;
  const authRate = authed.length ? authFails / authed.length : null;
  const pubRate = publics.length ? pubFails / publics.length : null;
  const pct = (v) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  let ratio;
  if (authRate === null || pubRate === null) ratio = "n/a (one arm has no samples)";
  else if (pubRate === 0 && authRate === 0) ratio = "1.00 (no failures on either arm)";
  else if (pubRate === 0) ratio = `infinite (public arm had zero failures)`;
  else ratio = (authRate / pubRate).toFixed(2);

  console.log("");
  console.log(
    `authenticated failures ${authFails}/${authed.length} (${pct(authRate)})  |  ` +
      `public failures ${pubFails}/${publics.length} (${pct(pubRate)})  |  auth:public failure ratio = ${ratio}`,
  );
  console.log(`(failure = transport error, HTTP >=500, or >${FAIL_MS}ms)`);
  console.log(rule);

  writeRecord({
    ts: new Date().toISOString(),
    run_id: RUN_ID,
    kind: "summary",
    requests: records.length,
    classes: Object.fromEntries(
      [...byClass.entries()].map(([klass, list]) => {
        const times = list.map((r) => r.ms).sort((a, b) => a - b);
        return [
          klass,
          {
            n: list.length,
            p50: percentile(times, 50),
            p95: percentile(times, 95),
            max: times.at(-1) ?? null,
            errors: list.filter((r) => r.outcome !== "http").length,
            failures: list.filter(isFailure).length,
            terminal_captures: list.filter((r) => r.terminal_capture).length,
          },
        ];
      }),
    ),
    auth_failure_rate: authRate,
    public_failure_rate: pubRate,
    auth_vs_public_failure_ratio: ratio,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { personas, reason } = discoverPersonas(AUTH_DIR);

  console.log("");
  console.log(`greenroom deployed smoke  ${RUN_ID}`);
  console.log(`target      ${BASE_URL}`);
  console.log(`mode        ${ONCE ? "single round (--once)" : `${MINUTES} minute(s)`}`);
  console.log(`jsonl       ${OUT.path}  (${OUT.note})`);
  console.log(`auth dir    ${AUTH_DIR}`);
  if (personas.length) {
    console.log(
      `personas    ${personas.map((p) => `${p.stem}${p.key ? "" : " (unmapped -> default routes)"}`).join(", ")}`,
    );
  } else {
    console.log("");
    console.log("*".repeat(96));
    console.log(`* WARNING: no personas loaded (${reason}).`);
    console.log("* Running PUBLIC-ONLY. The auth-vs-public contrast - the actual signal - will be");
    console.log("* missing. Pass --auth-dir <dir> pointing at Playwright storage-state JSON files.");
    console.log("*".repeat(96));
  }
  console.log("");
  console.log("Run this in another terminal to correlate with server logs during a repro:");
  console.log(`    npx wrangler tail ${DEFAULTS.worker} --format pretty`);
  console.log(`    (probe requests carry header  x-greenroom-smoke: ${RUN_ID})`);
  console.log("");

  // One anonymous context (public + root + cookieless auth arms) plus one per persona.
  const anon = await request.newContext({
    baseURL: BASE_URL,
    userAgent: `greenroom-smoke/1 (${RUN_ID})`,
    extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
  });
  const clients = [{ dispose: () => anon.dispose() }];

  const targets = [
    ...PUBLIC_ROUTES.map((route) => ({ client: anon, route, klass: "public", persona: null })),
    ...ROOT_ROUTES.map((route) => ({ client: anon, route, klass: "root", persona: null })),
    ...COOKIELESS_AUTH_ROUTES.map((route) => ({
      client: anon,
      route,
      klass: "auth-cookieless",
      persona: null,
    })),
  ];

  for (const persona of personas) {
    let ctx;
    try {
      ctx = await request.newContext({
        baseURL: BASE_URL,
        storageState: persona.path, // PATH ONLY - never read or logged
        userAgent: `greenroom-smoke/1 (${RUN_ID}; ${persona.stem})`,
        extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
      });
    } catch (err) {
      console.error(
        `! persona ${persona.stem}: could not create request context (${String(err?.message ?? err).split("\n")[0]}) - skipping`,
      );
      continue;
    }
    clients.push({ dispose: () => ctx.dispose() });
    for (const route of persona.routes) {
      targets.push({ client: ctx, route, klass: `authed:${persona.stem}`, persona: persona.stem });
    }
  }

  const classCounts = targets.reduce((acc, t) => {
    acc[t.klass] = (acc[t.klass] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `route matrix (${targets.length} requests/round): ${Object.entries(classCounts)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ")}`,
  );
  console.log("");

  const startedAt = Date.now();
  const endAt = startedAt + TOTAL_MS;

  writeRecord({
    ts: new Date().toISOString(),
    run_id: RUN_ID,
    kind: "meta",
    base_url: BASE_URL,
    event: EVENT,
    minutes: ONCE ? null : MINUTES,
    once: ONCE,
    auth_dir: AUTH_DIR,
    personas: personas.map((p) => ({ stem: p.stem, key: p.key, routes: p.routes })),
    budgets: {
      warn_ms: WARN_MS,
      fail_ms: FAIL_MS,
      normal_timeout_ms: NORMAL_TIMEOUT_MS,
      terminal_timeout_ms: TERMINAL_TIMEOUT_MS,
    },
    targets: targets.map((t) => ({ route: t.route, class: t.klass })),
  });

  process.on("SIGINT", () => {
    sigintCount += 1;
    stopping = true;
    if (sigintCount === 1) {
      console.log("\n^C - finishing up (press Ctrl-C again to bail immediately)");
      if (wakeUp) wakeUp();
    } else {
      console.log("\n^C^C - bailing now");
      summarize();
      process.exit(130);
    }
  });

  let round = 0;
  let gapDone = false;

  while (!stopping) {
    round += 1;
    await runRound(round, targets, startedAt);
    if (ONCE || stopping) break;
    if (Date.now() >= endAt) break;

    // One deliberate idle gap in the middle of the run: a cold-isolate probe.
    if (WANT_GAP && !gapDone && Date.now() - startedAt >= TOTAL_MS / 2) {
      gapDone = true;
      const gapStart = Date.now();
      console.log(
        `--- IDLE GAP: sleeping ${IDLE_GAP_MS / 1000}s (cold-isolate probe). Next round is a cold hit. ---`,
      );
      writeRecord({
        ts: new Date().toISOString(),
        run_id: RUN_ID,
        kind: "idle_gap",
        phase: "start",
        after_round: round,
        planned_ms: IDLE_GAP_MS,
      });
      await idle(IDLE_GAP_MS);
      writeRecord({
        ts: new Date().toISOString(),
        run_id: RUN_ID,
        kind: "idle_gap",
        phase: "end",
        after_round: round,
        actual_ms: Date.now() - gapStart,
      });
      console.log(`--- IDLE GAP over (${humanDuration(Date.now() - gapStart)}); resuming COLD ---`);
      continue;
    }

    const gap = jitteredRoundGap();
    const remaining = endAt - Date.now();
    if (remaining <= 0) break;
    await idle(Math.min(gap, remaining));
  }

  // Give any riding requests their chance to reach a terminal status.
  if (riding.size > 0) {
    const waitStart = Date.now();
    console.log(
      `waiting for ${riding.size} terminal capture(s) to resolve (up to ${TERMINAL_TIMEOUT_MS / 1000}s)...`,
    );
    while (riding.size > 0 && sigintCount < 2 && Date.now() - waitStart < TERMINAL_TIMEOUT_MS + 5_000) {
      await sleep(500);
    }
  }

  for (const c of clients) {
    try {
      await c.dispose();
    } catch {
      /* context already gone */
    }
  }

  summarize();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`fatal: ${err?.stack ?? err}`);
    if (records.length) summarize();
    process.exit(1);
  },
);
