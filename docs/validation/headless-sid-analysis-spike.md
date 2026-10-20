# Headless SID analysis spike results

Date: 2026-10-20. [The proposal](../design/headless-sid-analysis.md) owns scope, [the research](../research/sid-analysis-capabilities.md) owns source evidence, and [the executable experiment](../../scripts/experiments/sid-analysis/README.md) owns reproduction commands. This spike is isolated from production Explorer.

## Outcome

The headless boundary works: a pure streaming accumulator consumes existing session observations, a Node host executes the SID and writes JSON, and a separate report viewer renders that JSON. The viewer contains no SID execution or finding-selection logic. The existing emulator, production playback and cache were not modified.

The user deferred the proposal on 2026-10-20; no integration or further ranking work is scheduled. The findings list remains an experimental review aid. Representative gate edges and overlapping changes on multiple voices need product judgment; executed reports do not establish human usefulness.

## What was executed

Runs used Node.js 24.18.0, prepared `build/engine/libsidplayfp.js` and its adjacent WASM, subtune 1, PAL, an unmuted independent session, and the already cleared generated files. Exact input and runtime SHA-256 identities, engine configuration, delivered frames and definitions are in each JSON envelope. There were no downloads, engine rebuilds or audio-device playback.

| Input | Model / chips | Analysed interval | Wall time | Worker peak RSS | Host peak RSS | JSON bytes | Findings |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Rambo main music | MOS6581 / 1 | 0–30 s | 1.257 s | 96.2 MiB | 86.6 MiB | 9,556 | 5 |
| Rambo main music stereo | MOS6581 / 2 | 0–60 s | 2.373 s | 101.6 MiB | 86.5 MiB | 13,730 | 11 |
| Bach Toccata stereo | MOS8580 / 2 | 0–60 s | 2.413 s | 101.2 MiB | 86.8 MiB | 13,817 | 12 |

All three delivered the complete requested frame interval with zero dropped writes. These are individual local measurements, not corpus performance promises. Wall time includes input reading and worker execution through receipt of the result, excluding JSON serialization/output writing. RSS measures whole processes, including Node and WASM; separate process peaks cannot be treated as one measured simultaneous peak. Small JSON and bounded retained analysis state do not imply a small total runtime footprint.

The CLI bounds input to 65,662 bytes, duration to 600 seconds, reports to 4 MiB and worker execution to 45 seconds. The worker renders 16,384-frame consumer blocks through the unchanged session partition. A parent process can terminate synchronous work; a blocked-worker test verified deadline termination and reaping. Signal handlers exist, but signal-specific cancellation was not separately tested. The spike remains repository-local and requires the prepared runtime; it is not a distributed standalone package.

## Finding selection and limits

Waveform nominations compare settings sustained for at least 20 ms. Brief real resets can be poor navigation suggestions: the Rambo mono scan contains repeated waveform-to-zero writes but only about 10 ms of total waveform-off time on voice 2 in 30 seconds. Short intermediate settings remain in counts, ranges and occupancy metrics; only nomination omits them. Before/after values are successive sustained settings rather than necessarily adjacent writes. This heuristic is recorded in the report; other finding kinds retain direct register-change semantics.

Representative observations from the 2026-10-20 reports:

- Rambo voice 2 changes from sustained sawtooth to pulse at approximately **12.795 s**. Its first 30 seconds contain approximately 12.79 seconds of sawtooth selection and 17.20 seconds of pulse selection; these describe programmed waveform bits, not inferred instruments.
- The stereo Rambo report identifies SID 2 voices 2 and 3 enabling sustained triangle and pulse settings around **15.358–15.359 s**, while keeping their statistics separate from SID 1.
- The Bach stereo report identifies SID 2 voice 3 selecting the combined triangle/pulse setting around **8.243 s**. Combined waveform occupancy is counted per enabled bit, so those durations overlap.

The selector suppresses its first 0.25 seconds, keeps bounded candidates across twelve temporal bins, and caps the output at twelve findings. It still produces gate edges and transitions to sustained waveform-off states; these are not labelled section boundaries, entrances or audible silence. The examples above are register observations, not listening verdicts.

## Correctness and separation evidence

[The handwritten oracles](../../scripts/experiments/sid-analysis/analysis.test.ts) cover redundant writes versus elapsed time, rapid gate events hidden by a final snapshot, same-time ordering, nonzero initial state, time-zero and terminal boundaries, chip ownership, signed-16-bit PCM scaling, overlapping waveform bits, loss invalidation, bounded temporal selection, brief waveform resets and sustained-state confirmation. Short and partitioned loss-free streams produce identical full reports.

[The real-WASM oracle](../../scripts/experiments/sid-analysis/engine.test.ts) derives gate/waveform expectations from the diagnostic program, checks active-chip PCM against an independently rendered relocated mono program, and compares PCM statistics with independent formulas. A separate real session partition check produces identical reports. Inactive-channel metrics are checked without assuming digital silence; independent inactive-channel equality is not claimed.

Dropped writes invalidate derived register metrics rather than presenting false precision. Observed counts remain incomplete, PCM remains measurable and only findings before the affected block survive. With loss, the reliable prefix, dropped-block count and retained findings can depend on the delivery partition; the full-report invariance claim applies only to loss-free streams.

[Host/worker guards](../../scripts/experiments/sid-analysis/runner.test.ts) cover bounded execution and output handling. Local software/type checks, viewer JavaScript syntax and the three report payloads were verified on 2026-10-20. Rendered UI, Safari behavior and human usefulness were not checked.

## Deferred decision

The thin viewer is available at [localhost port 4180](http://127.0.0.1:4180/) while its local server runs. It allows selection among the three reports, inspection of finding evidence, comparison of voice/chip statistics and expansion of provenance. It does not play audio or seek Explorer. The Node JSON reports remain usable without it.

If explicitly reopened, first review whether waveform changes and voice summaries help exploration. The retained architectural recommendation is a headless core with an Explorer adapter consuming its report, keeping analysis rules outside the UI.
