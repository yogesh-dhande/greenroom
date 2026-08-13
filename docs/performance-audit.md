# Performance audit — 2026-08-10

## Conclusion

Greenroom is already reasonably fast on the current `main` build (`ec4c5fb`). In a local
production-mode Cloudflare preview, warm full-page loads for the core flows completed in
roughly 145–195 ms. There is no evidence of a general performance problem and no case for a
broad rewrite or cache layer.

The highest-confidence improvement is to stop automatic viewport prefetching from loading
every visible table row and every admin-sidebar destination. The other opportunities are
smaller and should be implemented only with the measurement gates below.

## Method

- Measured the current local commit in an OpenNext production preview backed by local D1 and
  the normal isolated E2E seed. This avoids measuring an older deployed revision.
- Used seven warm, real-browser full navigations per route. Values below are browser wall time
  from navigation start through `load`, not server-only timings.
- Inspected production-preview requests, page data dependencies, and the built client-reference
  manifests.
- Local D1 has no real network distance. These numbers are a repeatable comparison baseline,
  not a substitute for deployed p75/p95 telemetry.
- The **after** values below are acceptance targets. They must be replaced with observed results
  after each change; no unimplemented result is presented as measured.

## Current baseline

| Flow | Median | Slowest of 7 | Initial JS (gzip) |
| --- | ---: | ---: | ---: |
| Admin overview | 155 ms | 169 ms | 85.7 KB |
| Submissions | 168 ms | 217 ms | 78.3 KB |
| Speakers | 170 ms | 190 ms | 159.2 KB |
| Agenda | 193 ms | 214 ms | 106.3 KB |
| Communications | 169 ms | 199 ms | 99.0 KB |
| Directory | 173 ms | 213 ms | 170.8 KB |
| CFP editor | 161 ms | 392 ms | 157.8 KB |
| Public schedule | 144 ms | 174 ms | 72.1 KB |

The one CFP outlier did not repeat. Three initial font files total about 60 KB, and uploaded
files already receive a one-year immutable cache header. Neither currently warrants work.

## Ranked opportunities

### 1. Suppress viewport prefetch for dense admin links — high impact, high confidence

**Evidence.** Next.js production prefetching loaded all visible destinations automatically.
Opening Overview requested about 13 admin/public routes in the background. Opening Submissions
requested the sidebar, the new-submission route, and almost every one of the 17 visible detail
routes—roughly 30 background route requests. Speakers and Directory show the same row-count
scaling. This consumes Worker/D1 capacity without making an explicitly chosen destination
meaningfully faster.

**Proposed change.** Set `prefetch={false}` on dense row links. Make sidebar links hover/focus
intent-prefetched, preserving fast intentional navigation without prefetching the entire admin
surface. Add a shared pending style only if a deployed navigation measurement shows that it is
needed. This follows the [Next.js prefetching guidance](https://nextjs.org/docs/app/guides/prefetching)
for large link lists.

| Metric | Before, observed | After, required |
| --- | ---: | ---: |
| Overview background route fetches on load | about 13 | 0 viewport-triggered fetches; at most 1 intent-prefetch |
| Submissions background route fetches, 17-row seed | about 30 | 0 row-detail viewport prefetches |
| Intentional destination load | route baseline above | p95 no more than 100 ms worse; visible pending state within 100 ms if needed |

This is the only optimization recommended for immediate implementation because it prevents a
real scale-dependent request storm while keeping the current architecture intact.

### 2. Keep validation libraries out of closed admin dialogs — medium impact, high confidence

**Evidence.** A Zod client chunk is 63.1 KB gzip and is present in the initial Speakers and
Directory payloads because closed add/save dialogs import Zod and the form resolver eagerly.
The current pages are still fast, so this is a transfer/parse cleanup rather than a latency bug.

**Proposed change.** Lazy-load dialog form contents on first open, or use lightweight client
validation while retaining authoritative Zod validation on the server. Do not weaken server
validation to hit a bundle target.

| Metric | Before, observed | After, required |
| --- | ---: | ---: |
| Speakers initial JS | 159.2 KB gzip | no more than 105 KB gzip |
| Directory initial JS | 170.8 KB gzip | no more than 115 KB gzip |
| First dialog open | not separately measured | p95 under 250 ms locally; form behavior unchanged |

Implement after item 1 only if bundle size matters on representative mobile/network profiles.
The CFP editor legitimately uses schema-driven validation and should not be changed just to
remove this chunk.

### 3. Reuse already-loaded communications data — medium impact, medium confidence

**Evidence.** Communications loads several independent repository groups in sequential waves.
It then calls `previewTaskDigestCount`, which rereads tasks, task assignments, speaker state,
and digest logs that substantially overlap data already loaded for the page. Development-mode
application work was about 301–320 ms; the production-preview median was already 169 ms.

**Proposed change.** Extract a pure digest-eligibility helper over the already-loaded data and
overlap independent reads. Keep all reads through the storage-agnostic repositories.

| Metric | Before, observed | After, required |
| --- | ---: | ---: |
| Production-preview full navigation | 169 ms median / 199 ms max of 7 | median at or below 140 ms; no p95 regression |
| Development application work | about 301–320 ms | at or below 220 ms |
| Repeated repository reads | assignments/tasks/speaker state reread | no repeated reads for digest preview |

Because the production-mode route is already under 200 ms, instrument the repository calls and
rerun the benchmark before committing to this refactor.

### 4. Fold the program publish plan into the overview load — low-to-medium impact, high confidence

**Evidence.** The overview already loads sessions, then `ProgramPublishCard` calls a server
action after mount to load the publish plan. That adds one POST and another data read on every
production overview visit, and the held-back status can appear after the rest of the card.

**Proposed change.** Compute `planProgramPublish(sessions)` during the server render and pass it
as initial card data. At the same time, start independent overview reads concurrently. Do not
add a cache.

| Metric | Before, observed | After, required |
| --- | ---: | ---: |
| Overview requests | 1 GET + 1 post-render POST | 1 GET; no initial POST |
| Overview production-preview load | 155 ms median | at or below 120 ms median, with no p95 regression |
| Publish-plan display | populated after hydration | present in initial render |

This is a clean simplification but not urgent: the page already loads quickly.

### 5. Reuse agenda session/roster reads — low-to-medium impact, medium confidence

**Evidence.** Agenda loads sessions and session-speaker links directly, then
`loadSpeakerRoster` loads overlapping session and speaker-assignment data again. It was the
slowest measured route, but only at 193 ms median.

**Proposed change.** Give the roster assembler preloaded data (or create a page-data assembler)
and overlap revision reads with roster work.

| Metric | Before, observed | After, required |
| --- | ---: | ---: |
| Agenda production-preview load | 193 ms median / 214 ms max of 7 | at or below 155 ms median; no p95 regression |
| Duplicate data reads | sessions and session-speaker data overlap | remove both overlapping reads |

Do this opportunistically when the agenda/roster code is next changed, rather than as a standalone
performance project.

### 6. Add headshot thumbnails only if real-user measurements justify it — potentially high impact, low current evidence

**Evidence.** Public speaker cards render original uploaded images. Uploads may be as large as
10 MB, so a gallery of real high-resolution headshots could dominate page weight even though
the seeded fixture does not demonstrate that problem. Immutable browser caching is already
correct.

**Proposed change.** First capture public-gallery transfer size and LCP for a representative
production event. If images dominate, generate thumbnails on upload or use Cloudflare image
resizing, add explicit dimensions, and preserve originals for downloads.

| Metric | Before | After, required if implemented |
| --- | ---: | ---: |
| Gallery image transfer | not yet representative; measure production p75/p95 | no more than 100 KB per thumbnail |
| Mobile gallery LCP | not yet measured | at or below 2.5 s at p75 |
| Layout shift from headshots | not yet measured | CLS at or below 0.1 |

This should not be implemented from the synthetic seed alone.

## Recommended sequence

1. Implement and measure the prefetch policy.
2. Establish deployed p75/p95 navigation, LCP, and image-transfer telemetry on the revision that
   includes the latest fixes.
3. Lazy-load the validation-heavy dialogs only if mobile bundle measurements support it.
4. Treat the communications, overview, and agenda data-loading changes as small, independently
   measured refactors; revert any that do not meet their acceptance target.
5. Leave pagination/virtualization, a new cache layer, font work, and broad architectural changes
   alone until production scale or telemetry demonstrates a problem.
