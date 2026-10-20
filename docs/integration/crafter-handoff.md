# Crafter handoff and shared knowledge

The user authorized the standalone sibling and public repository on 2026-10-18 and confirmed **SID Song Explorer** (`sid-song-explorer`). This completes the documentation-only repository step of the founding design. The application and mono/dual-SID acceptance are recorded in [the current plan](../PLAN.md).

## Transferred material

Source: [SID Song Crafter at `3db086b`](https://github.com/mbackschat/sid-song-crafter/tree/3db086b6963676ef75f34d7f77c3b67232a777fb). This public commit is the immutable provenance and default knowledge pin for the handoff.

| Crafter source | Explorer owner | Treatment |
| --- | --- | --- |
| `docs/proposals/web-player-and-analyser.md` | [Founding design](../design/web-player-and-analyser.md) | Moved; status and identity reconciled for repository creation. |
| `docs/research/tools/web-music-explorers.md` | [Application research](../research/web-music-explorers.md) | Moved; dated findings and source citations retained. |
| `LICENSE` | [Crafter MIT notice](../../LICENSES/sid-song-crafter-MIT.txt) | Copied verbatim for transferred documentation. |

Links between the moved documents now stay within Explorer. Other Crafter-relative links resolve to the public source commit, including historic plan and license references; they never require the sibling directory. The old Crafter paths retain short forwarding stubs. [The transfer manifest](../../provenance/crafter-handoff.json) records source hashes and paths. Engine facts already owned by Crafter stay there; the moved source reviews retain their historical evidence scope.

The repository starts with new Git history. No application/player code, score, SID/PRG/WAV, archive, downloaded skill, local configuration, credential or unrelated untracked file was transferred. Contributor conventions were adapted, not copied wholesale from Crafter's large musical case guide.

## Shared knowledge recommendation

**Keep the knowledge in Crafter and consume versioned data.** This is sufficient for two independent repositories without a third repository, submodule, backend or duplicate research corpus.

| Owner | Responsibility |
| --- | --- |
| Crafter | Composition/export tools, instrument programs, musical studies, evidence, scoped listening verdicts, sample generation and publication decisions. |
| Explorer | Browser playback integration, transport, inspection UI, Safari verification, catalog presentation and deployment. |
| Crafter producer → Explorer consumer | A versioned normalized catalog and optional analysis packages, tied to exact sample identities and evidence. |

The Crafter-owned version-1 normalized producer is published and Explorer consumes its verified index. The migration preserves the existing six playable entries, four materials links, 21 prepared files and three hash-bound mono Rambo annotations. The runtime catalog preserves the preceding snapshot exactly. [Catalog integration](#normalized-catalog-integration) owns the pin, checks and update procedure. The [founding ownership contract](../design/web-player-and-analyser.md#project-identity-and-repository-boundary) and [analysis-package semantics](../design/web-player-and-analyser.md#analysis-packages-and-evidence) retain their scope; durable generation of new musical analysis packages is not part of this migration.

Explorer should pin a catalog version or Crafter revision, verify each fetched file's hash, and place cleared assets only in generated deployment output. Unknown-rights entries can link to source recipes without playable uploads. A withdrawal takes effect on the next pin update and redeployment, not retroactively across already published pins. Label generic live measurements as Explorer-derived; do not equate them with Crafter execution evidence without a verified shared implementation.

**Defer shared code extraction until there are two real consumers.** Keep browser binding changes here initially and prefer upstream contributions where practical. If both repositories later need the same pure schema validator or analysis algorithm, extract a small versioned package with explicit license, tests and compatibility policy. Do not extract the whole knowledge base or synchronize document copies: those add maintenance without an established consumer need.

## Useful pinned knowledge routes

- [Technique lookup](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/technique-index.md): find the owning SID studies before researching again.
- [Audio workflow](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/workflows/audio-workflow.md): native renderer, stereo crossfeed and muting findings.
- [Dual-SID hardware and mixing](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/sid/dual-sid.md): chip outputs, shared resources and arrangement routing.
- [Rambo decoded programs](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/composition/instruments/rambo-decoded-programs.md): first-prototype musical annotations and reuse examples.
- [Sample library](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/README.md): available packages and their actual scope.
- [Publication boundary](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/workflows/publication-boundary.md): source/music/player clearance requirements.

Update pins deliberately when consuming new findings. New application observations belong in Explorer; new general chip/composition findings should be contributed to Crafter's existing owner and linked back, preserving execution and listening evidence separately.

## Coordinated development

The user explicitly authorized working across both repositories in one session on 2026-10-18, treating them as one working context while retaining separate repositories. A local sibling checkout is optional. Read both guides, name the owner of each change, run the affected checks in each repository and make separate coherent commits. Report each repository’s commit and publication status independently.

For a shared-format change, first agree the producer/consumer contract and its compatibility boundary. Verify the producer’s output and the consumer against the same version. Advance Explorer’s pin only to the intended available Crafter revision after its bytes and schema pass validation; never hide a local sibling dependency in the normal build. The explicit local source override described below supports development without bypassing hashes. Publishing one repository does not automatically authorize pushing the other.

Keep musical/engine knowledge with its existing Crafter owner and browser integration decisions here. The normalized catalog migration does not authorize new musical content, broader analysis packages or publication of either repository.

## Composition package integration

On 2026-10-20 the user separately authorized composition exploration across both repositories. Crafter's headless producer exports the bounded Rambo mono sidecar; [the composition design](../design/composition-exploration.md) owns the user experience and [the validation record](../validation/composition-exploration.md) owns evidence. This leaves the version-1 catalog and accepted SID files unchanged.

- [Producer pin](../../config/composition-pin.json): Crafter commit `259e7fa4407f954bef360c092379bc0bd211aa66`, `samples/composition/rambo-main.json`, exact size and digest.
- [Vendored package](../../config/composition.json): byte-identical producer output, referencing the existing published musical-source revision independently.
- [Importer](../../scripts/import-composition.ts) and [consumer contract](../../src/composition-package.ts): exact-input verification, strict version/field/reference/time checks and binding to the catalog file/profile.
- [PCM timing projection](../../src/composition-time.ts) and [calibration](../../config/composition-timing.json): Explorer-owned conversion from source calls to the adopted engine's timeline; package/engine/adapter changes invalidate the calibration.

Normal `pnpm dev` and `pnpm build` run `pnpm composition:check` offline. They use the vendored package and existing prepared engine, with no sibling checkout dependency. A local producer update is explicit:

```sh
node --experimental-strip-types scripts/import-composition.ts --pin config/composition-pin.json --catalog config/catalog.json --source-root ../sid-song-crafter --output config/composition.json
pnpm composition:calibrate
pnpm composition:check
```

Update the pin from a verified Crafter checkpoint before import; an input override never bypasses its bytes/hash. Omitting `--source-root` fetches the immutable producer URL. Verify that the pinned producer is publicly available before releasing its Explorer consumer. Existing evidence links use the independently pinned musical source revision.

The package's `source-call-grid` seconds are canonical nominal composition coordinates. Runtime projection changes only display/listening coordinates, retaining the source calls and original package bytes. Musical roles, exact program states and physical allocations remain separate; unsupported exports and profiles receive generic inspection.

## Normalized catalog integration

Crafter's [version-1 producer contract](https://github.com/mbackschat/sid-song-crafter/blob/0b51d387ca7660d9563e68ae5cde1db65aabfff4/docs/workflows/catalog.md) owns the normalized schema. The [producer pin](../../config/catalog-pin.json) identifies the Crafter commit, index path, exact byte count and SHA-256. The [vendored index](../../config/catalog-index.json) contains those exact bytes. Its `source.revision` separately identifies the original assets and evidence: publishing a producer does not rebase existing musical provenance. [The adapter](../../src/producer-catalog.ts) validates the producer contract and derives the existing [runtime catalog](../../config/catalog.json), which continues through the runtime parser. The frozen [migration oracle](../../tests/fixtures/catalog-migration.json) establishes exact semantic equality with the preceding snapshot, including order and default selection.

The pinned producer revision is public and its fetched index passed byte/hash verification and exact runtime comparison on 2026-10-20. `pnpm catalog:check` checks the vendored bytes and adaptation against the runtime catalog without a sibling checkout or network. Development and production builds run that check before Vite; sample preparation performs the same check before preparing any files, including when its CLI is called directly. Publication requires explicit authorization separately for each repository.

```sh
pnpm catalog:check
node --experimental-strip-types scripts/import-catalog.ts --pin config/catalog-pin.json --output config/catalog.json --check
```

The second command fetches the immutable producer URL and is the availability check after producer publication. An explicit `--index FILE` or `--source-root DIR` substitutes local bytes under the same byte/hash checks; the two options are mutually exclusive. Without `--check`, the importer writes the adapted runtime JSON atomically. With `--check`, it compares parsed contents and never rewrites the output. Normal builds must not depend on an optional local Crafter checkout.

Index verification precedes UTF-8 decoding, JSON parsing and adaptation. The consumer rejects unsupported versions, unknown fields, unsafe paths, inconsistent identities, publication/delivery mismatches and incompatible chip routing. Downloads reject redirects and have a 30-second deadline covering response and body reads; the index is bounded to 2 MiB. [The shared verified-input helper](../../scripts/verified-input.ts) also serves sample preparation, retaining the 25 MiB prepared-asset ceiling and decoded-body hash checks. Link-only assets carry fingerprints in the index but are never prepared for deployment. Materials-only entries have no playable files.

Updates start in Crafter's curator input, with generation, source-owner checks and producer validation. Publish the reviewed producer checkpoint, verify its index bytes, then update Explorer's pin and vendored index together, regenerate the runtime catalog and run compatibility/preparation checks. A changed migration baseline requires an explicit catalog scope decision; it is not a fixture to refresh automatically. Defer shared schema-package extraction until actual reuse warrants it.

### Migration verification

Producer guards verify deterministic generation, source hashes, owner paths/fragments, listening manifests and PSID targets against pinned Git data. Explorer's catalog/import/preparation guards reject license-owner mismatches, duplicate JSON keys, record-bound violations and filename aliases. The actual producer index adapts exactly to the frozen runtime oracle; the runtime file is byte-identical to that oracle.

`pnpm catalog:check`, the production build and sample preparation exercise the same pin without a sibling checkout. A CLI regression changes the runtime title and requires direct sample preparation to reject the drift before writing assets. Isolated-source checks supply explicit local sample bytes, so a nearby Crafter checkout cannot mask a dependency.

The immutable public index was fetched and verified against the pinned SHA-256 with exact runtime equality on 2026-10-20. This establishes availability at that date; normal builds use vendored bytes and do not depend on continued network availability. Producer validation remains local because Crafter has no configured CI workflow. These catalog/preparation checks add no browser, audio or listening claim.
