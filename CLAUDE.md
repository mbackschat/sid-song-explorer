# SID Song Explorer contributor guide

This is the canonical agent/contributor guide. [AGENTS.md](AGENTS.md) is a relative symlink to this file; edit this file only. Use [PLAN.md](PLAN.md) for current scope and status, [the design](docs/design/web-player-and-analyser.md) for product contracts and [the documentation index](docs/README.md) for navigation.

## Product and ownership

Build a standalone browser player and arrangement analyser, with a C64-inspired presentation and readable modern interaction. The [playback adapter](docs/architecture/playback-adapter.md) owns the POC's small-shell decision and existing-engine integration; do not write an original SID emulator. Recent macOS/iOS Safari, MOS6581/MOS8580, one/two SID chips, correct output routing and useful inspection without annotations are product requirements; the plan orders their implementation.

Crafter owns composition tools, musical knowledge, evidence and sample publication. Link pinned owners through [the integration guide](docs/integration/crafter-handoff.md); do not copy its study corpus or assume a sibling checkout exists. Keep browser adaptations here until actual reuse warrants extraction. Do not import Crafter's musical backlog or reopen accepted studies.

## Work across the two repositories

The user authorizes working on Crafter and Explorer in the same session as a coordinated workspace. Read each repository’s guide and plan before editing there, use explicit repository working directories, and respect each owner’s contract. Keep commits, validation and status reports separate. A nearby sibling is an editing convenience, not an implicit build/runtime dependency. The [integration guide](docs/integration/crafter-handoff.md#coordinated-development) owns pin-update and compatibility rules.

Explorer implementation, experiments, decision records and working output belong in this repository, so a later Codex session opened here has the required context. Copy only the minimum source-backed material needed from Crafter, with pins and rights; preserve canonical musical knowledge there.

## Working conventions

- Define the success criterion and independent oracle before implementing. Prefer red/green regression guards for reusable code and defects; use link/parsing checks for documentation and real browser/audio evidence for playback.
- Diagnose bugs at the violated invariant. Make the smallest complete change; report unrelated code smells separately without building on them.
- Use two-space TypeScript, four-space Python and descriptive names. Prefer enum-based switches when language/runtime restrictions permit. Comments explain why and cite the basis, rather than restating code or parking status.
- Keep Markdown paragraphs on one physical line and catalogs as separate bullets/table rows. Use regular Markdown links to documents. Keep one canonical owner per fact.
- Use Node.js 24.18.0 (package minimum 24.12) and the pinned pnpm 11.20.0 for JavaScript/TypeScript; prefer uv for Python dependencies. Keep dependency pins and the pnpm lockfile consistent.
- Keep generated output in ignored `build/`, `dist/` or `public/generated/`, third-party checkouts in `.tools/`, and local state/archives in `.local/`. Keep project material inside this project. Machine-local agent configuration stays ignored; portable examples belong in `config/` if needed.
- Do not create or switch Git worktrees without explicit instructions. Preserve unrelated user changes. Commit coherent verified checkpoints using Conventional Commits; add a concise body when the rationale is not obvious from the subject and diff.
- Never push without authorization. Before every GitHub push verify that `git config user.email` is `mbackschat@mail.de`; stop on a mismatch.
- Ask for listening or product decisions with a recommendation and rationale. Make routine execution choices autonomously. Do not send messages to others without explicit authorization.

## Evidence and publication

Keep source inspection, executed behavior, rendered audio and human listening verdicts distinct. Human listening establishes musical acceptance; successful PCM generation does not prove real Safari playback. The heard playhead differs from the emulation lead. Register snapshots differ from ordered writes; live derived observations do not become recovered instrument identities.

Preserve each chip's shared filter, mono output and ring/sync dependencies. Muting is a labelled intervention, not a guaranteed isolated stem. State-preserving seeking includes CPU, oscillator, envelope and filter history. The design owns detailed contracts and the required stereo/Safari gates.

Local SID opening must remain device-local, including file hashes and metadata lookup. Publish only material with recorded composition, arrangement and player rights. Never commit reference SIDs, private audio, ROMs, secrets or downloaded engines. Hashes and public URLs do not grant rights. Prepare cleared catalog files with verified hashes into ignored deployment assets; [the POC snapshot](docs/integration/poc-sources.md) records the bounded import and does not replace Crafter's future producer.

Original work is GPL-3.0-or-later; retain MIT notices for transferred documentation. The POC adopts `libsidplayfp-wasm` 1.1.0 under GPL-2.0-or-later and its SIDLite build. Run asset preparation before a distribution build so the engine license, third-party notices, modifications and complete source accompany it. [Third-party notices](THIRD_PARTY_NOTICES.md) owns the adopted terms; research observations about other candidates do not authorize their reuse.

## Commands and validation

The application uses TypeScript 5.9.3, Vite 7.3.1 and `libsidplayfp-wasm` 1.1.0/SIDLite. [The architecture record](docs/architecture/playback-adapter.md) owns the choice and [the mono validation record](docs/validation/mono-poc.md) owns evidence and outstanding gates. Documentation checks additionally require Git and Python 3.10 or newer.

| Task | Command | Evidence |
| --- | --- | --- |
| Install pinned dependencies | `pnpm install --frozen-lockfile` | Standalone lockfile installation; no sibling source dependency. |
| Prepare deployment assets | `pnpm prepare:assets` | Verified sample files and copied engine license/notices/modifications/complete source in ignored `public/generated/`. |
| Start development | `pnpm dev` | Local Vite application; playback requires user interaction. |
| Check focused software behavior | `pnpm test` | Catalog, engine and timeline guards; no human listening verdict. |
| Build the application | `pnpm build` | Type checking and production output in `dist/`; prepare assets first. |
| Check browser behavior | `pnpm test:browser` | Playwright browser checks after installing its Chromium/WebKit; not real Safari acceptance. |
| Check documentation | `python3 scripts/check-docs.py` | Local Markdown targets and heading fragments; external availability excluded. |
| Check patch whitespace | `git diff --check` | Whitespace errors in current changes. |
| Rebuild logo exports | `python3 scripts/render-branding.py` | Raster assets from the selected vector masters; optional tools and visual checks in the [branding guide](assets/branding/README.md). |

Browser automation must be silent: use [the shared test fixture](tests/browser/fixtures.ts), which inserts a zero-gain sink after the analyser and mutes native media. Headless mode alone does not silence WebKit. Do not change system volume for tests.

Prefer headless Playwright Chromium/WebKit for automated checks, as requested by the user. Keep real Safari/iOS and human listening claims separate without requiring browser-setting changes to hand off a POC.

Keep README's implemented capabilities separate from product requirements, and retain an executable walkthrough. Update the owning validation record when the runtime, engine, browser or tested behavior changes; distinguish a build or automated WebKit result from real Safari sound and human acceptance.

Use the selected sound-lens identity and its [owning assets](assets/branding/README.md); preserve the distinction from Crafter’s chip silhouette. Record new visual verdicts in that owner and avoid regenerating accepted geometry without a requested change.

## Handoff and bounded execution

For JavaScript/TypeScript work, budget focused tests at 60 seconds and builds at 120 seconds unless a measured exception is documented. Use the runner's native bounded waits and session IDs; poll at most 30 seconds at a time and terminate/reap abandoned processes. Do not increase a budget just to wait longer. Diagnose sustained CPU saturation without progress; silence alone does not prove a hang. Use cancellation/deadlines at risky external-call boundaries.

Before a checkpoint, reconcile decisions, failed approaches and verification in their owning documents and update the plan. Retain reproduction inputs and evidence scope. Automate established repeated procedures with explicit inputs, bounded execution and meaningful checks; do not turn agents into a manual scheduler.
