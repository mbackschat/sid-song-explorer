# Online SID library picker validation

[`LIBRARY-1`](../PLAN.md#online-sid-library-picker-library-1) integrates SIDquake's HVSC browser. [The research record](../research/sid-library-picker.md) owns provider comparison, the reviewed protocol and terms; this record owns Explorer's integration oracles and evidence boundaries.

## Interaction

Choose **Browse SID library** beside **Open SID file**, search in SIDquake's dialog, choose a result and press **Select**. Explorer closes the dialog, loads the SID and shows its title, author and release. Press **Play** to start playback. **Library info** beside the song description opens a popup with the credited collection path and available STIL text, without moving the player. Escape, clicking outside or the close button dismisses it. Loading another tune closes it and clears previous provenance. Subtune, clock and chip-model controls use the existing loader.

The provider loads only when its dialog opens. The same iframe stays mounted while hidden, preserving search, folder, results and scroll position across closing, selection and reopening within the Explorer tab. Explorer reload resets the session; provider state is not serialized. Local opening initiates no provider lookup and sends no files, hashes or metadata. Selection failures retain the browser; **Reload library** starts a fresh provider frame while local opening remains available.

Close preserves the current tune. Hidden-frame messages are ignored, and discarded frames cannot load files. SIDquake supplies neither a request ID nor a selection-start event: a pre-close request that completes after reopening the same frame is indistinguishable from a new selection. The user prioritized retained state without another confirmation on 2026-10-20. No timer or focus heuristic claims cancellation that this protocol cannot establish.

Use **Close** to cancel. Escape closes the dialog while focus is in Explorer; Chrome checks establish that Escape inside the cross-origin iframe does not reach the parent. SIDquake has no cancellation-message contract. Native keyboard traversal differs across browsers, so no uniform shortcut from inside the widget is promised. Guards cover initial focus/Escape, Close after iframe focus and restored launcher focus.

SIDquake owns search, collection navigation and delivery. Explorer adds no index, proxy, accounts or persistent music downloads. Provider metadata is bounded inert text; returned download URLs/tokens are discarded. Selected files do not become publication-cleared assets or verified annotations. Provider payloads supply neither durations nor a selected subtune; [HVSC reference lengths](#song-lengths-and-stable-fitting) are separate metadata.

The iframe uses the provider's documented `path=0` option because its narrow-layout path row otherwise pushes Select outside the viewport. Explorer still shows the selected path in Library information and preserves SIDquake/HVSC attribution. The [pinned embedding guide](https://github.com/RobertTroughton/SIDquake/blob/20caa381880dacbe01e139c828899f08fb3ac329/docs/EMBED.md#chrome) owns that option. The browser oracle checks visibility before clicking, because automatic click scrolling can conceal overflow.

## Verification boundaries

[Receiver unit guards](../../tests/library-picker.test.ts) exercise active-frame/origin checks, payload types and bounds, optional metadata, ignored URLs, cancellation/focus, stale messages, startup timeout, retry and disposal. [Browser guards](../../tests/browser/library-picker.spec.ts) use an actual cross-origin iframe and distinct cleared Rambo/Bach files through [the provider fixture](../../tests/browser/library-picker-fixture.ts), without depending on hosted SIDquake.

Deterministic checks cover lazy load, retention/reload, cancellation during playback, narrow layout, attribution, pending loader feedback, plain-text and SID-header metadata, local/catalog replacement, wrong senders, obsolete frames, drop supersession, unsupported profiles and service failure/retry. Pending feedback uses [the shared worker gate](../../tests/browser/worker-control.ts). The fixture initializes handlers before enabling buttons and exercises real silent playback so teardown verifies actual zero-gain sinks. Failed picker checks retain bounded trusted-pointer/focus events and received message types, distinguishing input delivery from selection handling without recording file bytes.

Pointer selection waits for trusted pointer movement to reach the target button inside the cross-origin frame before sending one native mouse press/release. A successful automation click acknowledgement alone does not establish delivery: captured Chrome events can target the parent iframe element while the child receives nothing after showing the dialog, on either initial opening or reuse. The [provider fixture](../../tests/browser/library-picker-fixture.ts) polls actual child delivery during hover; it does not retry selection, synthesize DOM clicks, disable browser protections or change production behavior. Selection receipt and resulting playback/error state remain separate required assertions.

Live-provider smoke checks search for Rob Hubbard's **Commando**, select it through SIDquake, then require advancing playback and nonzero PCM. Use the shared silent fixture with trace/video/download capture disabled; do not persist SID bytes or token URLs. UI captures and metadata-only receipts may be retained under ignored `build/library-picker/`. A localhost result does not establish the deployed-origin workflow or provider availability/performance.

## Executed integration evidence

On 2026-10-20 live checks passed in Chrome `155.0.8059.85` and macOS Playwright WebKit `26.0`: real Commando selection loaded its Rob Hubbard / 1985 Elite metadata and 19 subtunes, with advancing heard position, nonzero PCM and no page errors. At 1440 and 390 pixels, Select and SIDquake/HVSC attribution were visible. Music stayed in browser memory; retained output was limited to UI captures, sanitized request timings and metadata receipts.

Actual Safari, recent-iPhone and deployed-origin acceptance remain separate gates. [Earlier stereo acceptance](stereo.md#device-acceptance) does not establish this third-party workflow. These records describe executed scope, not the current commit's CI status.

## Retained browser session follow-up

Lifecycle guards require one iframe, retained query/folder/results scroll across Close and selection, hidden-message rejection, explicit reload invalidation, failure recovery and reset after Explorer reload. Readiness received while hidden settles the original startup deadline; reopening cannot extend it. Disposal removes the frame, timer and listeners. The guards ran in Chrome and macOS WebKit on 2026-10-20.

Live retention checks on the same date navigated to `MUSICIANS/H`, closed/reopened with the folder intact, searched for Commando, retained the query through close/reopen, loaded and silently played it, then reopened with results present. Each observed one iframe request, no page errors and visible attribution/Select at desktop and narrow widths. This is localhost automation, separate from Safari/iPhone and hosted-origin acceptance.

Provider updates can independently repaint results and clear selection: completion of `hvsc-stil.json` reruns `runSearch()` and clears `currentSelection`. The live harness waits for parsed STIL entries through the provider's read-only index accessor before selecting, without delays or modifying provider state. It checks query, folder, results and single-frame reuse; it does not claim that Explorer freezes provider updates. The deterministic fixture separately checks that closing/reopening preserves scroll.

## Separate pre-existing finding

[Application startup](../../src/main.ts) disposes the player on `pagehide`, including navigation into the back/forward cache; returning may restore a disposed player. The picker closes on `pagehide` without permanently disposing its controls. Changing the player's navigation lifecycle remains outside `LIBRARY-1`.

## Song lengths and stable fitting

Library loads optionally obtain a reference duration from the [official HVSC database](https://hvsc.c64.org/download/C64Music/DOCUMENTS/Songlengths.md5). Original bytes are hashed locally with MD5 and matched to the one-based subtune using `SonglengthDatabase`. Hashing bytes after the engine changes the start-song header would break lookup after a subtune change; [lookup guards](../../tests/song-lengths.test.ts) use Node's independent MD5 implementation.

Only library loads invoke lookup. The fixed database GET has no song/path/hash query and omits credentials/referrer. One in-flight/successful parsed database is shared per tab. Local files do not fetch or use it, even after library selection or when bytes match a known entry. HTTP errors, timeout, invalid data, absent entries, incompatible clock overrides and lengths outside the positive 600-second range fall back to unknown. A later explicit library load can retry failures. Download/body handling has an eight-second deadline, eight-MiB bound and cancellation on oversized/invalid streams. No database is bundled or mirrored.

The source measurement on 2026-10-20 found a CORS-enabled GET of 5,205,150 bytes and 61,157 entries, with HTTP caching disabled. One Node 24.18.0 parse took 174.616 ms; this is a one-time metadata cost, not browser frame-time evidence. The production JavaScript increase measured approximately 7.7 kB uncompressed / 3.2 kB gzip for lookup/parsing/MD5; audio emulation was unchanged.

Known duration uses **Fit song**. Unknown duration uses **Fit timeline**: an explicit click captures the current range, whose scale stays fixed as playback/preparation advance; another click refits it. The scrollbar describes its current limit as **length unknown**, separately from the fitted chart endpoint. Source replacement resets the captured range; seeking preserves it. Local metadata/playback stays on-device.

[The player throttle regression](../../tests/player.test.ts) independently checks endpoint changes coalescing into the existing one-second overview throttle: a simulated second formerly produced 101 requests and now produces two, the initial request and the 1000-ms update. Stale replies remain rejected. Playing draws retain the 70-ms scheduling gate, and overview extraction reads bounded sampled history without executing the SID. These are request-count/source bounds, not device CPU/FPS measurements.

Duration/fitting browser guards cover exact seek limits separately from formatted chart labels, stable unknown ranges and local privacy after loading database-matched library bytes. A receiver-sensitive fetch regression prevents invoking native `fetch` without its `globalThis` receiver. Packaging guards verify the MD5 dependency's exact MIT notice.

Live Chrome/macOS WebKit checks on 2026-10-20 used the official database from localhost, loaded and silently played Commando, verified 235.594 seconds for subtune 1 and 61.288 seconds after reloading subtune 2, retained library state and reported no page errors. Trace/video/download capture stayed disabled. Actual Safari/iPhone and the published origin remain separate acceptance gates.

## Source controls and repeated selection

An unloaded app must not present the selected catalog sample as loaded. [The initial-state guard](../../tests/browser/initial-song-state.spec.ts) verifies that catalog selection configures only the pending sample, loaded badges wait for actual load information, and selecting another sample preserves a currently loaded tune's metadata.

**Open SID file** is a native button inside the visible **or drop a SID file here** target. File drags highlight it; page-wide drops use the same local validation path. [The file-control guard](../../tests/browser/local-file-control.spec.ts) opens the chooser, loads one cleared file, drops a different file and checks advancing playback, spacing and narrow layout. These guards ran in silent Chrome/macOS WebKit with desktop/narrow visual inspection on 2026-10-20.

The reported second-library-song failure was not reproduced. Live Chrome checks replaced Commando with Monty on the Run in the retained frame, including during active playback, and verified new metadata/path plus advancing nonzero PCM. The user subsequently confirmed replacement works. No picker/loader fix was justified by that report, and its original cause remains unknown.

[The replacement guard](../../tests/browser/library-picker.spec.ts) uses distinct cleared Rambo/Bach bytes, including header-derived metadata without a supplied title. It uses three successive native pointer selections without a hover-delivery workaround and checks one iframe, replacement header/path, reset playhead and subsequent advancing PCM in Chrome/macOS WebKit. This coverage does not establish a new Safari/iPhone verdict.


## Recent library songs

**Recently played** appears directly below Browse SID library once an online library song has loaded successfully. It keeps ten unique HVSC paths, newest first, including selections from SID highlights. Choosing an entry downloads it from official HVSC and loads its default subtune through the ordinary loader; Play starts playback. Failed loads do not add or reorder entries. Local files and published samples are excluded.

Only title, author and canonical collection path are stored in this browser's local storage, without SID bytes, audio, local filenames or hashes. No request runs just to populate the dropdown. **Clear history** empties the list and removes its persisted record; unavailable browser storage leaves a session-only list. The [history guards](../../tests/recent-songs.test.ts) cover limits, deduplication, metadata validation and corrupt/blocked storage. The [browser guard](../../tests/browser/recent-songs.spec.ts) checks persistence, reloading, failed downloads, local-file exclusion and clearing. [Shared download guards](../../tests/hvsc-download.test.ts) enforce the official origin, safe paths, byte bounds and cancellation used by both recent songs and highlights.

## SID highlights

**SID highlights** below **Browse SID library** provides the fixed [metadata shortlist](../../src/sid-highlights.ts), grouped into mono and dual-SID stereo with model and duration labels. Selecting downloads and loads that tune; **Play** starts it. The selector returns to its prompt so the same tune can be selected again after a failure. Pending loads disable source controls. Download failures preserve the current tune. Clock, subtune and model defaults come from the downloaded PSID; stereo uses the existing SID 1 left / SID 2 right routing.

The twenty choices include six dual-SID tunes (30%), with mono/stereo coverage of both MOS6581 and MOS8580. Every advertised duration is the official HVSC reference length for the exact file's default subtune, greater than 120 seconds and no more than the player's 600-second boundary. Labels show whole minutes/seconds using the transport's rounding-down convention and identify default subtunes other than 1. Changing subtunes after loading can select shorter material; the dropdown describes its own default choice. Durations are curated metadata, not an intrinsic SID ending. The [source research](../research/sid-library-picker.md#highlight-discovery-and-delivery) distinguishes historical chart rankings, exact-release ratings and retained favourites. Galway’s Rambo remains excluded because Explorer already offers its own Rambo arrangement.

Music comes directly from official HVSC only on selection, with no credentials or referrer. Fetch and streamed body reading share a 15-second deadline and a 65,662-byte ceiling; installed chip count, explicit PAL clock, declared model and default subtune must match the labels. The ordinary loader owns remaining format checks. Library information credits HVSC and shows its collection path. Library duration lookup follows the existing privacy contract. No SID file is bundled, mirrored or added to the publication-cleared catalog, and local opening still causes no online lookup.

[Unit guards](../../tests/sid-highlights.test.ts) check shortlist constraints, delivery bounds and profile/default-subtune validation. [Browser guards](../../tests/browser/sid-highlights.spec.ts) substitute generated diagnostic SIDs for network responses and exercise duration/subtune labels, stereo grouping, lazy delivery, a gated pending load, explicit playback, replacement during playback, mono/stereo model changes, failed download/retry and narrow layout. These establish software behavior separately from live-host availability and human listening.

Run `node --experimental-strip-types scripts/check-sid-highlights.ts` with Node 24 and curl after preparing the engine to recheck the [live source and playback oracle](../../scripts/check-sid-highlights.ts). It downloads the official duration database once, matches each in-memory SID's full-file MD5, checks the advertised default-subtune duration and renders three seconds through the adopted engine. Expected chip writes, nonzero output on every channel and distinct dual-SID channels are required. Downloads and rendering share a 55-second budget, with at most 12 seconds per download and bounded response sizes. Only metadata receipts are printed; no SID or audio files are saved. This is a short compatibility check, not full-song listening or actual Safari/iPhone acceptance.

Live browser checks use the shared silent fixture with trace/video disabled and retain only metadata receipts. The expanded list's Wizball, Ultimate Axel F., Sleepwalk and Raindropsies checks cover all four mono/stereo model combinations, default subtune 4 as well as 1, displayed duration versus the loaded seek limit, Ready without autoplay and advancing channel output in Chrome/macOS Playwright WebKit. These localhost checks do not establish deployed-origin availability, actual Safari/iPhone behavior or human listening acceptance.
