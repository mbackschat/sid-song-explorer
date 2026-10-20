# Mono proof of concept validation

This record owns playback and timeline validation boundaries. [The plan](../PLAN.md) owns current priorities, [the adapter](../architecture/playback-adapter.md) owns engine contracts, and [dual-SID validation](stereo.md) owns stereo evidence. Human acceptance is scoped below; automated checks do not establish physical-device sound or a listening verdict.

## Reproduce

Use Node 24.18.0 from [.node-version](../../.node-version), pnpm 11.20.0, Python 3.10 or newer for documentation checks, and Docker/Python 3.12 or newer when preparing the modified engine:

```sh
pnpm install --frozen-lockfile
pnpm prepare:engine
pnpm prepare:assets
pnpm test
pnpm build
pnpm exec playwright install chrome
# macOS only:
pnpm exec playwright install webkit
pnpm test:browser
python3 scripts/check-docs.py
pnpm dev
```

All browser tests use [the silent-output fixture](../../tests/browser/fixtures.ts): a zero-gain sink after the application analyser and muted native media preserve PCM, timeline and analyser checks without speaker output. Headless WebKit alone does not silence macOS audio. System volume is untouched.

Browser tests serve the production build on `127.0.0.1:4173`; development uses `127.0.0.1:5173`. CI pairs installed Google Chrome with Ubuntu 24.04 and Playwright WebKit with macOS 26. Local macOS runs cover both; other hosts expose Chrome only. Linux WebKit is outside the supported matrix. Screenshots belong in ignored `build/poc/`, failure diagnostics in `test-results/`. Build before testing and do not change source during a run.

Run CPU-heavy unit/engine files serially through `pnpm test`, separately from browser emulation. Focused checks retain a 60-second budget; browser interactions use a 45-second per-test deadline, one worker and a 30-second server-start budget. The opt-in `pnpm test:full` runs complete mono Rambo, stereo Rambo and stereo Bach performances in headless WebKit with a 240-second budget per performance. The approximately 193-second Rambo duration requires a separate endurance check. Node 26.10.0 stalled during local Playwright download/trace finalization while the pinned Node 24.18.0 completed those operations; this is a tooling constraint, not a browser runtime requirement.

## Evidence and remaining review

[Engine bounds and verification](../architecture/playback-adapter.md#bounds-and-verification) own PCM equality, exact seeking, mute and full-form checks. [Source preparation](../integration/poc-sources.md) owns asset hashes, rights and the provisional analysis snapshot. The retained reference WAV is a separate renderer/listening artifact; no PCM identity to it is claimed.

The browser guards cover advancing heard position and nonzero PCM, register observations, held inspection, solo/restore, replay loops, complete-ending seeking, profile mismatch removing authored annotations, device-local file opening, invalid-file feedback and narrow layout. A silent uninterrupted macOS WebKit check on 2026-10-19 reached the mono Rambo declared ending with zero buffer underruns, zero dropped writes and no page errors. This establishes full-duration execution through the audio graph. The historical [mono preview](../../assets/screenshots/mono-poc.png) records the earlier interface.

For a listening review, open the development URL in actual Safari, load Rambo, press Play and compare a phrase against the retained reference player. Try an evidence card, solo/restore, inspection during playback and the ending. Judge whether the linked explanation helps identify what is heard. Actual Safari remote automation requires the user's browser setting; Playwright WebKit does not substitute for real Safari/iPhone or speaker listening.

## Transport and inspection limits

The [transport](../../src/player.ts) schedules 44.1 kHz PCM with a short render-ahead queue. Heard position maps audio-context output timestamps through scheduled media segments, falling back to context time minus reported output latency. Emulated position is separate; this does not measure physical speaker latency.

Playback intent survives transient seeking. Generation checks prevent stale operations from issuing a second RPC or reviving a replaced load; desired mute state is recorded before replay. Prepared seeks use retained PCM/observations, forward misses execute only the missing interval, and evicted positions require replay. Mix changes rebuild and invalidate prepared coverage. Loop re-entry uses the same cache-aware path but restarts Web Audio, so no gapless-loop claim is made. Unknown local files have a ten-minute supported window without an inferred musical ending; declared durations apply only with a compatible clock.

Live history retains at most 6,000 register snapshots and 200,000 ordered writes. Snapshots are sampled from observed writes at roughly 20 ms intervals; the inspector applies retained writes through its cursor. Held inspection copies its data and survives live seeks/mix changes, while tune/profile reload resets it. Evidence cards retain exact annotation ranges with at least four seconds of separately labelled listening context when duration permits. Missing coverage, old epochs and dropped records are explicit. Displayed addresses use each chip's declared SID base; raw cycles/offsets remain available through the adapter. Registers describe programmed settings, not measured envelope amplitudes or recovered instrument identities. [Trace calibration](../architecture/playback-adapter.md#pcm-trace-timing-and-coverage) remains approximate relative to audible sound.

The supported callable PSID/profile subset is defined by [the adapter](../architecture/playback-adapter.md); RSID, ROM-dependent formats, accounts, uploads and composition editing remain excluded.

## Interaction feedback

Normal timeline clicks seek; Shift-click holds inspection while music continues. Hold captures the chosen view and selected data; Follow returns to current playback. Direct timeline/ruler seeks release held inspection, while keyboard transport seeking retains its captured-inspection semantics. Pending feedback names the requested time rather than presenting it as heard time, respects reduced motion, and clears on completion, replacement or failure.

The browser oracles hold a real worker request while checking pending UI, then release it and verify actual completion or injected-failure recovery. They also check held register selection during advancing playback, narrow layout and visible retained dropped-write warnings. Current chart loss and a held inspector's retained loss are disclosed separately.

## Prepared seeking revision

The cache guards compare exact PCM and observations against replay, enforce byte bounds and configuration invalidation, and cover stale-coverage/mute races and fatal-worker recovery. Browser guards seek among prepared positions while requiring the requested state and subsequent playback advancement; cold misses retain the pending target and busy indicator.

Measured on 2026-10-19, prepared Rambo seeks to 3:00, 0:30 and 1:30 completed in approximately 41–80 ms across headless Chrome/macOS WebKit after coverage passed 3:01. These include worker/UI scheduling, not physical speaker latency. The full mono cache retained 20,314,970 typed bytes within 32 MiB; a local cache-only late seek measured 0.141 ms against 6,929 ms replay. [The seeking study](../research/seek-performance.md) owns the performance interpretation and voice-switch tradeoff.

## Completion audit

On 2026-10-19 the user confirmed “it works, I have tested it” in direct response to actual Safari full-ending playback and inspection-usefulness gates. This closes mono POC human acceptance. The response did not identify Safari/macOS versions, a separate reference-render comparison or a voice-feedback verdict. It does not establish gapless switching, iPhone behavior or stereo acceptance.

The standalone handoff uses pinned asset downloads without a sibling checkout. [The trace-coverage guard](../../tests/browser/trace-coverage.spec.ts) verifies that nonzero loss is visible inline and that held warnings survive seeks. The accepted mono POC retains the voice-switch interruption as `VOICE-1`; [the plan](../PLAN.md) owns its disposition.

## CI cold-seek investigation

[The silent fixture](../../tests/browser/fixtures.ts) retains bounded main-page heartbeat and load/mute/seek request/reply timings on failure without logging loaded file bytes. These distinguish page responsiveness from engine completion. Cold-seek stalls and an Emscripten constructor-callback failure were observed on Linux WebKit; their precise internal cause and any shared mechanism were not established. Linux WebKit is outside the supported Safari matrix, so those observations do not establish a supported-platform engine defect or a performance fix.

[The raw browser-engine probe](../../scripts/experiments/browser-engine.mjs) isolates the pinned package on a blank page, bypassing Explorer, bundling and Web Audio. After preparing assets and installing macOS WebKit, run `node scripts/experiments/browser-engine.mjs --output build/browser-engine/result.json`. It checks fresh initialization and long raw renders, retains runtime/input hashes, errors and heartbeat/progress events, and enforces a 60-second total budget with browser termination.

### Correct the supported browser/platform matrix

The supported matrix is Chrome/Ubuntu and WebKit/macOS, as configured by [the Application workflow](../../.github/workflows/app.yml). A local run with tracing disabled or focused tests does not establish that configured CI passes. Verify required jobs for the exact pushed commit before calling it verified; real Safari listening remains separate.

## Voice-change feedback fallback

Voice selection still rebuilds the mix and can interrupt sound. The user accepted explicit spinner/explanation feedback on 2026-10-19 if uninterrupted switching is disproportionate in cost. [The cost decision](../research/seek-performance.md#production-feedback-fallback-and-follow-up) owns the retained architecture tradeoff and final disposition.

[The feedback guard](../../tests/browser/voice-feedback.spec.ts) checks mute/solo/restore indicators, reduced motion, resumed playback, paused-state preservation, error cleanup and reload recovery under the shared worker gate. Only the active feedback region announces preparation. This verifies feedback and cleanup, not real mute latency or uninterrupted audio.

## GitHub Pages and README catalog

[The Application workflow](../../.github/workflows/app.yml) uploads the Chrome build on `main`; deployment requires all supported browser/platform shards. Pull requests and other branches cannot deploy. Branch concurrency prevents an older slow verification from publishing after a newer commit, while an active deployment can finish. Prepared assets include cleared files, their notices and the engine's complete corresponding source; local-build-only material is excluded.

[Catalog guards](../../tests/browser/catalog.spec.ts) check published choices with declared models, advancing PCM, linked stereo files, annotation status and the separate local-build list. After CI succeeds, run `EXPLORER_TEST_URL=https://mbackschat.github.io/sid-song-explorer/ pnpm test:browser tests/browser/catalog.spec.ts` to check deployed worker/WASM/assets using silent fixtures. This establishes deployed sample loading, not human listening.

## Browser test synchronization

An asynchronous operation must remain pending throughout pending-state assertions. [The shared worker gate](../../tests/browser/worker-control.ts) holds one named request until explicit release or injected failure, then restores real execution. Browser contexts dispose of held requests after failure. A fixed worker delay cannot guarantee an observation window.

[The browser policy guard](../../tests/browser-policy.test.ts) rejects fixed-delay synchronization and worker monkey-patching outside that helper while permitting execution budgets. Tests poll observable transport progress rather than incidental displayed seconds. Intentional loop/terminal positions and response-time budgets remain functional assertions. Retries stay disabled.

Review asynchronous tests for visible pending state under held work, completion after real release, and recovery after injected failure. For timing-race corrections, use `pnpm test:browser --grep 'voice changes|seek feedback' --repeat-each=3` with normal tracing in both supported browsers before the complete CI suite. This is a bounded reliability check, not proof that every scheduling failure is impossible. Diagnose failures before repeating; do not conceal them with retries or larger deadlines.

## Centered timeline spike

[Prepared observations](../architecture/playback-adapter.md#prepared-timeline-observations) supply past/upcoming activity without executing the source. [The design](../design/web-player-and-analyser.md#selection-and-retained-history) owns current view and inspection semantics. Cache guards compare observations with continuous `SidSession` rendering and require unchanged subsequent PCM, read cursor, frontier and retained bytes. They cover eviction, partial/empty coverage, write limits, dropped records and floating-point endpoints. Player guards check one in-flight request, throttling and stale replies across seek, mix, load, failure and disposal.

A one-second off-screen request margin prevents the moving right edge outrunning an otherwise prepared response. Frame-sampled guards reproduced 0.273/0.289-second coverage gaps in Chrome/macOS WebKit before the correction and retained at least 0.718 seconds of margin afterward. The user accepted the centered preview and corrected right edge on 2026-10-19 with “Yes, fixed”; no browser/OS version was supplied.

Local cache-read measurements on 2026-10-19 for eleven-second windows at 0, 90 and 180 seconds were 3.197/0.713/1.137 ms, with 3,777/5,179/1,545 writes, 551 sampled frames and 407,941/540,913/201,692 JSON bytes. These exclude worker transport and do not measure JS heap usage. [Dense stereo validation](stereo.md#dense-timeline-observations) owns packet pagination for higher write density.

## Timeline zoom

Scroll density is 16–1,024 pixels per second in factor-of-two steps, default 64. Width changes duration proportionally at fixed density; held zoom/resize center the selected moment without replacing its captured data. Subsecond windows show fractional endpoints. Unit guards independently check width/density arithmetic, limits, unchanged transport and bounded refresh; browser guards traverse all levels and verify narrow layout and held settings.

Variable-span cache reads are compared with continuous writes/registers and subsequent PCM, without source execution or changed storage. On 2026-10-19, 21/30-second reads measured 1.990/0.826 ms and 942,564/1,406,059 JSON bytes, each returning at most 1,001 frames. These local measurements exclude worker round trips and are not heap measurements.

## Unified timeline panel

The proportional scrollbar browses observations without seeking or rendering audio. Its independent geometry oracle uses a 200-second song and 20-second viewport: 10% thumb, 10% offset at viewport start 20, and final viewport start 180. It covers zoom/resize, bounds, oversized views and unknown durations. Continuous-drag guards check prepared coverage every animation frame. Entering browsing requests its five-second margins as soon as any in-flight request finishes, without inheriting the narrower follow view's throttle. Subsequent movement is limited to ten requests per second with one in flight. Replies from an earlier view may improve visible coverage or, when visible coverage is equal, add useful off-screen margin around the current view; configuration-generation checks remain mandatory.

### Seek transition stability

Pending seeks must preserve chart, scrollbar and button geometry, clicked range and accepted same-configuration observations. A held-worker browser oracle checks before/during/after geometry at desktop and 390-pixel widths, including release of a held view. Conditional status content formerly moved the chart 29/38 CSS pixels; fixed allocation and below-chart feedback remove that mechanism. Load, mix, failure and disposal still invalidate observations.

### Clicked-note marker clarification

After a right-side click, the seek marker remains attached to the clicked note while marker and notes scroll toward center at song speed. The ruler labels the seek point; transport, upcoming shading and live inspector continue to report heard playback. At center, the marker returns to live tracking and the viewport catches up with audio. Left-side playback advances naturally against a stationary timeline until center; paused placement stays fixed and Follow centers immediately.

The browser oracle samples the rendered white line from canvas pixels and compares it with the clicked note, independently of UI state. Pixel detection accounts for opacity so nearly transparent antialiasing and composition tints cannot masquerade as the playhead. It checks normal-speed viewport motion, the center handoff and subsequent heard tracking. The user explicitly accepted this behavior on 2026-10-20: “playhead-handoff: it is working, accepted.”

## Whole-song overview

Fit song keeps the full known duration visible through seeks and advancing playback; unknown duration uses stable [Fit timeline](library-picker.md#song-lengths-and-stable-fitting). Overview frames describe actual captured coverage and leave gaps shaded. Exact selected settings still come from detailed observations, never inferred overview values. Hold captures overview and exact selection separately.

[The overview oracle](../../tests/overview.test.ts) generates 220,000 independent writes across 88 seconds: detailed collection stops at its 200,000-write bound, while overview reaches the prepared frontier with at most 1,001 original frames matching continuous replay. On 2026-10-20 the synthetic query measured 1.534 ms and 144,014 JSON bytes, excluding worker transport and heap overhead. Guards also cover gaps, eviction, response ownership, stale replies and no source/cursor/cache mutation. Browser guards check stable whole-song range, exact future inspection and held settings. The user accepted Fit song on 2026-10-20 with “Yes, much better.”

## Late Fit song and held shading corrections

The producer retains sampled history independently of UI queries so first opening Fit after PCM eviction still includes the beginning. The late-Rambo regression reproduced coverage beginning at 49 seconds when heard time was 146.26 seconds; its rendered-pixel oracle requires first-quarter pitch activity. Load/mix replacement resets the archive; same-configuration backward seeks preserve it. [The adapter](../architecture/playback-adapter.md#prepared-timeline-observations) owns the storage contract.

An independent ordered-write replay oracle covers eviction, overlarge source blocks, backward resets and lifecycle invalidation. A synthetic stereo producer advanced through 602 seconds retains 1,920,192 typed bytes and returns at most 1,001 original frames for the supported 600-second range, without source execution or cursor/frontier/audio-cache changes. Held-view shading uses current heard time while chart/settings stay captured; a canvas-fill oracle verifies movement and clearing. The user confirmed both corrections with “Works” on 2026-10-20.

## Timeline and scrollbar time labels

Chart times and Heard position attach to the chart axis; scrollbar labels attach to its own track and describe the whole navigable range. Unknown lengths follow [the length contract](library-picker.md#song-lengths-and-stable-fitting). [Rendered geometry guards](../../tests/browser/timeline-labels.spec.ts) independently compare chart/ruler/track/label bounds, known and unknown endpoints, browsing without seeking and ruler seeking, including 2200-pixel and 390-pixel widths without horizontal overflow.

## Linear timeline through loop boundaries

Playback loop B constrains audio scheduling, not linear song observations. Follow, browsing and Fit retain data beyond B up to song duration/available coverage; a visible boundary explains the return to A without wrapped or synthesized frames. [Player guards](../../tests/player.test.ts) cover Rambo's 2:59.03–3:04.12 ending range and an independent 10–20-second loop, verifying beyond-B coverage, browse/Follow retention, unchanged loop bounds and no transport calls from view changes.

## Loop bracket and handles

The selected range has a violet ruler bracket, A/B labels, draggable handles and dashed lane boundaries without a background fill. Boundaries outside the viewport are hidden and short/edge ranges keep handles separately reachable. Pointer movement previews a fixed-viewport draft; release commits one changed range. Escape, pointer cancellation and lost capture discard it. Arrow keys move 0.1 seconds, Shift moves one second, and repeats commit once on keyup. Replacement bounds/load cancel an edit; a normal loop restart does not.

[Mounted ruler guards](../../tests/timeline-loop.test.ts) cover geometry, clipping, drag offset, commit count, cancellation, keyboard editing, viewport retention, tiny ranges and replacement. [Canvas guards](../../tests/phrase-listening.test.ts) check six voice lanes and filters, white-playhead priority, draft markers and unchanged unheard/unavailable fills. These are component/software oracles; actual Safari pointer/layout behavior was not automated in this correction.

### Selected bounds and playback repetition

Selected endpoints are independent of Loop on: a single endpoint stays visible/draggable, the complete pair adds the bracket, disabling repetition preserves selection, and Clear removes it. Setting A at/beyond B clears B and vice versa. Inactive edits make no audio calls; active edits update playback only on commit. Callback and component guards cover Set A/B, partial pairs, numeric fields, phrase selection and inactive canvas markers.

### Stable ruler height

Once used, marker space remains allocated for the page session, including after Clear and transitions away from staggered handles. This prevents the former 24/44-pixel panel collapse while markers themselves disappear. Initial rendering reserves no marker space until needed. The user accepted the correction with “Nice.” on 2026-10-20.
