# Raw-chip stereo adoption gate

This bounded experiment adds raw chip output to the pinned `libsidplayfp-wasm` 1.1.0 SIDLite binding. It does not modify the emulator, stock `render()` or production application. The parent [plan](../../../docs/PLAN.md#exit-the-poc-and-continue-production-work) owns adoption and the [design](../../../docs/design/web-player-and-analyser.md#evidence-required-before-adopting-the-stereo-backend) owns completion gates.

## Contract

`SidPlayerContext.renderRaw(cycles: number): Int16Array | null` advances one shared C64 once and interleaves its complete chip buffers in installed-chip order. The channel count is `getInstalledSids()`; `getChannels()` continues to describe the stock mixer. One chip produces mono; two produce left = chip 0, right = chip 1, with unity gain and no crossfeed. The returned array is a borrowed WASM heap view and must be copied before another WASM call. Empty output and failure follow stock `render()` semantics. Callers retain partial blocks when seeking and count frames independently of scalar samples.

## Run

Install the project's pinned dependencies first with `pnpm install --frozen-lockfile`; the runner reads the unmodified source archive directly from that package. Docker and Python 3.12 or newer are required. Use the project's pinned Node 24.18.0 executable with `--node` if it is not the shell default:

```sh
python3 scripts/experiments/stereo/run.py prepare
python3 scripts/experiments/stereo/run.py red --node /path/to/node
python3 scripts/experiments/stereo/run.py toolchain
python3 scripts/experiments/stereo/run.py build
python3 scripts/experiments/stereo/run.py verify --node /path/to/node
```

Preparation verifies the original corresponding-source archive and published synthetic smoke fixture by SHA-256, then applies the additive binding and declaration changes. The original archive omits the fixture path required by its Dockerfile; preparation restores the same npm-distributed fixture and retains its generating source. Dependency source trees remain pristine, including their bundled submodules. The output directory receives an ESM package declaration before the upstream smoke importer runs; upstream otherwise writes it only after smoke verification. The upstream thread/write-hook patches and compiler flags remain in effect.

Toolchain setup downloads Emscripten 3.1.74 and operating-system build dependencies into a project-specific Docker image. Image download and package setup are separate stages, each capped at 120 seconds, so a cold environment does not depend on a retry. The pinned image targets amd64, including when the host is arm64. Compilation runs offline against the verified archive trees. Each bootstrap/compile/link phase has a 120-second deadline; each configure phase has a 240-second deadline under the measured exception below, and verification has a 60-second deadline. Completed phases and their exact input fingerprints persist in `build/stereo-gate/compiler`; a later invocation skips only successfully completed phases with identical inputs. Logs, prior failed logs, generated modules, complete modified source and hash provenance remain in ignored `build/stereo-gate/`. A timed-out phase removes only its own named container and retains the mounted intermediate files. The runner never prunes images or touches unrelated containers.

On 2026-10-20, cold amd64 toolchain setup on the arm64 Mac exhausted 120.01 seconds after 90.6 seconds downloading/extracting image layers and 27 seconds of package setup. Reusing the cached layers completed setup in 93.37 seconds. A monolithic compiler run then exhausted 120.18 seconds while advancing through its first library's configuration: 78 progress checks had completed, with 53 remaining static check sites after the observed C++ preprocessor section. Separating bootstrap, configure, compilation and linking preserves completed work. The first separate configuration exceeded an initial 180-second estimate after 109 checks, at generated configure line 22238/25543; source inspection found 14 remaining static check sites. At the observed 1.65 seconds per progress check, those imply approximately 23 further seconds plus configuration output. The final 240-second configure budget allows that bounded remaining work and a small margin. This exception applies to native cross-toolchain configuration, not application builds or tests.

## Oracle and evidence limits

The red guard requires the shipped binding to lack the raw API and rejects its crossfed stereo output against separately rendered mono. Generated callable PSIDs activate chip A or chip B while leaving the other oscillator inactive. Relocating absolute SID operands preserves instruction timing. Both MOS6581 and MOS8580 must produce the independent mono samples at unity gain in the assigned channel and independently rendered shipped idle-mono samples in the other. SIDLite preserves a DC offset on its idle bus; zeroing volume also introduces a digi transient, so literal zero is not the native idle oracle. The PSID driver writes chip 0 volume before calling tune init, which the trace guard explicitly permits. The same oracle rejects swapped, attenuated, duplicated and crossfed output mutations.

The green guard executes the modified WASM, checks chip-indexed writes/registers, compares raw mono with stock mono and the rebuilt stock mono with the shipped WASM, then verifies continuation after a non-block-aligned frame boundary using the retained remainder. These synthetic checks establish a binding/output contract, not browser channel delivery, arbitrary-song compatibility, full-song endings, complete state snapshots, Safari usability or human listening acceptance.

The generated source bundle includes `EXPLORER-REBUILD.md` with standalone Docker commands and all modified inputs. `output/provenance.json` fingerprints the produced module, binary, declaration, licensing files and corresponding source, plus the binding patch and build runner. The green receipt binds that exact provenance and the executing verifier by SHA-256. `output/result.json` exists only after a successful green gate; the runner removes an earlier receipt before preparing, rebuilding or verifying.

Compiler containers can leave root-owned metadata in the runner-owned output directory. Packaging atomically replaces those files through the writable directory, preserving the old file if copying fails; it does not require changing ownership or compiler permissions. The Docker-free [bundle tests](../../../tests/engine_bundle_test.py) cover protected destinations, failed copies and unchanged runtime bytes.
