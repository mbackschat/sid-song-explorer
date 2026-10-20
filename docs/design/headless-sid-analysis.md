# Headless SID analysis proposal

Status: deferred by the user on 2026-10-20 after the bounded spike. Preserve the proposal, [research](../research/sid-analysis-capabilities.md), [executed spike](../validation/headless-sid-analysis-spike.md) and implementation for possible later use. No further analysis work or Explorer integration is scheduled; resume only when the user reopens it. [The plan](../PLAN.md) owns adoption and completion.

## Purpose

Help an Explorer user find passages worth listening to, compare what each voice does, and understand a selected sound. Prefer findings with a time and an explanation over a dashboard of unexplained totals.

The analyser is headless. It accepts SID bytes, an explicit playback profile and a finite analysis interval, and returns structured data. Node is the first host; Explorer is a consumer of that same analysis contract. The UI must not own detection rules, aggregate register statistics or require a second implementation of the analysis.

## Required results

| Result | User value | Evidence boundary |
| --- | --- | --- |
| Moments to inspect | Navigate to changes in waveform, modulation or filter routing, and voice gate activity | Report the observed change. Ranking a change as interesting is a heuristic, not a musical section boundary. |
| Voice summaries | Compare gate patterns, waveform use, pulse-width behavior and register activity | Gate duration is not audible duration; programmed controls do not establish an instrument or musical role. |
| Chip and output summaries | Understand shared-filter routing, cutoff variation and mono/stereo output levels | Filter settings are chip-wide; PCM measurements belong to the selected renderer and output routing. |
| Evidence for a selected moment | Explain which voice/chip settings changed and where to listen | A finding contains its timestamp, subject and supporting values; the UI renders those facts. |
| Coverage and identity | Know what was actually analysed and reproduce it | Identify the input, runtime, subtune, clock/model, requested/actual interval, dropped writes and stop reason. A duration bound is not a detected song ending. |

Results must distinguish declarations, measured/calculated facts and heuristic selection. Do not convert missing observations into zero activity. Counts after dropped writes are incomplete; time-weighted settings become unreliable when transitions are missing.

## Headless boundary and UI

The reusable layer consumes the existing `SidSession`'s ordered writes and PCM, accumulating summaries while discarding processed chunks. It has no DOM, file-system, network, audio-device or UI-state dependency. Host adapters own file input, runtime loading, job deadlines and cancellation. The current proven emulator and render partition remain unchanged.

The report is versioned, JSON-serializable and independent of its renderer. A minimal finding has this shape:

```ts
type Subject = {chip: number; voice: number | null};
type Finding = {
  timeSeconds: number;
  subject: Subject;
  kind: 'gate' | 'waveform' | 'modulation' | 'filter-routing';
  before: number;
  after: number;
  evidence: 'observed';
  selection: 'heuristic';
};
```

Chip and voice indices are zero-based in data and displayed one-based. The full report also carries the metric definitions and coverage described above. Waveform findings can compare successive sustained states while omitting short intermediate settings; the report must declare that rule and its duration threshold rather than present those values as adjacent writes. This example describes the public semantics; it does not prescribe a large extensible framework.

In Explorer, moments belong alongside the existing timeline, and selecting one should seek/highlight the relevant passage. Voice summaries and explanations belong in the existing inspector with technical totals expandable. A report cannot be attached to a different SID or profile. Analysis must not silently change playback or the current mute mix; the initial report describes a separate, unmuted execution.

## Optional and excluded scope

Optional later work: programmed-pitch summaries, candidate repeated passages, spectral descriptors, explicitly supplied offline metadata and multiple independently bounded subtunes. Each needs a demonstrated user benefit and its own evidence.

Excluded initially: score/instrument recovery, bass/lead/drum classification, certified loop/end detection, isolated stems, CPU profiling, new SID formats or ROM support, network enrichment, a new emulator and a permanent statistics panel. Local files and matching remain device-local.

## Bounded spike

Test whether the headless separation yields credible, navigable findings at proportionate cost. Keep the experiment under `scripts/experiments/sid-analysis/`, with generated reports and captures under ignored `build/sid-analysis/`. Use existing cleared mono and stereo samples and the prepared runtime. The spike is not production Explorer integration.

The spike comprises a pure streaming accumulator, a Node runner emitting JSON, and a thin review UI reading that JSON. The review UI exposes the findings and their supporting values; it does not analyse audio or derive findings. Actual Explorer seek/highlight integration follows only after the spike is reviewed.

Success requires independent short-trace/PCM oracles for time-weighted state and output metrics; invariance to consumer chunk boundaries; separate chip ownership; explicit loss handling; finite input/output/job bounds; and successful real mono/stereo runs with measured wall time, process memory and report size. Show representative findings rather than treating successful JSON generation as proof of usefulness.

Retain negative results and measurement scope. Automated checks establish mechanics and separation; human review decides whether the suggested moments and summaries help exploration. Recommend proceeding only if both the evidence is correct and the resulting report is useful.
