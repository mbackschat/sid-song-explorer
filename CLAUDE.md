# SID Song Explorer contributor guide

This is the canonical agent/contributor guide. [AGENTS.md](AGENTS.md) is a relative symlink to this file; edit this file only. Use [PLAN.md](docs/PLAN.md) for current scope and status, [the design](docs/design/web-player-and-analyser.md) for product contracts and [the documentation index](docs/README.md) for navigation.

## Product and ownership

Build a standalone browser player and arrangement analyser, with a C64-inspired presentation and readable modern interaction. The [playback adapter](docs/architecture/playback-adapter.md) owns the POC's small-shell decision and existing-engine integration; do not write an original SID emulator. Recent macOS/iOS Safari, MOS6581/MOS8580, one/two SID chips, correct output routing and useful inspection without annotations are product requirements; the plan orders their implementation.

Use familiar, predictable player interactions so users can focus on musical exploration. Apply the [interaction principle](docs/design/web-player-and-analyser.md#interaction-principle) while preserving explicit product requirements; surface conflicts rather than silently replacing agreed behavior.

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
- Before pushing UI changes, run the relevant silent Playwright checks locally; before an application release, run the configured Chrome/macOS WebKit suite. Unit tests and a successful build do not establish browser behavior. Report any unavailable validation explicitly before publication.
- Before calling a pushed checkpoint verified, inspect the required GitHub Actions results for that exact commit. Keep local and CI evidence separate: a local run with tracing disabled or a focused subset does not establish that the configured CI suite passes. Report failures and continue diagnosis rather than handing off a successful push as successful validation.
- Never push without authorization. Before every GitHub push verify that `git config user.email` is `mbackschat@mail.de`; stop on a mismatch.
- Ask for listening or product decisions with a recommendation and rationale. Make routine execution choices autonomously. Do not send messages to others without explicit authorization.

## Keep documentation durable

- Document current contracts, decisions and their rationale, reproducible validation methods, material limitations and scoped acceptance. Keep each fact in its existing owner.
- Do not accumulate session journals, release chronology, implementation play-by-play, routine test counts/timings, retry histories, or commit/push/deployment status in project documentation. Use command logs, CI, Git history and the final response for execution reporting.
- Reduce a resolved failure to the reusable constraint and regression guard when those help future work; retain reproduction inputs in tests or evidence, not a narrative of the debugging session. Keep dated measurements only when they support a performance/resource decision or another substantive claim, and preserve human listening verdicts with their scope.
- Update or replace superseded text instead of appending another checkpoint or follow-up. Remove obsolete operational prose; do not move it into a new archive document. Before adding a paragraph, identify the future decision or task it supports; omit it if it only proves work happened.

## Choose sub-agent tiers by task

Delegation is authorized. **LOW, MEDIUM and HIGH are symbolic model tiers**, not fixed roles or agent counts. Resolve the active CLI's model and effort settings through the [global model tier mappings](https://github.com/mbackschat/coding-setup/blob/main/CLAUDE.md#model-tier-mappings); keep concrete selectors only there. Report missing or unsupported configurations rather than substituting silently. Start a fresh agent when changing tier so a fork cannot retain the previous model.

Choose the least expensive tier that can meet the task's evidence requirements. Judge uncertainty, independence, scope and consequences of error, rather than file type, task length or familiar keywords. These criteria apply to future tasks as well as current work:

| Tier | Assignment criteria | Boundary and expected result |
| --- | --- | --- |
| LOW | Well-specified, low-uncertainty work with authoritative inputs and a direct check: extraction, comparison, mechanical edits or routine verification. | Supply the exact scope, source of truth and pass/fail criteria. Return verifiable facts and discrepancies. Escalate when completion needs diagnosis, interpretation of conflicting evidence or a new design decision. |
| MEDIUM | Bounded work requiring investigation or implementation judgment within established contracts: component changes, focused diagnosis, experiments, regression tests or correctness review. | Define ownership, constraints, interfaces and an independent oracle. Make local decisions within that boundary; escalate when the evidence challenges the contract, crosses ownership boundaries or exposes consequential uncertainty. |
| HIGH | Work with ambiguous contracts, substantial uncertainty or broad consequences: architecture, cross-component diagnosis, conflicting-evidence resolution, verification design and final integration. | State the unresolved decision, alternatives and evidence that will settle it. Delegate separable bounded work; retain responsibility for integration, scope and the strength of final claims. |

Keep small or tightly dependent tasks local. Do not duplicate work just to use another tier, prescribe a fixed team size or parallelize dependent edits. Give every delegate the active objective, minimal sufficient context, owned files or boundaries, acceptance criteria and a stopping condition. Reuse informed agents while their tier remains suitable; reassign when the work's uncertainty or consequences exceed that tier. Stop obsolete assignments.

Delegation does not expand authorization or relax publication, privacy, provenance or human-acceptance requirements. Keep source evidence, executable results and human judgments distinct. Delegates report unresolved assumptions and unpersisted findings; the coordinator checks their evidence and reconciles the owning documents before handoff.

## Evidence and publication

Keep source inspection, executed behavior, rendered audio and human listening verdicts distinct. Human listening establishes musical acceptance; successful PCM generation does not prove real Safari playback. The heard playhead differs from the emulation lead. Register snapshots differ from ordered writes; live derived observations do not become recovered instrument identities.

Preserve each chip's shared filter, mono output and ring/sync dependencies. Muting is a labelled intervention, not a guaranteed isolated stem. State-preserving seeking includes CPU, oscillator, envelope and filter history. The design owns detailed contracts and the required stereo/Safari gates.

Local SID opening must remain device-local, including file hashes and metadata lookup. Publish only material with recorded composition, arrangement and player rights. Never commit reference SIDs, private audio, ROMs, secrets or downloaded engines. Hashes and public URLs do not grant rights. Prepare cleared catalog files with verified hashes into ignored deployment assets; [the POC snapshot](docs/integration/poc-sources.md) records source provenance; [the catalog integration](docs/integration/crafter-handoff.md#normalized-catalog-integration) owns its migration to Crafter's producer.

Original work is GPL-3.0-or-later; retain MIT notices for transferred documentation. The POC adopts `libsidplayfp-wasm` 1.1.0 under GPL-2.0-or-later and its SIDLite build. Run asset preparation before a distribution build so the engine license, third-party notices, modifications and complete source accompany it. [Third-party notices](THIRD_PARTY_NOTICES.md) owns the adopted terms; research observations about other candidates do not authorize their reuse.

## Commands and validation

The application uses TypeScript 5.9.3, Vite 7.3.1 and `libsidplayfp-wasm` 1.1.0/SIDLite. [The architecture record](docs/architecture/playback-adapter.md) owns the choice and [the mono validation record](docs/validation/mono-poc.md) and [dual-SID validation](docs/validation/stereo.md) own their separate evidence and gates. Documentation checks additionally require Git and Python 3.10 or newer. Building the modified raw-chip engine requires Docker and Python 3.12 or newer; CI builds it once on Linux and shares the verified artifact with both browser/platform jobs. CI also prepares catalog assets once and shares them across test jobs; each consumer rechecks pinned sizes and hashes through `pnpm prepare:assets` before building.

| Task | Command | Evidence |
| --- | --- | --- |
| Install pinned dependencies | `pnpm install --frozen-lockfile` | Standalone lockfile installation; no sibling source dependency. |
| Build the raw-chip engine | `pnpm prepare:engine` | Pinned source build and real-WASM raw routing/mono equality gate; bounded stages and retained logs in ignored `build/stereo-gate/`. |
| Verify the pinned catalog | `pnpm catalog:check` | Pinned index bytes and runtime equality; [integration contract](docs/integration/crafter-handoff.md#normalized-catalog-integration). |
| Verify composition data and playback timing | `pnpm composition:check` | Pinned Crafter package, catalog binding and engine-bound PCM projection; [composition contract](docs/design/composition-exploration.md). |
| Prepare deployment assets | `pnpm prepare:assets` | Verified sample files and verified custom engine/runtime/license/notices/modifications/complete source in ignored `public/generated/`. |
| Start development | `pnpm dev` | Local Vite application; playback requires user interaction. |
| Check focused software behavior | `pnpm test` | Catalog, engine and timeline guards; no human listening verdict. |
| Build the application | `pnpm build` | Type checking and production output in `dist/`; prepare assets first. |
| Check browser behavior | `pnpm test:browser` | Chrome and macOS WebKit checks after browser installation; not real Safari acceptance. |
| Refresh the README screenshot | `pnpm screenshot:readme` | Build and verify live Rambo playback, then publish the silent Chrome capture; [capture contract](docs/validation/screenshots.md). |
| Check documentation | `python3 scripts/check-docs.py` | Local Markdown targets and heading fragments; external availability excluded. |
| Check patch whitespace | `git diff --check` | Whitespace errors in current changes. |
| Rebuild logo exports | `python3 scripts/render-branding.py` | Raster assets from the selected vector masters; optional tools and visual checks in the [branding guide](assets/branding/README.md). |

Transient browser feedback must use the shared [worker-request gate](tests/browser/worker-control.ts): hold the operation, assert pending UI, release it, then verify real completion or explicit failure. Never synchronize with fixed delays or depend on catching a particular second of advancing playback; poll observable progress instead. [The browser policy guard](tests/browser-policy.test.ts) runs in the unit suite. Keep CPU-heavy engine test files serialized through `pnpm test`, and run them separately from browser emulation. Keep retries disabled; a CI failure requires retained diagnostics and diagnosis before another publication attempt. [The validation record](docs/validation/mono-poc.md#browser-test-synchronization) owns the review and stress-check contract.

Browser automation must be silent: use [the shared test fixture](tests/browser/fixtures.ts), which inserts a zero-gain sink after the analyser and mutes native media. Headless mode alone does not silence WebKit. Do not change system volume for tests.

Use headless Google Chrome for the Chrome target and Playwright WebKit on macOS for automated Safari-engine checks. Linux WebKit is outside the supported matrix; do not spend compatibility work on that port. CI must preserve the browser/platform pairing. Keep real Safari/iOS and human listening claims separate without requiring browser-setting changes to hand off a POC.

Keep all README content left-aligned, including images, buttons and captions; never center it. For README visual changes, show the rendered preview and wait for the user's review before committing or pushing.

Keep README's implemented capabilities separate from product requirements, and retain an executable walkthrough. Update the owning validation record when the runtime, engine, browser or tested behavior changes; distinguish a build or automated WebKit result from real Safari sound and human acceptance.

Use the selected sound-lens identity and its [owning assets](assets/branding/README.md); preserve the distinction from Crafter’s chip silhouette. Record new visual verdicts in that owner and avoid regenerating accepted geometry without a requested change.

## Handoff and bounded execution

For JavaScript/TypeScript work, budget focused tests at 60 seconds and builds at 120 seconds unless a measured exception is documented. Use the runner's native bounded waits and session IDs; poll at most 30 seconds at a time and terminate/reap abandoned processes. Do not increase a budget just to wait longer. Diagnose sustained CPU saturation without progress; silence alone does not prove a hang. Use cancellation/deadlines at risky external-call boundaries.

Before a checkpoint, reconcile durable decisions, relevant rejected alternatives and verification contracts in their owning documents, and update current plan status. Retain reproduction inputs and evidence scope without adding execution chronology. Automate established repeated procedures with explicit inputs, bounded execution and meaningful checks; do not turn agents into a manual scheduler.
