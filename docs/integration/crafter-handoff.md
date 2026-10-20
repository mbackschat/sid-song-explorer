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

The Crafter-owned version-1 normalized producer and Explorer consumer are implemented locally. The migration preserves the existing six playable entries, four materials links, 21 prepared files and three hash-bound mono Rambo annotations. The producer/index publication is pending; the current runtime catalog remains unchanged. [Catalog integration](#normalized-catalog-integration) owns the candidate, checks and activation gate. The [founding ownership contract](../design/web-player-and-analyser.md#project-identity-and-repository-boundary) and [analysis-package semantics](../design/web-player-and-analyser.md#analysis-packages-and-evidence) retain their scope; durable generation of new musical analysis packages is not part of this migration.

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

## Normalized catalog integration

Crafter's [version-1 producer contract](https://github.com/mbackschat/sid-song-crafter/blob/0b51d387ca7660d9563e68ae5cde1db65aabfff4/docs/workflows/catalog.md) owns the normalized schema (link available after publication). The [producer pin](../../config/catalog-pin.json) identifies the Crafter commit, index path, exact byte count and SHA-256. The [vendored index](../../config/catalog-index.json) contains those exact bytes. Its `source.revision` separately identifies the original assets and evidence: publishing a producer does not rebase existing musical provenance. [The adapter](../../src/producer-catalog.ts) validates the producer contract and derives the existing [runtime catalog](../../config/catalog.json), which continues through the runtime parser. The frozen [migration oracle](../../tests/fixtures/catalog-migration.json) establishes exact semantic equality with the preceding snapshot, including order and default selection.

The current pin is an unpublished local candidate. `pnpm catalog:check` checks its bytes and adaptation against the unchanged runtime catalog without a sibling checkout or network. The normal build and sample preparation continue to use the existing public asset snapshot until the pinned producer revision is available publicly and the fetched index passes the same check. Publication requires explicit authorization separately for each repository.

```sh
pnpm catalog:check
node --experimental-strip-types scripts/import-catalog.ts --pin config/catalog-pin.json --output config/catalog.json --check
```

The second command fetches the immutable producer URL and is the availability check after producer publication. An explicit `--index FILE` or `--source-root DIR` substitutes local bytes under the same byte/hash checks; the two options are mutually exclusive. Without `--check`, the importer writes the adapted runtime JSON atomically. With `--check`, it compares parsed contents and never rewrites the output. Normal builds must not depend on an optional local Crafter checkout.

Index verification precedes UTF-8 decoding, JSON parsing and adaptation. The consumer rejects unsupported versions, unknown fields, unsafe paths, inconsistent identities, publication/delivery mismatches and incompatible chip routing. Downloads reject redirects and have a 30-second deadline covering response and body reads; the index is bounded to 2 MiB. [The shared verified-input helper](../../scripts/verified-input.ts) also serves sample preparation, retaining the 25 MiB prepared-asset ceiling and decoded-body hash checks. Link-only assets carry fingerprints in the index but are never prepared for deployment. Materials-only entries have no playable files.

Updates start in Crafter's curator input, with generation, source-owner checks and producer validation. Publish the reviewed producer checkpoint, verify its index bytes, then update Explorer's pin and vendored index together, regenerate the runtime catalog and run compatibility/preparation checks. A changed migration baseline requires an explicit catalog scope decision; it is not a fixture to refresh automatically. Defer shared schema-package extraction until actual reuse warrants it.


### Migration verification

On 2026-10-20, Crafter's 16 focused producer tests and deterministic regeneration passed; source hashes, owner paths/fragments, listening manifests and PSID targets were checked against pinned Git data. Explorer's 31 catalog/import/preparation tests passed on Node.js 24.18.0 after red guards reproduced missing validation for license ownership, duplicate JSON keys, record bounds and filename aliases. Independent review found those issues resolved. The actual producer index adapts to the frozen runtime oracle exactly; the runtime file itself is byte-identical to that oracle.

`pnpm catalog:check`, the production build (including TypeScript), documentation and whitespace checks passed. The normal sample preparation command reverified all 21 existing generated assets through the shared verifier without a sibling checkout. This is local catalog/build evidence; it neither proves public index availability nor adds browser/audio/listening claims. Producer commit `0b51d387ca7660d9563e68ae5cde1db65aabfff4` is committed locally and awaits publication authorization before activation.
