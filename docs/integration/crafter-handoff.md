# Crafter handoff and shared knowledge

The user authorized the standalone sibling and public repository on 2026-10-18 and confirmed **SID Song Explorer** (`sid-song-explorer`). This completes the documentation-only repository step of the founding design. Application implementation remains the next milestone.

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

The normalized catalog is **not implemented**. Crafter's first integration task is schema version 1 with a rights-cleared Rambo loader main-music entry and validation. It must describe variants, downloadable files and SHA-256 hashes, clock/chip/model/address/routing configuration, attribution/rights/license, publication scope, scoped listening verdicts and links to owners. The [founding ownership contract](../design/web-player-and-analyser.md#project-identity-and-repository-boundary) and [analysis-package semantics](../design/web-player-and-analyser.md#analysis-packages-and-evidence) remain authoritative; no competing JSON schema is introduced here.

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

For a shared-format change, first agree the producer/consumer contract and its compatibility boundary. Verify the producer’s output and the consumer against the same version. Advance Explorer’s pin only to the intended available Crafter revision after its bytes and schema pass validation; never hide a local sibling dependency in the normal build. An explicit local source override may support development when the consumer implements it, but is not an existing command or permission to bypass hashes. Publishing one repository does not automatically authorize pushing the other.

Keep musical/engine knowledge with its existing Crafter owner and browser integration decisions here. The catalog and analysis-package implementation remains future work; coordinating the workspace does not itself begin the playable prototype.
