# Rambo composition exploration

## Scope and review route

The first [composition experience](../design/composition-exploration.md) covers two adjacent Rambo mono source units, calls `[5426,5554)` and `[5554,5682)`. It contains three musical parts, five source program states and 101 distinct note entries, including the lead's carried-in sync state. The second unit repeats the lead's source nodes, rhythm and pitches; the bass moves eight semitones upward. These are bounded reconstruction facts and editorial role labels, not a claim about a universal instrument bank or the composer's intention.

In Explorer, load **Rambo loader — main music** with PAL/MOS6581. Under **Listen a little closer**, use the two **Hear** phrase buttons. Select a part/program to highlight its execution spans in the existing lanes; **Hear selected part in context** keeps the full mix and **Compare** offers the corresponding lead occurrence. Expand **Program behavior & dependencies** for sound-program details and source links. Normal timeline seeking follows the current composition mapping; Shift-click and Hold retain inspection. Other songs and changed profiles retain generic inspection.

The existing startup/ending annotation cards are grouped under **Playback evidence** while the composition package is available. No musical identity is inferred from live registers. New source labels cover only these passages, not the entire song.

## Producer evidence

Crafter owns the headless producer, editable score, program descriptions and original execution evidence. Its separate local checkpoint is `259e7fa4407f954bef360c092379bc0bd211aa66`; the sidecar is `samples/composition/rambo-main.json`. [The Explorer pin](../../config/composition-pin.json) records exact bytes and SHA-256. Musical evidence retains the already published source revision `3db086b6963676ef75f34d7f77c3b67232a777fb`, independently of the new producer commit. [The integration owner](../integration/crafter-handoff.md#composition-package-integration) records compatibility and publication boundaries.

Crafter's 26 focused composition/catalog tests passed on 2026-10-20. Independent retained original-CPU records establish note completeness, base pitch and next-row boundaries; the numeric player reproduces patch and entering sound state. Deterministic generation, owner links and patch whitespace passed. This establishes data provenance and software behavior; it does not establish a new listening verdict.

## Source time and playback time

The initial integration used nominal C64 seconds directly. A real-WASM probe rejected that mapping: by the selected passage, the expected onsets differed by roughly 0.1 seconds. Comparing only repeated frequency words also paired some events with neighboring notes, so that diagnostic was replaced by ordered note-initialization signatures.

The mechanism is the previously established [SIDLite PCM clock quantization](../research/seek-performance.md#correctness-issue-found-during-caching-research). Crafter's canonical PAL clock is `17734475/18` cycles/s; SIDLite at 44.1 kHz produces PCM at 983981.25 cycles/s. The session's calibrated origin is its first SID write, which precedes the tune's first play call. Both scale and origin therefore need an explicit bridge. No audio core or accepted SID was changed.

[The calibration tool](../../scripts/calibrate-composition.ts) renders the exact prepared main-music SID through the same custom module/WASM used by the application. For all 101 distinct source events it finds exactly one complete ten-write note-initialization sequence, checking the five zero/data register pairs from Crafter's pinned `rb_note_registers`. It retains the actual cycle/time observations and independently requires every passage's onsets to agree with the projected source-call grid within 10 ms. The earliest observed note provides the anchor; the documented PCM quantization supplies the scale. This measures instruction timing around a musical call boundary, not audible envelope onset.

On 2026-10-20 the 83-second bounded render completed in 3.125 seconds, with no dropped writes. All 101 signatures matched; maximum projected-onset deviation was 2.569 ms. [The committed calibration](../../config/composition-timing.json) binds the package digest, module, WASM and adapter source. Normal builds verify those fingerprints and event coverage without rendering again. Raw diagnostics remain in ignored `build/composition/onset-alignment.json`, with the rejected nominal probe in `build/composition/alignment.log`.

Reproduce after asset preparation:

```sh
pnpm composition:check
pnpm composition:calibrate
node --experimental-strip-types scripts/calibrate-composition.ts --check
```

The generation command updates only the calibration. A changed package or engine must pass the complete oracle; do not hand-edit an offset or relax the tolerance to accept a mismatch. The source package stays unchanged by projection.

## Consumer verification

On 2026-10-20, all 24 focused composition guards passed: strict schema/reference/coverage validation, source-call alignment, carry-in events, exact catalog and loaded-profile matching, import byte/hash checks, engine-calibration fingerprints, nominal-clock rejection, safe text rendering, part/program grouping, recurrence scope, focused-control retention and ordinary-seek versus held-selection behavior. Adjacent phrase comparisons use their exact projected spans; the legacy four-second minimum would overlap the next phrase and is retained only for legacy annotations.

Independent code review checked the producer, consumer, playback binding and source sound-program semantics. It identified the time-domain defect above; the real-WASM oracle subsequently established the corrected mapping. Full application validation is recorded at the final checkpoint below.

Final local checkpoint, 2026-10-20: all 219 application unit tests passed in 52.393 seconds. Subsequent part-selection/inspector synchronization and explicit source-versus-playback type refinements passed all 25 focused composition guards in 0.496 seconds and the final TypeScript/production build. Asset preparation reverified the existing samples, engine and notices; all 27 tracked Markdown files passed link/fragment checks, and patch whitespace was clean. The existing local preview on port 4173 served HTML and JavaScript byte-identical to the final build, checked by HTTP only. These checks ran in the working tree while unrelated earlier source-control UI fixes remained unstaged.

No computer use or browser automation was performed, following the user's instruction. Rendered layout, actual Safari/iPhone behavior and usefulness of this new musical explanation remain for user review. Earlier playback acceptance is preserved and does not substitute for those new-interface checks. Both repository checkpoints remain local; no push or deployment is claimed.

## Phrase listening and live observations

On 2026-10-20, the user reported an empty timeline after loading Rambo and choosing **Hear phrase** for “Sound processing continues after the score” at 2:59.03–3:04.12. The shared `hearPhrase` callback copied the currently available observations before seeking, then placed that captured chart at the destination. Fresh destination observations could not replace the held copy. The same mechanism affected composition listening from an unrelated held moment.

Listening now releases held inspection before seeking, retains the selected evidence span independently, and uses live destination observations. Explicit Hold and Shift-click retain their snapshot behavior. [The regression guard](../../tests/phrase-listening.test.ts) executes the actual UI callback at its transport boundary without mounting a browser: both ending-after-load and composition-from-Hold cases failed before the correction and passed afterward. All 27 focused phrase, composition-panel and timeline tests passed in 0.530 seconds; TypeScript checking and the production build passed. This verifies state transitions and existing observation handling, not rendered browser or audio acceptance.

The user confirmed that correction works, then requested clearer loop feedback. **Hear phrase** now expands **Loop A–B** after successfully enabling its loop. A compact **Loop on** indicator beside the transport time reflects the active loop regardless of whether its editor is expanded, with the boundaries in its tooltip; clearing the loop removes the indicator. Expansion occurs on the listening action, so subsequent playback updates respect a manually collapsed editor. Both new guards failed before implementation; all 29 focused phrase, composition-panel and timeline tests then passed in 0.620 seconds. No browser automation was used.
