# Live voice browser POC

Separate playback experiment around the [verified replay core](../live-voice-replay/README.md). The production player, engine and prepared-seek cache are unchanged. The [study](../../../docs/research/seek-performance.md#executed-browser-playback-spike-2026-10-20) owns results and the production decision.

## Frozen core

[core-lock.json](core-lock.json) pins the previously verified capture/filter/checkpoint sources, fixture generator and built JS/WASM to the replay checkpoint. Preparation and build reject changed core files; browser tests also hash the actual HTTP responses. This POC adds no filter math, emulator modifications, fades or crossfades. A core change requires a separately reviewed replay experiment and new equality evidence, not a silent lock refresh.

The worker captures 20,000 cycles per request and feeds one persistent native replay instance. Voice selection changes its mask without resetting filter state or restarting C64 execution. Raw capture blocks are discarded after replay. The browser schedules contiguous PCM through AudioBufferSourceNodes, targeting 250 ms of queued output; already queued sound retains its previous selection. A scheduling underrun fails explicitly rather than skipping samples or concealing a restart.

## Run

Use the project's pinned Node.js and pnpm. First prepare the main project's catalog assets and the existing replay experiment's verified output. This experiment deliberately consumes that output without rebuilding the core.

From the repository root:

```sh
node scripts/experiments/live-voice-browser/prepare.mjs
pnpm exec vite build --config scripts/experiments/live-voice-browser/vite.config.mjs
pnpm exec vite preview --config scripts/experiments/live-voice-browser/vite.config.mjs
```

Open [the local POC](http://127.0.0.1:4175/). Use the static preview: Vite's development import rewriting rejects importing the unchanged engine from its public directory. The build copies the engine bytes unchanged, and preview serves them directly.

Select Rambo stereo, Load, then Play. Try Mute, Solo, toggling Solo off, Full mix and rapid successive selections; compare mono and the shared-filter tone. Listen for dropped sound, unexpected clicks or restarts, and judge the roughly quarter-second response. The visible switch delay measures the scheduled AudioContext output time, not sound arriving at the physical device. Pause/resume retains the same session. Load restarts a tune; seeking and retained history are outside this experiment.

## Checks

```sh
node --test scripts/experiments/live-voice-browser/assets.test.mjs
node --experimental-strip-types --test scripts/experiments/live-voice-browser/session.test.ts
pnpm exec tsc --noEmit
pnpm exec playwright test --config scripts/experiments/live-voice-browser/playwright.config.ts --project chrome
pnpm exec playwright test --config scripts/experiments/live-voice-browser/playwright.config.ts --project webkit
```

Run the browser targets separately; each has a 60-second global budget, one worker and no retries. WebKit requires macOS. The browser tests use the project's silent fixture, retaining an active analyser with a zero-gain output sink. Logs, exact submitted-PCM evidence, screenshots and build output belong in ignored `build/live-voice-browser/`.

The tests independently compare selected saw voices with gate-suppressed, uncoupled, unfiltered fixtures rendered by the adopted raw engine. Filtered audition instead checks persistent replay state and continuous scheduling; it does not assert equivalence to muting voices throughout the song's past. Browser evidence checks frame and scheduled-time continuity, the actual submitted PCM, last-selection behavior and absence of source stops or context/worker replacement during selection.

Automated output evidence does not establish physical-device continuity, perceptually click-free transitions or real Safari/iPhone listening acceptance. Production cache coverage and audition/seek semantics remain unresolved.
