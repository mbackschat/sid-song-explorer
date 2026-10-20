# Composition exploration

The user authorized coordinated Crafter and Explorer implementation on 2026-10-20. The first deliverable connects Rambo's executed arrangement and instrument programs to listening. Crafter owns the musical records and headless producer; Explorer consumes a versioned static package and supplies the interface. This implements the [founding musical explanation contract](web-player-and-analyser.md#analysis-packages-and-evidence). The generic [headless analysis proposal](headless-sid-analysis.md) remains deferred.

## Required experience

Load the existing **Rambo loader — main music** mono reconstruction. Select a documented passage, hear it in context, inspect a musical part and its sound program, and hear the returning phrase. Show which physical voice carries that part, the program's behavior, any documented dependencies and links to the owning evidence. A selected program highlights its mapped events in the existing timeline.

Keep normal timeline click-to-seek, Shift-click inspection, Hold, Follow and voice controls unchanged. Use the existing evidence area for compact passage navigation and one selected part/program card. Following playback or selecting a lane resolves the available composition mapping at that time. Outside the package's documented passages, show that mapping is unavailable; do not extrapolate an identity from registers. Ordinary local/library files retain generic inspection.

The first comparison covers one repeated lead phrase with changing accompaniment. Recurrence belongs to the named part; it does not assert identical full mixes. Voice muting remains an intervention on the original shared chip, with the existing playback interruption.

## Producer and consumer contract

| Concept | Meaning |
| --- | --- |
| Export binding | Exact SID fingerprint, catalog identity, subtune, clock, model, chip count/address and routing. Suppress composition claims on a mismatch. |
| Time and coverage | Source-call origin and cadence define Crafter's nominal source grid. Explorer projects that grid into the adopted renderer's PCM timeline using an independently checked clock and onset anchor. Explicit selected passages bound the available knowledge. |
| Part | A musical identity and role, distinct from its allocated hardware voice and sound program. |
| Program | Source-backed sound-program parameters and a readable explanation of behavior. A patch-state identity is not a recovered universal instrument-bank name. |
| Event | A source note entry, its part/program relationship, source node/address and retained entry state. Its interval ends at the next executed score transition; it is not a measured audible tail. Carry-in events retain their actual onset and are clipped only for display. |
| Passage and recurrence | A curated listening span, its events and source links; a recurrence identifies the particular parts sharing the source phrase. |
| Dependency | A source-backed chip resource or oscillator relationship within the passage. Shared filter ownership alone does not establish audible filtering. |
| Evidence and rights | Immutable source revision, owning documents, attribution and publication terms; verified execution, derived description and musical interpretation remain distinct. |

The initial format supports the existing mono PAL/6581 Rambo export and fixed part allocations within its covered passages. This is deliberately bounded; it does not promise arbitrary-driver extraction or time-varying allocation support for every song. The data model keeps those concepts separate so later song coverage can extend the contract explicitly.

Crafter's package is independently versioned from the existing catalog. Explorer retains the exact package bytes with a separate producer pin, verifies size/hash/schema/references/alignment, and checks the playable catalog binding before bundling. Normal development/builds require neither a sibling checkout nor network access. Local cross-repository import is explicit and uses the same hash checks; publication requires its own authorization. [The handoff guide](../integration/crafter-handoff.md) owns integration and pin maintenance.

The [timing validation](../validation/composition-exploration.md#source-time-and-playback-time) binds Explorer's projection to the exact package, engine module/WASM and session adapter. A changed fingerprint requires recalibration before the build can proceed. The projection has a measured onset tolerance; it does not claim sample-exact bus timing or acoustic latency.

## Acceptance

- A visitor can select the passage, identify the lead/bass/accompaniment roles and programs, hear the recurrence and open its evidence.
- Crafter verifies source events and timing against retained execution evidence, with exact generation and source fingerprints. Explorer independently rejects inconsistent times, missing relationships and mismatched playback profiles.
- The interface safely renders producer text, preserves focused controls across playback updates and highlights only mapped voices/events.
- Existing playback, catalog and local/library behavior remain intact. Automated checks establish software behavior; user review establishes the usefulness of the listening experience.

Optional follow-up: Rambo stereo as an explicitly labelled Crafter adaptation, then Bach's source-note-to-arrangement mapping. Neither adds new music to this first deliverable.

Excluded: a composition editor, automatic instrument discovery, invented composer intent, whole-song coverage claims, new SID emulation, generic analysis revival and a shared backend or third repository.
