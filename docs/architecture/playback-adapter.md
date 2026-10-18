# Mono playback adapter

The first prototype uses the unchanged npm `libsidplayfp-wasm` 1.1.0 SIDLite artifact through its low-level `SidPlayerContext`. [The founding design](../design/web-player-and-analyser.md#first-step-and-milestones) owns the product gates. This adapter produces real emulated mono PCM and observations; browser scheduling, heard-position tracking and interaction belong to the application transport. Successful rendering does not establish Safari speaker playback or human listening acceptance.

## Application shell decision

Use a small TypeScript/Vite shell over the existing WASM engine for this mono POC. The retained [Chip Player JS review](../research/web-music-explorers.md) found application-service coupling and no existing trace contract; the immediate question is whether this binding can provide consistent audio, stateful replay and useful observations. Reusing its larger application shell would not settle that question. Explorer therefore reuses the emulator and implements only transport, inspection and source-linked presentation. This is a bounded POC decision, not approval of dual-SID routing or every SID file profile.

Node 24.18.0, pnpm 11.20.0, TypeScript 5.9.3 and Vite 7.3.1 form the development toolchain. Vite uses ES-module workers because the upstream loader imports engine modules dynamically. Its browser build externalizes the loader's Node-only `module` import; production-browser checks exercise the browser branch. The unmodified package's complete-source archive, licenses, notices and modification record are prepared alongside the deployment assets by [prepare-runtime.ts](../../scripts/prepare-runtime.ts).

## Supported input and configuration

[SidSession](../../src/engine/session.ts) accepts PSID versions 1–4 with the standard 118/124-byte header, one SID, a nonzero callable play address, 1–256 songs and a program that fits C64 memory. Both VBI and CIA-timed callable PSID execute through libsidplayfp's driver. The caller explicitly selects PAL/NTSC, MOS6581/MOS8580 and a one-based subtune; these choices override header clock/model suggestions. Local file contents remain inside the worker.

Preflight rejects RSID, MUS payloads, PlaySID-specific compatibility flags, extra SID addresses, interrupt-driven `play=0`, malformed offsets/counts and files above 65,662 bytes before constructing a WASM context. This is a declared subset, not general SID-format support. An initial SID write must appear within 20,000 single-event startup probes; a valid program with a longer delayed initialization can therefore be rejected. A later halt or failure to produce samples returns an execution error. No system ROM files are loaded or distributed; supporting ROM-dependent programs requires a separate scope and rights decision.

The output is 44,100 Hz signed 16-bit mono, with SIDLite's filter implementation. `LoadResult.engine` reports the actual builder, libsidplayfp version, CIA model, sampling method, digi boost, effective startup delay and trace timing basis. With this pin, executed checks report `WasmSIDLite`, libsidplayfp 3.1.1, `MOS8521`, `RESAMPLE_INTERPOLATE` and digi boost enabled. The selected SID model, C64 model, mono mode and sample rate are checked against the resolved engine configuration before accepting a load. SIDLite does not expose reSIDfp's analogue filter tuning.

The requested power-on delay is always zero. Upstream [Player::initialise](https://github.com/libsidplayfp/libsidplayfp/blob/732fa8ec8131fc75aafc2eaea583ddcdeea2a3cc/src/player.cpp) adds 8000 internally, so the effective delay reported by the engine is 8000. Zero here selects deterministic startup; it does not mean the emulation begins with zero startup work.

## Session and worker contracts

```typescript
const session = await SidSession.create({ wasmUrl }); // wasmUrl omitted in Node
const info = await session.load(bytes, {
  clock: 'PAL', model: 'MOS6581', subtune: 1,
});
const block = session.render(4096);
const position = await session.seek(12.345);
await session.mute([false, true, false]); // true means muted
session.dispose();
```

`create` is lazy: input preflight happens before the WASM loader is invoked. `render(frames)` accepts integer counts from 1 through 88,200 and returns `{pcm, startFrame, endFrame, writes, registers, dropped}`. The counters describe PCM delivered to the caller, rather than how far the underlying context has already emulated. `seek(seconds)` accepts finite positions from zero through 600 seconds, converts to `floor(seconds * 44100)`, reloads deterministic initialization and consumes every preceding frame. It preserves the final raw block remainder. `mute(mask)` performs the same replay to the consumed frame with the new three-voice mask, so buffered PCM cannot retain the previous mask. Restoring the full mix replays its full history rather than inheriting a muted filter/envelope history. Muting remains an engine intervention, not a promise of isolated stems or preserved cross-voice dependencies.

The session caller must serialize methods. [The worker](../../src/engine/worker.ts) supplies that boundary with request/reply messages defined in [the protocol](../../src/engine/protocol.ts):

| Method | Payload | Result |
| --- | --- | --- |
| `load` | `{bytes: Uint8Array, options: PlaybackOptions}` | `LoadResult` |
| `render` | `{frames: number}` | `RenderResult` |
| `seek` | `{seconds: number}` | `{frame, registers}` |
| `mute` | `{mask: [boolean, boolean, boolean]}` | `{frame, registers}` |
| `dispose` | none | `null` |

Every request carries numeric `id`; replies are `{id, result}` or `{id, error}`. PCM buffers transfer to the main thread. The worker imports the SIDLite WASM URL using Vite's `?url` mechanism; the session itself has no bundler-specific imports and runs directly in Node. The worker accepts at most 16 pending requests and rejects further requests instead of growing an unlimited execution backlog. A disposed worker session may be recreated by a later load.

## PCM, trace timing and coverage

The raw binding returns a view into WASM memory; the adapter copies each PCM chunk before any subsequent WASM call. It consumes that copy exactly once and retains its unconsumed suffix. It never advances by an estimated frame count or truncates the last seek block. This avoids the final-block loss in the published [SidAudioEngine.fastForwardContext](https://github.com/chrisgleissner/libsidplayfp-wasm/blob/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275/src/player.ts).

Raw `cyclePhi1` is preserved unchanged. Addresses remain SID register offsets `0x00`–`0x1f`, and `sidNumber` is zero for this mono adapter. These are ordered writes observed at the binding's [write hook](https://github.com/chrisgleissner/libsidplayfp-wasm/blob/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275/src/bindings/bindings.cpp), rather than frame-polled snapshots or an assertion about the unmodified program under mute. Reset/calibration execution is separate from the actual playback trace.

The scheduler cycle counter includes startup and has no exposed cycle-zero accessor. The integer-millisecond playback accessor cannot recover its exact origin. A bounded dry pass renders one scheduler event at a time until the first SID write, counts the produced PCM, and records `traceCycleOrigin = firstWriteCycle - producedFrames * clockHz / 44100`. Derived time is `(cyclePhi1 - traceCycleOrigin) / clockHz`, using the pinned upstream [PAL/NTSC clock values](https://github.com/libsidplayfp/libsidplayfp/blob/732fa8ec8131fc75aafc2eaea583ddcdeea2a3cc/src/c64/c64.cpp). This is calibration to a quantized audio sample boundary. It does not establish exact analogue/resampler latency or cycle-perfect alignment with sound heard from speakers.

For the tested PAL/MOS6581 Rambo main export on 2026-10-18, the first observed write was cycle 167873 after two produced calibration frames, yielding estimated origin 167828.31752330562. This illustrates the observed offset; the adapter recalibrates each selected configuration instead of hard-coding that tune's origin.

An independent raw-library PCM comparison found that continuing the live stream after small calibration renders changed later SIDLite samples, despite preserving their count. The adapter therefore resets the context after calibration and starts the actual stream from frame zero using its normal 20,000-event render calls. The actual startup PCM is included in full. The raw-library oracle checks that the resulting first second is byte-identical to ordinary uncalibrated raw rendering; same-session continuous/replay comparisons separately verify seeking and mute restoration. Render-partition sensitivity belongs to this engine pin, not a claim about physical SID behavior.

Returned writes cover the delivered frame interval according to the calibrated time basis; later writes from a partially consumed raw block remain pending. `registers` is a 32-entry array of the last observed register writes at that logical endpoint, initialized from the reset status. It is not a future raw-block endpoint snapshot, and it does not poll changing read-only oscillator/envelope values. The application must retain its own bounded observation history and label the calibration basis. No trace retention beyond the pending raw block is hidden in this adapter.

The dropped-record count is read before draining the binding because draining resets it. Counts are returned once and aggregated per underlying render work; an overflow cannot be attributed more precisely to a subrange of an already generated PCM block. After seek or mask replay the caller starts a fresh observation interval; replayed history is not returned as newly heard writes. A reset register image is not evidence that every initialization/hardware-reset write was traced.

## Bounds and verification

Every risky raw render advances at most 20,000 scheduler events; upstream also clamps the requested render size to 20,000. A render has a sample-production call budget and an empty-result limit, so a stopped or malformed program cannot spin indefinitely waiting for PCM. Render, startup calibration and replay check a 15-second execution deadline. Replay yields to the worker event loop after each eight seconds of emulated audio. There is no in-protocol progress or cancellation message in this prototype; terminating the worker cancels an operation immediately, while ordinary queued disposal waits behind the bounded current request. Rendering after a partial execution failure requires reloading.

[The engine tests](../../tests/engine.test.ts) use the prepared, hash-verified public Rambo asset without a sibling-checkout dependency. Run `pnpm prepare:samples`, then `node --experimental-strip-types --test tests/engine.test.ts`. A local ignored `build/engine-tests/rambo-loader-main.sid` can serve as an explicitly prepared fixture during development. The focused test budget is 60 seconds.

Executed on 2026-10-18 with Node 26.10.0: ten tests passed in 32.34 seconds under concurrent development load. Guards cover malformed/unsupported input before WASM loading, real advancing mono PCM and ordered writes, raw-library PCM equality, callable CIA execution, split blocks, exact non-block seek PCM/write equality, NTSC/MOS8580 mask restoration, finite resource bounds, a CPU-halting play routine, and the full 193.35884353741497-second main export plus a one-second tail. The full-form render verifies execution and a decayed tail, not a listening verdict or equivalence to Crafter's different renderer. Browser scheduling and Safari validation are separate application checks.
