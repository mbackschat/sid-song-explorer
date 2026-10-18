# Mono proof of concept validation

[The plan](../../PLAN.md) owns completion. This checkpoint implements the first playable Explorer, while real desktop Safari listening and the user's explanation-value verdict remain open. All new Explorer code, experiments and decisions live here. Crafter was used read-only for the pinned sample/evidence import; normal setup downloads the cleared assets independently.

## Reproduce

Use Node 24.18.0 from [.node-version](../../.node-version), pnpm 11.20.0, and Python 3.10 or newer for the documentation checker:

```sh
pnpm install --frozen-lockfile
pnpm prepare:assets
pnpm test
pnpm build
pnpm exec playwright install chromium webkit
pnpm test:browser
python3 scripts/check-docs.py
pnpm dev
```

All browser tests use [a silent-output fixture](../../tests/browser/fixtures.ts). Headless WebKit sent audio to physical macOS speakers during the first full-song attempt; that run was stopped after the user reported loud sound. The fixture intercepts destination connections with a zero-gain sink after the application analyser and mutes native media playback. PCM, timeline and analyser checks remain active; test output cannot establish speaker listening. System volume is untouched.

Browser tests serve the production build on `127.0.0.1:4173`; ordinary development uses `127.0.0.1:5173`. `EXPLORER_CHROME=1 pnpm test:browser` explicitly selects installed Google Chrome instead of Playwright's Chromium. Browser screenshots go to ignored `build/poc/`, failure diagnostics to `test-results/`. Run tests after a build, without source changes during the run. Run the full-song check separately from replay-heavy interaction tests, so concurrent emulation does not distort their execution budgets. Test assertions concern browser behavior and advancing PCM, not sound heard by a person.

The focused unit/engine suite has a 60-second budget. The opt-in `pnpm test:full` runs uninterrupted 193-second real-time playback in headless WebKit with a 240-second budget; this measured duration requires a separate test rather than extending ordinary checks. Browser interaction tests have a 45-second per-test budget, one worker, and a 30-second server-start budget. The whole browser suite may exceed 60 seconds because it runs independent interactions in two browsers. On this machine Node 26.10.0 stalled during Playwright download/trace finalization; Node 24.18.0 completed those operations. This is a tooling observation, not a claim that the application requires a specific browser Node version.

## Evidence and remaining review

The [engine record](../architecture/playback-adapter.md#bounds-and-verification) owns executed PCM, exact seek, mute and full-form checks. [Source preparation](../integration/poc-sources.md) owns asset hashes, rights and the provisional analysis snapshot. The retained reference WAV is a separate renderer/listening artifact; the POC does not claim PCM identity to it.

Browser checks cover output-timestamp advancement through Web Audio, nonzero PCM metering, register observations, held history, solo/restore, replay loops, seeking into the complete ending, profile mismatch removing authored annotations, local-file playback without external requests, invalid-file feedback during playback, and narrow-screen layout. On 2026-10-18, all six production-browser interaction checks passed in 1.4 minutes using headless Google Chrome 155.0.8059.82 and Playwright WebKit 26.0 (build 2215), with Node 24.18.0 and Playwright 1.56.1. Every test verified its zero-gain output sinks. The 21 catalog/engine/timeline tests passed in 11.74 seconds on Node 24.18.0. Type checking, the production build and all local documentation links passed. The separate silent uninterrupted WebKit run passed in 3.3 minutes: the 193.35884353741497-second sample reached its declared ending with zero buffer underruns, zero dropped writes and no page errors. Its full-ending screenshot is retained in ignored `build/poc/`; the README's [live preview](../../assets/screenshots/mono-poc.png) comes from the final WebKit transport run. This establishes full-duration automated playback through the graph, not human listening.

Actual Safari 27.0.1 (22625.1.29.11.28) automation was attempted on 2026-10-18. Safari's driver rejected session creation because “Allow remote automation” is disabled in Safari settings. No setting was changed. Playwright WebKit is separate evidence and does not satisfy real Safari speaker playback, iOS validation or human listening.

For the listening review, open the development URL in Safari, load Rambo, press Play, and compare a phrase against the retained reference player. Selecting a lane holds inspection while live playback continues. Try one evidence card's phrase, solo/restore, then listen through the ending. The product question is whether the linked explanation helps identify what is heard. That verdict remains with the user; the restored cold-start entrance does not inherit approval from the previously accepted cropped listening scope.

## Transport and inspection limits

The [transport](../../src/player.ts) schedules 44.1 kHz mono PCM through Web Audio with a short render-ahead queue. It maps audio-context output timestamps through scheduled media segments, falling back to context time minus reported output latency. The emulated position is shown separately. This does not measure physical speaker latency.

The transport retains requested playback intent separately from transient seeking status. Generation checks prevent superseded operations from sending a stale second RPC or reviving a replaced load; a desired mute mask is recorded before replay. The rapid-seek browser regression covers the previously reproduced playing-to-paused race. Seeking and changing mute masks discard queued audio and replay initialization through the requested position. Loop re-entry does the same and can pause; there is no gapless-loop claim. The local-file window is limited to ten minutes and has no inferred musical ending. A catalog duration is used only with its declared clock.

Voice activity offers **Scroll** and **Fit history** buttons inside its existing header, beside one visible Hold/Resume live action. Scroll is the default and uses a fixed ten-second horizontal window. Fit history restores the expanding overview of all retained activity, respecting its earliest retained timestamp and including any held selection. After the first ten seconds it scrolls with the heard playhead; seeking or looping moves the window without changing its scale. Holding inspection freezes the Scroll viewport or the Fit history snapshot, and returning to playback resumes following in the chosen mode. Switching modes leaves playback and the held inspection cursor unchanged; switching a held selection back to Scroll shows a ten-second window ending at that cursor. Mode selection lasts for the page session, including tune changes; reloading defaults to Scroll. Drawing samples only the visible interval, carrying the preceding register state to its boundary, so older off-screen history cannot reduce Scroll resolution. Fit history intentionally compresses a growing visible interval. Six focused timeline guards passed, and four silent Chromium/WebKit checks passed in 26.5 seconds for default scrolling, switching both modes, uninterrupted playback/held inspection and narrow-screen layout on 2026-10-18. Type checking and the production build also passed.

The live history retains at most 6,000 register snapshots and 200,000 ordered writes. Snapshots are sampled from observed writes at roughly 20 ms intervals; the inspector applies subsequent retained writes through its cursor. A held selection copies its own history and survives live seeks/mute changes. Evidence cards retain their exact annotation range while auditioning at least four seconds of separately labelled listening context when the remaining duration permits. Missing coverage, old playback epochs and dropped records are explicit. The final register-address display correction was additionally checked by the transport browser test in both engines (two passes in 42.2 seconds). The UI maps the engine's raw register offsets to the declared mono SID base address `$D400` for displayed writes; raw cycles/offsets remain available in the adapter contract. Registers describe programmed settings, not measured envelope amplitudes or recovered instrument identities. [Trace calibration](../architecture/playback-adapter.md#pcm-trace-timing-and-coverage) remains approximate relative to audible sound.

This POC supports a declared callable mono PSID subset. RSID, additional SID chips, ROM-dependent formats, accounts, upload services and composition editing are excluded. Dual-SID routing and real iPhone behavior are subsequent gates, not implied by the two model/clock selectors.

## Interaction feedback

The 2026-10-18 feedback revision removes the separate timeline toolbar row. Clicking a voice/filter lane holds the inspection time while music continues; the existing history strip names that selection, links to the highlighted Sound inspector, and offers Resume live in the header. This action does not seek playback. The transport slider remains the seek control.

Seeking now displays an animated indicator in the transport button and status line, names the requested time and explains that the current implementation replays from initialization. The slider stays at the requested position, explicitly labelled as requested rather than heard, until the operation completes. The player publishes that pending target for direct seeks, loop re-entry and mute replay; success, load replacement and failures clear it. The indicator respects reduced-motion settings. This improves feedback, not seek performance.

Silent headless Chrome/WebKit checks cover compact header placement, held voice/time and register selection while playback advances, the inspector link at 390 pixels, both timeline modes, target retention while seeking, resumed playback and injected seek failure clearing busy feedback. The seven interaction scenarios passed in both browser engines across the suite and focused rerun; the suite took 1.9 minutes and the focused WebKit seek check 10.9 seconds. Each scenario remains bounded to 45 seconds. Production type checking/build passed; screenshots in ignored `build/poc/` were inspected for the held and seeking states. These are automated interaction checks, not new listening acceptance.
