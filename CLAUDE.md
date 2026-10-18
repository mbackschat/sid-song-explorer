# SID Song Explorer contributor guide

This is the canonical agent/contributor guide. [AGENTS.md](AGENTS.md) is a relative symlink to this file; edit this file only. Use [PLAN.md](PLAN.md) for current scope and status, [the design](docs/design/web-player-and-analyser.md) for product contracts and [the documentation index](docs/README.md) for navigation.

## Product and ownership

Build a standalone browser player and arrangement analyser, with a C64-inspired presentation and readable modern interaction. Evaluate reuse before selecting an app shell or stack. Do not write an original SID emulator. Recent macOS/iOS Safari, MOS6581/MOS8580, one/two SID chips, correct output routing and useful inspection without annotations are product requirements; the plan orders their implementation.

Crafter owns composition tools, musical knowledge, evidence and sample publication. Link pinned owners through [the integration guide](docs/integration/crafter-handoff.md); do not copy its study corpus or assume a sibling checkout exists. Keep browser adaptations here until actual reuse warrants extraction. Do not import Crafter's musical backlog or reopen accepted studies.

## Working conventions

- Define the success criterion and independent oracle before implementing. Prefer red/green regression guards for reusable code and defects; use link/parsing checks for documentation and real browser/audio evidence for playback.
- Diagnose bugs at the violated invariant. Make the smallest complete change; report unrelated code smells separately without building on them.
- Use two-space TypeScript, four-space Python and descriptive names. Prefer enum-based switches when language/runtime restrictions permit. Comments explain why and cite the basis, rather than restating code or parking status.
- Keep Markdown paragraphs on one physical line and catalogs as separate bullets/table rows. Use regular Markdown links to documents. Keep one canonical owner per fact.
- Prefer pnpm for JavaScript/TypeScript and uv for Python dependencies. Select and pin the runtime/package manager with the first application milestone; none is selected by this documentation bootstrap.
- Keep generated output in ignored `build/` or `dist/`, third-party checkouts in `.tools/`, and local state/archives in `.local/`. Keep project material inside this project. Machine-local agent configuration stays ignored; portable examples belong in `config/` if needed.
- Do not create or switch Git worktrees without explicit instructions. Preserve unrelated user changes. Commit coherent verified checkpoints using Conventional Commits; add a concise body when the rationale is not obvious from the subject and diff.
- Never push without authorization. Before every GitHub push verify that `git config user.email` is `mbackschat@mail.de`; stop on a mismatch.
- Ask for listening or product decisions with a recommendation and rationale. Make routine execution choices autonomously. Do not send messages to others without explicit authorization.

## Evidence and publication

Keep source inspection, executed behavior, rendered audio and human listening verdicts distinct. Human listening establishes musical acceptance; successful PCM generation does not prove real Safari playback. The heard playhead differs from the emulation lead. Register snapshots differ from ordered writes; live derived observations do not become recovered instrument identities.

Preserve each chip's shared filter, mono output and ring/sync dependencies. Muting is a labelled intervention, not a guaranteed isolated stem. State-preserving seeking includes CPU, oscillator, envelope and filter history. The design owns detailed contracts and the required stereo/Safari gates.

Local SID opening must remain device-local, including file hashes and metadata lookup. Publish only material with recorded composition, arrangement and player rights. Never commit reference SIDs, private audio, ROMs, secrets or downloaded engines. Hashes and public URLs do not grant rights. Future cleared catalog files are fetched with verified hashes into deployment output, not source control.

Original work is GPL-3.0-or-later; retain MIT notices for transferred documentation. Record exact licenses and provenance before adopting components. The research lists candidates, not installed dependencies or a blanket license clearance.

## Validation and handoff

Run `python3 scripts/check-docs.py` and `git diff --check` for documentation. The checker validates local Markdown targets and fragments; it does not check external site availability. CI repeats these checks. Application commands will be added with the selected stack.

For later JavaScript/TypeScript work, budget focused tests at 60 seconds and builds at 120 seconds unless a measured exception is documented. Use the runner's native bounded waits and session IDs; poll at most 30 seconds at a time and terminate/reap abandoned processes. Do not increase a budget just to wait longer. Diagnose sustained CPU saturation without progress; silence alone does not prove a hang. Use cancellation/deadlines at risky external-call boundaries.

Before a checkpoint, reconcile decisions, failed approaches and verification in their owning documents and update the plan. Retain reproduction inputs and evidence scope. Automate established repeated procedures with explicit inputs, bounded execution and meaningful checks; do not turn agents into a manual scheduler.
