# Rambo composition exploration

## Scope and review route

The first [composition experience](../design/composition-exploration.md) covers two adjacent Rambo mono source units, calls `[5426,5554)` and `[5554,5682)`. It contains three musical parts, five source program states and 101 distinct note entries, including the lead's carried-in sync state. The second unit repeats the lead's source nodes, rhythm and pitches; the bass moves eight semitones upward. These are bounded reconstruction facts and editorial role labels, not a claim about a universal instrument bank or the composer's intention.

In Explorer, load **Rambo loader — main music** with PAL/MOS6581. Under **Listen a little closer**, use the two **Hear** phrase buttons. Select a part/program to highlight its execution spans in the existing lanes; **Hear selected part in context** keeps the full mix and **Compare** offers the corresponding lead occurrence. Expand **Program behavior & dependencies** for sound-program details and source links. Normal timeline seeking follows the current composition mapping; Shift-click and Hold retain inspection. Other songs and changed profiles retain generic inspection.

The existing startup/ending annotation cards are grouped under **Playback evidence** while the composition package is available. No musical identity is inferred from live registers. New source labels cover only these passages, not the entire song.

## Producer evidence

Crafter owns the headless producer, editable score, program descriptions and original execution evidence. [The Explorer pin](../../config/composition-pin.json) binds `samples/composition/rambo-main.json` to exact producer bytes and SHA-256, separately from the musical source revision carried by the package. [The integration owner](../integration/crafter-handoff.md#composition-package-integration) records compatibility and publication boundaries.

Independent original-CPU records establish note completeness, base pitch and next-row boundaries; the numeric player reproduces patch and entering sound state. Producer guards cover deterministic generation, catalog binding and owner links. This establishes provenance and software behavior, not a new listening verdict.

## Source time and playback time

Nominal C64 seconds differ from the adopted renderer's PCM time by roughly 0.1 seconds at the selected passage. Repeated frequency words cannot uniquely identify adjacent notes; alignment therefore uses ordered note-initialization signatures.

The mechanism is the previously established [SIDLite PCM clock quantization](../research/seek-performance.md#correctness-issue-found-during-caching-research). Crafter's canonical PAL clock is `17734475/18` cycles/s; SIDLite at 44.1 kHz produces PCM at 983981.25 cycles/s. The session's calibrated origin is its first SID write, which precedes the tune's first play call. Both scale and origin therefore need an explicit bridge. No audio core or accepted SID was changed.

[The calibration tool](../../scripts/calibrate-composition.ts) renders the exact prepared main-music SID through the same custom module/WASM used by the application. For all 101 distinct source events it finds exactly one complete ten-write note-initialization sequence, checking the five zero/data register pairs from Crafter's pinned `rb_note_registers`. It retains the actual cycle/time observations and independently requires every passage's onsets to agree with the projected source-call grid within 10 ms. The earliest observed note provides the anchor; the documented PCM quantization supplies the scale. This measures instruction timing around a musical call boundary, not audible envelope onset.

The calibration measured on 2026-10-20 matched all 101 signatures without dropped writes; maximum projected-onset deviation was 2.569 ms. [The committed calibration](../../config/composition-timing.json) binds the package digest, module, WASM and adapter source. Normal builds verify those fingerprints and event coverage without rendering again. Raw diagnostics remain in ignored `build/composition/onset-alignment.json`.

Reproduce after asset preparation:

```sh
pnpm composition:check
pnpm composition:calibrate
node --experimental-strip-types scripts/calibrate-composition.ts --check
```

The generation command updates only the calibration. A changed package or engine must pass the complete oracle; do not hand-edit an offset or relax the tolerance to accept a mismatch. The source package stays unchanged by projection.

## Consumer verification

[Package guards](../../tests/composition-package.test.ts) cover strict schema/reference/coverage validation, source-call alignment, carry-in events, exact catalog/profile matching, import bytes/hashes, calibration fingerprints, nominal-clock rejection and safe text rendering. Panel guards cover part/program grouping, recurrence scope, focused controls and ordinary seeking versus held selection. Adjacent phrase comparisons use exact projected spans; the legacy four-second listening minimum would overlap the next phrase and applies only to legacy annotations.

The source-time bridge is verified by the real-WASM oracle above. Consumer software/type checking and production-build checks were executed locally on 2026-10-20 without browser automation. Rendered layout, actual Safari/iPhone behavior and usefulness of this musical explanation remain for user review. Earlier playback acceptance does not establish acceptance of this interface.

## Phrase listening and live observations

Listening must release held inspection before seeking, retain the selected evidence span independently, and use live destination observations. Previously the shared `hearPhrase` callback copied available observations before seeking, then placed that held chart at the destination, excluding fresh destination data. [The callback regression](../../tests/phrase-listening.test.ts) reproduces both the Rambo ending phrase at 2:59.03–3:04.12 after load and composition listening from an unrelated held moment. Explicit Hold and Shift-click keep snapshot semantics. The user confirmed the correction works on 2026-10-20.

**Hear phrase** expands **Loop A–B** after successfully enabling its loop. **Loop on** beside transport time reflects active repetition even when the editor is collapsed, with bounds in its tooltip; clearing repetition removes the indicator. Expansion belongs to the listening action, so later playback updates respect a manually collapsed editor. Callback guards verify these state transitions; browser rendering and audio acceptance were not exercised in this correction.
