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

Starting an empty audio queue prepares the existing 250 ms scheduling reserve in one worker request before anchoring the first source to the audio clock. Initial playback and seek restarts therefore have no expired deadline before PCM exists. [Scheduling guards](../../tests/player-audio.test.ts) independently advance worker and audio clocks, verify contiguous initial/refill frames, and require genuine later starvation to increment the underrun counter. The reserve is unchanged; stalls longer than available queued audio can still interrupt playback. Paused-interaction tests compare the counter before and after the interaction rather than attributing earlier playback interruptions to it.

Live history retains at most 6,000 register snapshots and 200,000 ordered writes. Snapshots are sampled from observed writes at roughly 20 ms intervals; the inspector applies retained writes through its cursor. Held inspection copies its data and survives live seeks/mix changes, while tune/profile reload resets it. Evidence cards retain exact annotation ranges with at least four seconds of separately labelled listening context when duration permits. Missing coverage, old epochs and dropped records are explicit. Displayed addresses use each chip's declared SID base; raw cycles/offsets remain available through the adapter. Registers describe programmed settings, not measured envelope amplitudes or recovered instrument identities. [Trace calibration](../architecture/playback-adapter.md#pcm-trace-timing-and-coverage) remains approximate relative to audible sound.

The inspector uses a single-line **Following playback** or **Inspecting time** label. Its adjacent information tip reveals the full explanation on hover, keyboard focus or tap without moving controls; Escape or clicking outside dismisses it. Observation ranges and epochs appear there only in Diagnosis mode. The [tip guard](../../tests/browser/inspector-tip.spec.ts) covers those interactions and unchanged playback.

Voice registers and shared-filter settings start collapsed in separate native disclosures. Voice selection and mixer controls remain visible, and hidden register values continue updating. The [inspector-details guard](../../tests/browser/inspector-details.spec.ts) checks keyboard expansion, unchanged playback and responsive layout; it also keeps Reload settings beside the settings it applies, with Load sample in the toolbar for a new selection. Expanded settings use separate labelled rows, including each filter mode, so changing register values preserve the position of ordered writes and Audio output. The [filter-layout guard](../../tests/browser/filter-layout.spec.ts) exercises minimum/maximum settings through real-engine seeks at desktop, intermediate and narrow widths; this establishes layout behavior, not a new Safari listening verdict.

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

Mute, solo, Full mix and per-chip switches live in Sound inspector. Chip switches preserve individual voice mute preferences; Full mix and tune loading reset both layers. The [mix-state guards](../../tests/voice-mix.test.ts) cover effective masks and solo semantics, while the [inspector mixer guard](../../tests/browser/inspector-mixer.spec.ts) checks placement, pending-state locking, chip restoration and mono replacement. Voice changes that alter the effective mask still rebuild the mix and can interrupt sound. The user accepted explicit spinner/explanation feedback on 2026-10-19 if uninterrupted switching is disproportionate in cost. [The cost decision](../research/seek-performance.md#production-feedback-fallback-and-follow-up) owns the retained architecture tradeoff and final disposition.

[The feedback guard](../../tests/browser/voice-feedback.spec.ts) checks mute/solo/restore indicators, reduced motion, resumed playback, paused-state preservation, error cleanup and reload recovery under the shared worker gate. Only the active feedback region announces preparation. This verifies feedback and cleanup, not real mute latency or uninterrupted audio.

## GitHub Pages and README catalog

[The Application workflow](../../.github/workflows/app.yml) publishes the sealed candidate on `main` only after software and documentation checks on Linux and the small Chrome/Linux and WebKit/macOS browser selections pass. The publication job verifies both browser receipts and the candidate, then uploads and deploys those same distribution bytes to Pages. Pull requests and other branches cannot deploy. Prepared assets include cleared files, their notices and the engine's complete corresponding source; local-build-only material is excluded.

[Catalog guards](../../tests/browser/catalog.spec.ts) check published choices with declared models, advancing PCM, linked stereo files, annotation status and the separate local-build list. After CI succeeds, run `EXPLORER_TEST_URL=https://mbackschat.github.io/sid-song-explorer/ pnpm test:browser tests/browser/catalog.spec.ts` to check deployed worker/WASM/assets using silent fixtures. This establishes deployed sample loading, not human listening.

## Release validation

Run `pnpm release:check` before publishing a clean committed application candidate. The [preflight entry point](../../scripts/release-check.ts) prepares verified assets, builds, runs the standard unit suite and selected POC browser checks, checks documentation and reconciles native browser inventories with executed results. Failed prerequisites stop dependent work; independent checks finish sequentially and retain every failure before the command returns failure. Use the pinned Node/pnpm versions and installed Chrome/macOS WebKit. Local preflight requires macOS; its Chrome result does not establish Linux Chrome behavior. CI separately verifies the exact commit on the supported browser/platform pairings.

CI uses one Linux job for documentation, asset preparation, the build and software tests, followed by the two browser jobs and publication. The verified engine output is cached by its build inputs without fallback keys; asset preparation still checks provenance, runtime hashes and the passing engine verification receipt. Changes to engine inputs rebuild it. New pushes cancel superseded runs. There is no duplicate macOS software suite or separate documentation workflow. Cold engine builds and hosted-runner queues can still dominate elapsed time.

Release browser scope is deliberately small. Chrome runs existing scenarios tagged `@poc`, covering core playback and looping, local opening, timeline navigation, stereo inspection/output and library browsing. WebKit runs `@webkit-compat` scenarios for the browser-sensitive AudioContext/PCM lifecycle, independent stereo analyser channels and device-local file loading. These selections live beside the tests and are applied by [Playwright configuration](../../playwright.config.ts) only during release checks. Broader regressions remain available through `pnpm test:browser <spec> --project chrome --grep '<scenario>'` (or `--project webkit` for relevant compatibility changes); an explicit `pnpm test:browser` still runs the full suite. Do not expand routine publication checks to duplicate all interaction tests across browsers.

The [artifact contract](../../scripts/release-artifact.ts) binds the commit to an exact SHA-256 inventory of `dist/` and matching `public/generated/` fixtures. Missing, extra or altered files, mismatched fixture copies and stale commits fail verification. CI builds once and distributes that candidate to browser consumers and publication. [Release browser setup](../../scripts/release-browser-setup.ts) owns a fresh production preview on port 4175, verifies its served bytes and rejects reused servers or hosted/capture/endurance overrides. The ordinary preview and explicitly requested hosted smoke checks retain their existing behavior.

The [release reporter](../../scripts/release-browser-reporter.ts) records native discovered IDs, each executed result, declared skips and the actual executing browser versions. Missing results, duplicate attempts, unexpected skips, retries and expected-failure masking fail validation. The coverage gate reconciles the complete native inventory of each selected release scope and verifies commit, artifact and platform identity; it does not claim the unselected regression suite passed. Full-duration performances in [the endurance suite](../../tests/browser/full-song.spec.ts) remain opt-in. Do not maintain a second handwritten test catalog.

[Shared release settings](../../scripts/release-settings.ts) own the partition counts and browser deadline. Unit partitions run serially with a 60-second budget each; browser scenarios retain 45-second deadlines, one worker and a 170-second native deadline for each browser's selected scope. Local preflight runs the two browsers sequentially; CI runs one job per browser. CI wrappers additionally allow discovery, artifact verification and shutdown; they do not increase individual test budgets.

Receipts, command output and retained traces belong in ignored `build/release/` and `test-results/`, or CI artifacts. Clean-candidate identity is checked before and after execution. Any source change invalidates its release receipt; rerun relevant development checks and the complete candidate preflight before publication. A successful push is not validation: required CI results must pass for that exact commit. Runtime or musical acceptance still requires its separately scoped browser/listening evidence.

Acquisition failures remain distinct from test failures. Catalog and engine preparation retain their size/hash/provenance checks; browser installation has its own bounded step and retained log. Failed setup blocks downstream execution and publication. Diagnose a transport failure before explicitly rerunning the failed setup job; do not retry assertion failures automatically, accept wrong hashes, introduce a replacement installer or add speculative caches. Test retries stay disabled.

## Browser test synchronization

An asynchronous operation must remain pending throughout pending-state assertions. [The shared worker gate](../../tests/browser/worker-control.ts) holds one named request until explicit release or injected failure, then restores real execution. Browser contexts dispose of held requests after failure. A fixed worker delay cannot guarantee an observation window.

[The browser policy guard](../../tests/browser-policy.test.ts) rejects fixed-delay synchronization and worker monkey-patching outside that helper while permitting execution budgets. Tests poll observable transport progress rather than incidental displayed seconds. Compare a held view with its frozen cursor and a following view with its current playhead; read advancing values in one evaluation so command latency cannot change their relationship. Intentional loop/terminal positions and response-time budgets remain functional assertions. Test retries stay disabled; source guards complement semantic review rather than proving temporal correctness.

Review asynchronous tests for visible pending state under held work, completion after real release, and recovery after injected failure. For timing-race corrections, use `pnpm test:browser --grep 'voice changes|seek feedback' --repeat-each=3` with normal tracing in both supported browsers before the complete CI suite. This is a bounded reliability check, not proof that every scheduling failure is impossible. Diagnose failures before repeating; do not conceal them with retries or larger deadlines.

## Centered timeline spike

[Prepared observations](../architecture/playback-adapter.md#prepared-timeline-observations) supply past/upcoming activity without executing the source. [The design](../design/web-player-and-analyser.md#selection-and-retained-history) owns current view and inspection semantics. Cache guards compare observations with continuous `SidSession` rendering and require unchanged subsequent PCM, read cursor, frontier and retained bytes. They cover eviction, partial/empty coverage, write limits, dropped records and floating-point endpoints. Player guards check one in-flight request, throttling and stale replies across seek, mix, load, failure and disposal.

A one-second off-screen request margin covers movement between refreshes. Advancing playback reuses immutable same-configuration observations and requests only the missing right-hand portion, avoiding repeated transfer of dense visible history. Reuse retains an exact register baseline before the moving left edge and its ordered writes; pagination, frame/write limits, generation cancellation and honest unavailable coverage still apply. Browsing and incompatible ranges use fresh reads. [Window guards](../../tests/observation-window.test.ts) compare exact seam inspection with ordered source writes; [player guards](../../tests/player.test.ts) reproduce margin exhaustion with delayed full-window pagination and require continued coverage with incremental reads. The user accepted the centered preview and corrected right edge on 2026-10-19 with “Yes, fixed”; no browser/OS version was supplied.

Local cache-read measurements on 2026-10-19 for eleven-second windows at 0, 90 and 180 seconds were 3.197/0.713/1.137 ms, with 3,777/5,179/1,545 writes, 551 sampled frames and 407,941/540,913/201,692 JSON bytes. These exclude worker transport and do not measure JS heap usage. [Dense stereo validation](stereo.md#dense-timeline-observations) owns packet pagination for higher write density.

## Timeline zoom

Scroll density is 16–1,024 pixels per second in factor-of-two steps, default 64. Width changes duration proportionally at fixed density; held zoom/resize center the selected moment without replacing its captured data. Subsecond windows show fractional endpoints. Unit guards independently check width/density arithmetic, limits, unchanged transport and bounded refresh; browser guards traverse all levels and verify narrow layout and held settings.

Variable-span cache reads are compared with continuous writes/registers and subsequent PCM, without source execution or changed storage. On 2026-10-19, 21/30-second reads measured 1.990/0.826 ms and 942,564/1,406,059 JSON bytes, each returning at most 1,001 frames. These local measurements exclude worker round trips and are not heap measurements.

## Unified timeline panel

The proportional scrollbar browses observations without seeking or rendering audio. Its independent geometry oracle uses a 200-second song and 20-second viewport: 10% thumb, 10% offset at viewport start 20, and final viewport start 180. It covers zoom/resize, bounds, oversized views and unknown durations. Continuous-drag guards check prepared coverage every animation frame. Entering browsing requests its five-second margins as soon as any in-flight request finishes, without inheriting the narrower follow view's throttle. Subsequent movement is limited to ten requests per second with one in flight. Replies from an earlier view may improve visible coverage or, when visible coverage is equal, add useful off-screen margin around the current view; configuration-generation checks remain mandatory.

### Seek transition stability

Pending seeks must preserve chart, scrollbar and button geometry, clicked range and accepted same-configuration observations. A held-worker browser oracle checks before/during/after geometry at desktop and 390-pixel widths, including release of a held view. Conditional status content formerly moved the chart 29/38 CSS pixels; fixed allocation and below-chart feedback remove that mechanism. Load, mix, failure and disposal still invalidate observations.

### Diagnosis mode

**Diagnosis mode** is a subdued, keyboard-accessible switch beside Help & details, off on page load. It reveals the past/upcoming window caption, observation/preparation ranges, audio queue depth, PCM rate/channel count and buffer underruns. Toggling it changes presentation only; the values keep updating while hidden. Zoom scale, loading, seeking, playback errors and incomplete-trace warnings remain visible independently. The [diagnostics guard](../../tests/browser/diagnostics.spec.ts) checks default visibility, keyboard toggling, unchanged playback/chart position, visible loading/failure feedback and narrow layout; [trace coverage](../../tests/browser/trace-coverage.spec.ts) guards incomplete-data warnings independently.

### Stable preview-to-playback curves

Detailed timeline traces use an absolute 882-PCM-frame grid at 44.1 kHz (20 ms), with register state sampled immediately before each tick. Upcoming observations and scheduled history share this rule. The plotted curve is reconstructed from the observation baseline and ordered writes on a viewport-sized grid; packet-edge snapshots remain inspection baselines rather than extra plotted events. Wider views thin by absolute tick multiples, so moving a window or replacing preview with played history cannot shift the sample phase. Coarse Fit overviews retain their separate bounded approximation contract.

Previously, upcoming samples were distributed relative to each request while scheduled history sampled the first register write after a 20 ms gap. The same short register excursion could appear in one trace and disappear in the other despite identical underlying writes. Shared sampling and the [plot projection](../../src/timeline-sampling.ts) remove that mismatch. The [sampling guards](../../tests/timeline-sampling.test.ts) cover transient excursions, moving windows, packet boundaries, sparse baselines and density; the [rendered-curve guard](../../tests/browser/timeline-stability.spec.ts) compares actual canvas points at the same song times before and after playback crosses them using a cleared sample. Ordered-write inspection remains separate from this bounded visual sampling.

### Restart viewport

Loading a tune and Restart from beginning both release held inspection and start the Scroll viewport at zero. Restart keeps this viewport throughout the pending seek and after completion. Playback advances from the left edge to center before normal centered following resumes. Fit keeps its range, and explicit Follow still centers immediately. [The rewind guards](../../tests/browser/rewind.spec.ts) hold the real seek request for pending assertions, then verify completion and sample viewport/heard-time relationships atomically through the center handoff. They also check initial sample loading and replacement by a local file.

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

Chart times and the unprefixed playback timestamp attach to the chart axis. The chart has no separate Past/Upcoming direction row; scrollbar labels attach to its own track and describe the whole navigable range. Unknown lengths follow [the length contract](library-picker.md#song-lengths-and-stable-fitting). [Rendered geometry guards](../../tests/browser/timeline-labels.spec.ts) independently compare chart/ruler/track/label bounds, known and unknown endpoints, browsing without seeking and ruler seeking, including 2200-pixel and 390-pixel widths without horizontal overflow.

## Linear timeline through loop boundaries

Playback loop B constrains audio scheduling, not linear song observations. Follow, browsing and Fit retain data beyond B up to song duration/available coverage; a visible boundary explains the return to A without wrapped or synthesized frames. [Player guards](../../tests/player.test.ts) cover Rambo's 2:59.03–3:04.12 ending range and an independent 10–20-second loop, verifying beyond-B coverage, browse/Follow retention, unchanged loop bounds and no transport calls from view changes.

## Loop bracket and handles

The selected range has a violet ruler bracket, A/B labels, draggable handles and dashed lane boundaries without a background fill. Boundaries outside the viewport are hidden and short/edge ranges keep handles separately reachable. Pointer movement previews a fixed-viewport draft; release commits one changed range. Escape, pointer cancellation and lost capture discard it. Arrow keys move 0.1 seconds, Shift moves one second, and repeats commit once on keyup. Replacement bounds/load cancel an edit; a normal loop restart does not.

[Mounted ruler guards](../../tests/timeline-loop.test.ts) cover geometry, clipping, drag offset, commit count, cancellation, keyboard editing, viewport retention, tiny ranges and replacement. [Canvas guards](../../tests/phrase-listening.test.ts) check six voice lanes and filters, white-playhead priority, draft markers and unchanged unheard/unavailable fills. These are component/software oracles; actual Safari pointer/layout behavior was not automated in this correction.

### Selected bounds and playback repetition

Selected endpoints are independent of Loop on: a single endpoint stays visible/draggable, the complete pair adds the bracket, disabling repetition preserves selection, and Clear removes it. Setting A at/beyond B clears B and vice versa. Inactive edits make no audio calls; active edits update playback only on commit. Callback and component guards cover Set A/B, partial pairs, numeric fields, phrase selection and inactive canvas markers.

### Stable ruler height

Once used, marker space remains allocated for the page session, including after Clear and transitions away from staggered handles. This prevents the former 24/44-pixel panel collapse while markers themselves disappear. Initial rendering reserves no marker space until needed. The user accepted the correction with “Nice.” on 2026-10-20.
