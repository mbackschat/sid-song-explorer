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

The live handoff was verified in headless Chrome `155.0.8059.85` using the [shared silent fixture](../../tests/browser/fixtures.ts), observable UI/message conditions, no retries and a 60-second global limit. No page errors were observed. Download acceptance, trace, video and screenshots were disabled; the SID bytes and short-lived download URL were not persisted. The provider’s attribution remained visible.

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

Explorer integration now has local automated evidence for loading/playback, compatibility/error handling, cancellation and keyboard/focus behavior, narrow layout and attribution, failure recovery and metadata presentation in Chrome/macOS WebKit. Actual Safari/iPhone use and the deployed origin remain unverified; the [integration record](../validation/library-picker.md) owns exact results and the cross-origin Escape limitation. The user subsequently approved separate HVSC duration enrichment; provider-selected subtunes remain outside scope. No engine, cache, voice-switching or local-file privacy change is needed for this feature.


## Session retention follow-up

On 2026-10-20 the user required reuse of search, the current folder and browsing position after closing or choosing a song, with no extra confirmation. The deployed provider script was inspected again and matched the retained source: its local storage covers sort order, while search/folder state remains inside the iframe. Explorer therefore retains the same iframe for the tab session instead of trying to read its cross-origin document or reconstruct private provider state. Explicit library reload or Explorer reload starts fresh.

The [pinned embedding contract](https://github.com/RobertTroughton/SIDquake/blob/20caa381880dacbe01e139c828899f08fb3ac329/docs/EMBED.md) has no request ID, search-state export or selection-start event. Selection awaits token/file retrieval before posting its result. A pre-close request finishing after reopening and a new request from that same frame have identical observable origin, source and payload. Explorer can reject hidden or discarded-frame messages, but cannot distinguish those two cases. Wrappers, receipt-time epochs and guessed delays do not add the missing initiation identity. The [integration validation](../validation/library-picker.md#interaction) owns the resulting lifetime contract and executable evidence.


## HVSC reference lengths

The user approved separate length lookup on 2026-10-20. The official `Songlengths.md5` GET supports cross-origin browser use, whereas a foreign-Origin HEAD returned 403; HEAD alone had been misleading. The [HVSC format FAQ](https://hvsc.brona.dk/HVSC/C64Music/DOCUMENTS/Songlengths.faq) and the pinned engine’s packaged `createMD5New` source establish full original-file MD5 and 1-based subtune lengths, with intended-clock semantics. This is separate metadata, not an intrinsic SID ending. The official database check returned Commando subtunes 1, 2 and 19 as 235.594, 61.288 and 0.824 seconds; an out-of-range subtune returns no length. The [integration record](../validation/library-picker.md#song-lengths-and-stable-fitting) owns implementation boundaries, failure handling and executed checks. Source receipts and the metadata-only research copy remain ignored under `build/songlengths/`; no music was downloaded for this source check.


## Highlight discovery and delivery

The [runtime shortlist](../../src/sid-highlights.ts) owns exact files, models, default subtunes and duration values. It is a curated selection, not a single “top 20” chart. Chip Player JS’s public all-time plays, recent plays and favorites endpoints returned no SID files among the first 100 entries of each list on 2026-10-23; the inspected [chart component](https://github.com/mmontag/chip-player-js/blob/master/src/components/TopCharts.js) and [server](https://github.com/mmontag/chip-player-js/blob/master/server/index.js) supplied no SID-only chart contract. DeepSID's ratings search uses the signed-in user's ratings, not an aggregate popularity chart; its [source documentation](https://github.com/Chordian/deepsid) also attributes folder quality filters to a selected user's ratings.

Classic additions use [LaLa's fan-voted HVSC Top 100](https://www.transbyte.org/SID/HVSC_Top100.html), dated 2000-07-05. These are historical file-level ranks, not modern play counts or ratings of individual subtunes. Current paths and playable defaults are checked against official HVSC bytes. International Karate exceeds the player's ten-minute limit, Delta's default is too short and Arkanoid uses unsupported RSID, so their historical rank does not make them eligible.

| Highlight | Selection evidence |
| --- | --- |
| Wizball | Historical HVSC rank 1. |
| The Last Ninja | Historical HVSC rank 2. |
| Sanxion | Historical HVSC rank 3. |
| Commando | Historical HVSC rank 4. |
| Cybernoid II | Historical HVSC rank 6. |
| Monty on the Run | Historical HVSC rank 8. |
| Cybernoid | Historical HVSC rank 9. |
| Last Ninja 3 | Historical HVSC rank 10. |
| Last Ninja 2 | Historical HVSC rank 12. |
| Mutants | Historical HVSC rank 13. |
| Knucklebusters | Historical HVSC rank 14. |
| Crazy Comets | Historical HVSC rank 16. |
| Ultimate Axel F. | [Exact Nordischsound release](https://csdb.dk/release/?id=228585): 9.6/10 from 21 votes. |
| R-Type: Amiga to 2SID | [Exact Jason Page release](https://csdb.dk/release/?id=228298): first in Game Music Remix Compo 2023; 9.8/10 from 25 votes. |
| Raindropsies | [Exact Shogoon stereo release](https://csdb.dk/release/?id=160314): 9.8/10 from 47 votes. |
| Get Lucky | [Exact Nordischsound stereo release](https://csdb.dk/release/?id=243079): 9.7/10 from 20 votes. |
| Monty on the Run (D'n'B edit) | [Exact MCH remix](https://csdb.dk/release/?id=192902): 9.7/10 from 14 votes; separate from the original's historical rank. |
| Sleepwalk | Retained curated dual-MOS6581 choice; [exact SID record](https://csdb.dk/sid/?id=44891) supplies identity but no usable popularity score. |
| Zoids 2SID-Remake | Retained curated stereo choice; [exact Proton release](https://csdb.dk/release/?id=248190) has insufficient votes for a published score. The original's rank is not transferred to this remake. |
| Ghostbusters | Retained curated mono-MOS8580 choice; [exact Nordischsound SID record](https://csdb.dk/sid/?id=63224) supplies identity but no usable direct tune score. Real Ghostbusters is a different file. |

CSDb scores and vote counts above were observed on 2026-10-23 and are per-release user scores, not invented ordinal ranks. They do not establish duration, compatibility or stereo intent. The [integration validation](../validation/library-picker.md#sid-highlights) owns exact-file duration and engine checks; at least one quarter of the list must be genuine dual-SID stereo, and every advertised default must exceed two minutes. A 2SID filename alone is insufficient: some multi-chip releases explicitly request mono playback.

Official HVSC individual-file GETs return `Access-Control-Allow-Origin: *`; highlights use `https://www.hvsc.c64.org/download/C64Music/`. Chip Player JS's catalog host did not permit the tested localhost request. SIDquake's deep-link parameter previews a tune but does not automatically emit its file-mode selection. Direct official delivery therefore supplies the bounded shortcut without a replacement browser, proxy or catalog mirror. The [HVSC copyright notice](https://www.hvsc.c64.org/info) continues to apply; discovery links and successful playback do not grant publication rights.
