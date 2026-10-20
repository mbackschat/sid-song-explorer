# Online SID library picker

Research date: 2026-10-20. This record owns source comparisons, provider evidence and the limits of the integration check. [Plan item `LIBRARY-1`](../PLAN.md#online-sid-library-picker-library-1) owns the interaction and completion gates. The [integration validation](../validation/library-picker.md) tracks the subsequently authorized Explorer implementation.

## Goal and recommendation

Keep Explorer focused on playback and analysis. The user wants an existing library interface to own browsing, search and selection, followed by direct loading of the chosen SID and available metadata into Explorer. Manual download followed by local file opening is explicitly rejected. Building or maintaining another catalog browser/search interface is outside scope.

Recommend SIDquake’s hosted HVSC picker. Its documented file-transfer mode and a successful live browser check establish the required handoff without an Explorer backend, library mirror or provider-side code change. This supersedes the preliminary DeepSID recommendation, which lacked a verified selection-return interface.

Local **Open SID** remains a separate, device-local action. Choosing an online library must not cause local files, hashes or metadata to be sent to that library.

## Sources considered

| Source or browser | Finding | Decision |
| --- | --- | --- |
| [HVSC](https://hvsc.c64.org/) | Authoritative SID collection with official search, downloads, SID metadata, STIL and songlength datasets. Release #85 lists 61,157 SIDs. | Use through the selected provider; do not maintain a second library service. [Release notes](https://hvsc.brona.dk/HVSC/C64Music/DOCUMENTS/Update85.hvs). |
| [SIDquake](https://sidquake.c64demo.com/) | Explicitly offers its existing HVSC browser as an iframe picker that transfers selected file bytes and metadata. | Recommended; live handoff verified below. [Embedding guide](https://github.com/RobertTroughton/SIDquake/blob/20caa381880dacbe01e139c828899f08fb3ac329/docs/EMBED.md). |
| [DeepSID](https://deepsid.chordian.net/) | Rich discovery and metadata interface over HVSC and other collections. The inspected current source, documentation and issue/PR descriptions did not establish an external picker callback. | Useful reference, but would need provider cooperation for the required handoff. [Pinned selection implementation](https://github.com/Chordian/deepsid/blob/dc28bcb1f70bf146b3724418b6826ff90e82633f/js/browser.js), [external metadata API](https://github.com/Chordian/deepsid/blob/dc28bcb1f70bf146b3724418b6826ff90e82633f/api/v1.php). |
| [Chip Player JS](https://chiptune.app/) | Owns a searchable multi-format catalog and HVSC mirror. Its share links address its own player; no external selection-return contract was found in the inspected application/docs. | No ready picker integration found. [Pinned application](https://github.com/mmontag/chip-player-js/blob/e90f505ccea598fb91cf08b02c4dbb41f0785632/src/components/App.js), [selected-file loading](https://github.com/mmontag/chip-player-js/blob/e90f505ccea598fb91cf08b02c4dbb41f0785632/src/Sequencer.js). |
| CGSC, CSDb and SOASC | CGSC introduces MUS/STR formats; CSDb supplies scene/release context; SOASC supplies rendered recordings rather than the executable SID input needed for inspection. | No additional source integration in this scope. [DeepSID collection setup](https://github.com/Chordian/deepsid), [CSDb webservice](https://csdb.dk/webservice/), [SOASC](https://www.6581-8580.com/). |

Earlier header checks found cross-origin access obstacles on DeepSID and Chip Player endpoints; official HVSC metadata GETs permitted cross-origin reading, but its tested download HEAD requests did not establish usable delivery. Those bounded observations do not prove that all providers reject all browser GETs. More importantly, a proxy alone would not supply the missing selection-return interface. SIDquake’s intentionally supported transfer from its own iframe resolves both requirements for the tested selection.

## SIDquake integration surface

Reviewed provider revision: [`20caa381880dacbe01e139c828899f08fb3ac329`](https://github.com/RobertTroughton/SIDquake/tree/20caa381880dacbe01e139c828899f08fb3ac329). The hosted widget is `https://sidquake.c64demo.com/hvsc-embed.html`. It requires `mode=file` and the exact parent `origin`; the browsing-only setup uses `autoplay=0`, `player=0` and `viz=0`. The documented `q` parameter can seed a search. [Embedding contract](https://github.com/RobertTroughton/SIDquake/blob/20caa381880dacbe01e139c828899f08fb3ac329/docs/EMBED.md).

The provider retrieves the selected file on its own origin and transfers its `ArrayBuffer` to the parent through `postMessage`, with message type `hvsc:selected` and mode `file`. The payload includes `name`, `path`, `url`, `title`, `author`, `released` and `stil`. Explorer can consume the bytes directly; it need not fetch the returned URL. [Pinned message implementation](https://github.com/RobertTroughton/SIDquake/blob/20caa381880dacbe01e139c828899f08fb3ac329/public/hvsc-browser.js).

The embedded payload does not include a chosen subtune, songlengths or detailed SID header configuration. The selected file remains the source for header information and existing playback compatibility checks. STIL is contextual library text, not an Explorer-verified musical annotation; it can be empty. The embed permits RSID selections, which does not imply Explorer can play every offered file. [Pinned selection and format handling](https://github.com/RobertTroughton/SIDquake/blob/20caa381880dacbe01e139c828899f08fb3ac329/public/hvsc-browser.js).

The live embed page returned HTTP 200 without an observed framing restriction. Its deployed `hvsc-browser.js` matched the reviewed revision byte-for-byte, SHA-256 `cb8257ae5b6744752d9a26957ea9cad1db6582c3a687dbb763a370e78a4b5d63`. This dated observation does not pin the hosted service for future sessions. [Live script](https://sidquake.c64demo.com/hvsc-browser.js), [provider hosting configuration](https://github.com/RobertTroughton/SIDquake/blob/20caa381880dacbe01e139c828899f08fb3ac329/netlify.toml).

## Executed handoff check

On 2026-10-20, a separate local parent page embedded the live widget with its actual localhost origin, file mode and the initial query `commando`. The test selected Rob Hubbard’s result through the existing widget UI and clicked its Select button. The parent accepted only messages from `https://sidquake.c64demo.com` whose sending window matched the embedded frame.

One silent headless Google Chrome test passed in 5.9 seconds using Chrome `155.0.8059.85`, Node.js 24.18.0, pnpm 11.20.0 and the [shared silent fixture](../../tests/browser/fixtures.ts). The test used observable UI/message conditions, no retries and a 60-second global limit. It reported no page errors. Download acceptance, trace, video and screenshots were disabled; the SID bytes and short-lived download URL were not persisted. The provider’s attribution remained visible.

| Received fact | Observed value |
| --- | --- |
| Message | `hvsc:selected`, mode `file`; expected origin and frame |
| File | `Commando.sid`, `ArrayBuffer`, 4,165 bytes |
| Collection path | `C64Music/MUSICIANS/H/Hubbard_Rob/Commando.sid` |
| Header decoded in parent | PSID v2, data offset 124, 19 subtunes, default song 1 |
| Title / author / release | Commando / Rob Hubbard / 1985 Elite |
| STIL | String field present, empty for this selection |

This proves an actual selected SID and basic metadata crossed from the existing hosted search interface to a foreign parent page without manual file transfer. It does not prove Explorer loading/playback, the final deployed Explorer origin, Safari/iPhone behavior, nonempty STIL display, or compatibility with the whole collection.

The local harness, configuration, run log and metadata-only receipt remain in ignored `build/sid-library-research/picker-live-check/`; exploratory notes remain under `build/sid-library-research/research_notes/`. These are local working evidence, not committed artifacts. The table above preserves the decisive result for other checkouts. To reproduce, embed the live widget in a foreign-origin parent with the documented flags, perform the same UI selection, validate the sender and inspect the received buffer/header without saving the music file. Keep this external-service smoke check separate from deterministic integration tests.

## Provider terms and ownership

SIDquake expressly permits embedding its supplied iframe with its credit and the HVSC link visible and unobstructed. Its terms prohibit scraping, bulk downloading and rehosting its files or index; the described use is private listening/discovery. The service is supplied without an availability guarantee and may change, be limited or withdrawn. [Live embed terms](https://sidquake.c64demo.com/embed-terms.html), [reviewed terms revision](https://github.com/RobertTroughton/SIDquake/blob/20caa381880dacbe01e139c828899f08fb3ac329/public/embed-terms.html).

Embedding permission does not grant music rights. HVSC likewise states that the tunes remain copyrighted and that it cannot grant music-use licences. User-selected library files are not additions to Explorer’s publication-cleared sample catalog. No mirroring, bundled library, public recording publication or provider contact occurred during this investigation. [HVSC notice](https://hvsc.c64.org/info).

## Integration boundary and remaining evidence

Explorer owns the dialog, a bounded message receiver, existing SID loading and credited metadata display. SIDquake continues to own discovery, search, its index and file delivery. The receiver must validate origin, sending frame, message shape, file size and current dialog lifetime before loading; provider text must remain inert text. Closing or reopening the dialog must not allow an obsolete selection to replace the current tune.

Explorer integration now has local automated evidence for loading/playback, compatibility/error handling, cancellation and keyboard/focus behavior, narrow layout and attribution, failure recovery and metadata presentation in Chrome/macOS WebKit. Actual Safari/iPhone use and the deployed origin remain unverified; the [integration record](../validation/library-picker.md) owns exact results and the cross-origin Escape limitation. Durations or provider-selected subtunes would require a separate scope decision. No engine, cache, voice-switching or local-file privacy change is needed for this feature.
