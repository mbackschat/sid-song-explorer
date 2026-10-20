# Online SID library picker validation

[`LIBRARY-1`](../PLAN.md#online-sid-library-picker-library-1) adds SIDquake’s existing HVSC browser to Explorer. The [research record](../research/sid-library-picker.md) owns provider comparisons, the reviewed protocol, terms and the original isolated handoff check. This record owns Explorer integration evidence.

## Interaction

Choose **Browse SID library** beside **Open local SID**, search in SIDquake’s dialog, choose a result and press **Select**. Explorer closes the dialog, loads the SID and shows its title, author and release. Press **Play** to start playback. **Library information** expands the credited collection path and available STIL text. Subtune, clock and chip-model controls use the existing loader.

The provider is contacted only when its dialog opens. Local opening does not contact the provider or send files, hashes or metadata. Closing the dialog preserves the current tune; an old frame cannot replace a later selection or local file. Unsupported profiles report an error. Provider failures expose **Retry** and **Close**, while local opening remains available.

Use the visible **Close** button to cancel. Escape closes the dialog while focus is in Explorer; a Chrome guard established that Escape pressed inside the cross-origin provider frame does not reach the parent dialog. The provider has no cancellation-message contract. Keyboard traversal follows each browser’s native tab behavior; a fixed two-Shift-Tab return worked in Chrome but not default macOS WebKit, so no uniform shortcut from inside the widget is promised. The guards cover initial dialog focus/Escape, Close after iframe focus, and restored launcher focus. This boundary is retained explicitly instead of adding a provider fork or intercepting its document.

SIDquake owns search, collection navigation and delivery. Explorer adds no index, proxy, accounts or persistent library downloads. Provider text is inert, bounded text; the returned download URL/token is discarded. Library selections do not become publication-cleared catalog assets or verified musical annotations. Durations and provider-selected subtunes are outside this payload.

## Verification boundaries

The [receiver unit guards](../../tests/library-picker.test.ts) exercise the active-frame/origin boundary, payload types and size limits, optional metadata, ignored URLs, cancellation, focus, stale messages, timeout/retry and disposal. The [browser guards](../../tests/browser/library-picker.spec.ts) use an actual cross-origin iframe and the cleared Rambo sample through the [provider fixture](../../tests/browser/library-picker-fixture.ts). They do not depend on the hosted service.

Browser checks cover lazy loading, cancellation during playback, narrow layout, provider attribution, the existing loader’s pending state, plain-text metadata and SID-header fallbacks, reload, local/catalog replacement, wrong senders, obsolete frames, local-drop supersession, unsupported RSID/third-chip profiles, and service failure/retry. Pending loader feedback uses the shared [worker-request gate](../../tests/browser/worker-control.ts).

Live-provider smoke checks are separate from deterministic guards. They search for Rob Hubbard’s **Commando**, select it through SIDquake, load it in Explorer and verify advancing playback and measured PCM. They must use the shared silent fixture, disable trace/video/download capture, and avoid persisting SID bytes or token URLs. UI screenshots and metadata-only receipts may be retained under ignored `build/library-picker/`. A passing localhost check does not establish behavior on the deployed Explorer origin.

## Execution record

The picker is implemented locally on 2026-10-20. The initial receiver guards failed before implementation; all 30 focused guards subsequently passed. The initial integrated browser guard failed because the pre-feature build lacked **Browse SID library**. Logs are retained locally under `build/library-picker/`.

The complete serialized unit suite passed all 176 checks in 77.7 seconds, including the new receiver guards, browser-policy guard and existing engine/cache/profile oracles. This was a full-suite run, separate from browser emulation; focused browser runs retain their 60-second limits.

Asset preparation verified the cleared samples and existing raw-chip runtime with its licenses/notices/complete source. The final production build and TypeScript check passed. Local documentation links/fragments and patch whitespace passed. No engine build or playback-core modification was needed.

The first live Chrome check loaded and played Commando, but visual review at 390 px found that the provider’s narrow-layout `.hvsc-path-text` rule (`flex: 1 0 100%`) pushed its Select button outside the iframe. A new pre-click viewport assertion reproduced visibility ratio zero; Playwright’s automatic scrolling during click had masked it in the earlier run. Explorer now uses the provider’s documented `path=0` display option. The selected path remains available in Explorer’s Library information, and SIDquake/HVSC attribution remains visible. No provider source or styles are overridden. The [pinned embedding guide](https://github.com/RobertTroughton/SIDquake/blob/20caa381880dacbe01e139c828899f08fb3ac329/docs/EMBED.md#chrome) documents the option.

Two initial deterministic runs exposed fixture defects: tests that never played audio could not satisfy the shared silent-sink teardown assertion, and fixture buttons were enabled before their handlers were installed. The common setup now exercises real silent playback before pausing, and provider buttons stay disabled until initialized. Those failures do not establish a production loader defect. Original logs and failure diagnostics are retained; deadlines and tracing policy are unchanged.

All six deterministic scenarios passed with the configured retained-on-failure tracing and no retries: Chrome in 51.0 seconds and macOS WebKit in 30.6 seconds. Each run retained the 60-second global limit; the totals include teardown.

Four existing local-input/profile regressions passed in each browser: device-local mono loading and annotation invalidation, local dual-SID inspection, rejection of conflicting concrete models without replacing playback, and second-chip model selection with an intentional uniform override. The focused runs also exercised cancellation (Chrome: five passed in 15.2 seconds; WebKit: five passed in 18.0 seconds). The final cancellation guard explicitly verifies Escape with initial parent focus and Close after focusing inside the frame; its final Chrome check passed in 5.9 seconds, and the WebKit run includes that final form.

The final live-provider checks passed in Chrome `155.0.8059.85` (17.2 seconds) and macOS Playwright WebKit `26.0` (9.1 seconds). Both searched through the real widget, selected Commando, loaded its Rob Hubbard / 1985 Elite metadata and 19 subtunes, then measured nonzero PCM and an advancing heard position in Explorer. Screenshots at 1440 px and 390 px were inspected; the narrow Select button and SIDquake/HVSC attribution remained visible. There were no page errors. These checks used the shared zero-gain audio fixture with trace/video/download capture disabled; only UI screenshots, sanitized request timings and metadata receipts were retained.

Two intervening live attempts failed at the five-second handoff assertion and the fifteen-second search-result deadline. Those earlier runs did not retain enough network timing to establish their causes. The final harness waits for the provider’s ready signal before searching and records only request paths/timings and message types/sender matches, never token URLs or SID bytes. Successful final runs demonstrate the workflow, not guaranteed provider availability or performance.

Actual Safari and recent-iPhone acceptance, deployed-origin verification and publication remain separate gates. Earlier stereo acceptance does not establish this new third-party workflow.

## Separate pre-existing finding

Source review found that [application startup](../../src/main.ts) disposes the player on `pagehide`, including navigation into the browser’s back/forward cache. Returning to that cached page may restore a disposed player. This feature closes the picker on `pagehide` without permanently disposing its controls; changing the player’s existing navigation lifecycle is outside `LIBRARY-1`.
