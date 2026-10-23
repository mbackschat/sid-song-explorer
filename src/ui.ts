import type { Catalog } from './catalog.ts';
import type { PlayerControls, PlayerState, Profile, RegisterFrame, WriteObservation, TimelineObservation, TimelineOverview } from './player-types.ts';
import { FOLLOW_WINDOW_SECONDS, followingWindow, fittedWindow, visibleTimelineFrames, observationRegistersAt, composeTimelineObservations } from './timeline.ts';
import type { DisplayedObservation } from './timeline.ts';
import {createVoiceMix, updateVoiceMix, voiceIsSolo, voiceMixMask, type VoiceMixAction} from './voice-mix.ts';
import {timelinePlotFrames} from './timeline-sampling.ts';
import {timelineScrollbarGeometry, timelineViewportStart} from './timeline-scrollbar.ts';
import {mountLibraryPicker, type LibraryMetadata} from './library-picker.ts';
import {RecentSongs} from './recent-songs.ts';
import {fetchHvscSong} from './hvsc-download.ts';
import {SID_HIGHLIGHTS, fetchHighlight} from './sid-highlights.ts';
import {SongLengthLookup} from './song-lengths.ts';
import {matchingCompositionPackage} from './composition-package.ts';
import type {PlaybackCompositionPackage} from './composition-time.ts';
import {mountCompositionPanel, phrasePlaybackRange} from './composition-panel.ts';
import {mountTimelineLoop, type LoopMarkers} from './timeline-loop.ts';
import logoUrl from '../assets/branding/sid-song-explorer.svg?url';
import './style.css';
import './library-picker.css';
import './composition-panel.css';

type Entry = Catalog['entries'][number];
type Annotation = Entry['analysis']['annotations'][number];
type HeldHistory = DisplayedObservation & {
  history: DisplayedObservation;
  overview: TimelineOverview | null;
  inspectionPending: boolean;
  inspection: DisplayedObservation | null;
  epoch: number;
  heardUntil: number;
  configuration: string;
  plotStart: number;
  plotEnd: number;
};
const COLORS = ['#6ee0de', '#f3c681', '#f493b5'];
const VOICES = [0, 1, 2, 3, 4, 5] as const;
const CHIPS = [0, 1] as const;
const filterLaneId = (chip: number) => chip === 0 ? 'filter-lane' : `filter-lane-${chip}`;
const voiceName = (voice: number, stereo: boolean) => stereo ? `SID ${Math.floor(voice / 3) + 1} · Voice ${voice % 3 + 1}` : `Voice ${voice + 1}`;
const MAX_FILE_BYTES = 65_662;
const MAX_SEEK_SECONDS = 600;
const TIMELINE_DENSITIES = [16, 32, 64, 128, 256, 512, 1024] as const;
const hex = (value: number, width = 2) => value.toString(16).toUpperCase().padStart(width, '0');
const time = (seconds: number, precise = false) => {
  const safe = Math.abs(seconds);
  const minutes = Math.floor(safe / 60);
  return `${seconds < 0 ? '−' : ''}${minutes}:${Math.floor(safe % 60).toString().padStart(2, '0')}${precise ? `.${Math.floor((safe % 1) * 100).toString().padStart(2, '0')}` : ''}`;
};
const db = (value: number) => Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : '−∞ dBFS';
const waveforms = (control: number) => ['Triangle', 'Saw', 'Pulse', 'Noise'].filter((_, index) => control & (16 << index)).join(' + ') || 'None';
const generated = (filename: string) => `${import.meta.env.BASE_URL}generated/${encodeURIComponent(filename)}`;

export function mountExplorer(root: HTMLElement, controls: PlayerControls, catalog: Catalog, compositionPackage: PlaybackCompositionPackage | null = null): void {
  root.innerHTML = `
    <header class="app-header">
      <div class="brand"><img id="brand-logo" alt="SID Song Explorer sound lens" /><div><div class="brand-name">SID Song Explorer</div><div class="brand-subtitle">Hear the music. Explore the chip.</div></div></div>
      <div class="header-note"><span class="mono">COMMODORE 64</span><span class="badge">SID player</span></div>
    </header>
    <div class="app-shell">
      <aside class="sidebar" aria-label="Music library">
        <section><div class="eyebrow">Your listening desk</div><div class="library-mark"><span class="sid-icon mono">SID</span><div><strong>Published samples</strong><small>Source-backed listening</small></div></div>
          <label for="sample-select">Sample library</label><select id="sample-select" class="library-select"></select><button id="use-sample-button" class="small quiet library-load">Load selected sample →</button><p id="library-summary" class="library-summary"></p><details id="local-build-materials" class="local-materials"><summary>Local-build arrangements</summary><p>No audio download: build these locally using Crafter’s materials.</p><ul></ul></details>
        </section>
        <section class="local-section"><h2>Open music</h2><div id="local-drop-target" class="local-drop-target"><input id="local-file" type="file" accept=".sid,audio/prs.sid" hidden /><button id="open-local-file" class="file-button" type="button" aria-describedby="local-drop-hint">Open SID file</button><p id="local-drop-hint">or drop a SID file here</p></div><button id="browse-library" class="library-browse">Browse SID library</button><div id="recent-songs-section" class="recent-songs" hidden><div class="recent-songs-heading"><label for="recent-songs">Recently played</label><button id="clear-recent-songs" class="small quiet">Clear history</button></div><select id="recent-songs" class="library-select"><option value="">Choose a recent song…</option></select></div><div class="sid-highlights"><label for="sid-highlights">SID highlights</label><select id="sid-highlights" class="library-select" aria-describedby="highlights-note"><option value="">Choose a highlight…</option></select><p id="highlights-note">Loads from <a href="https://www.hvsc.c64.org/" target="_blank" rel="noreferrer">HVSC</a>. <a href="https://www.transbyte.org/SID/HVSC_Top100.html" target="_blank" rel="noreferrer">Chart picks</a> &amp; <a href="https://csdb.dk/" target="_blank" rel="noreferrer">scene favourites</a> · default-subtune durations. Press Play to listen.</p></div><p class="privacy-note">Local files stay on your device. No uploads, file-hash requests or metadata lookups. Mono or dual-SID PSID · max 65,662 bytes.</p></section>
        <div class="sidebar-footer"><span class="eyebrow">Made to explore</span><p>Three voices per chip.<br />One shared filter per chip.</p><p style="margin-top:12px"><a href="https://github.com/mbackschat/sid-song-explorer" target="_blank" rel="noreferrer">Project & source ↗</a></p></div>
      </aside>
      <main class="workspace">
        <section aria-labelledby="track-title"><div class="track-heading"><div><div class="eyebrow" id="source-kind" hidden></div><h1 id="track-title">Choose a SID to explore</h1><div class="track-description-row"><p id="track-description" class="track-description">Listen to a phrase, hold a moment, and see what the SID voices are doing.</p><button id="library-info-button" class="small quiet" popovertarget="library-info" hidden>Library info</button></div><div id="library-info" class="library-info" popover aria-labelledby="library-info-title"><div class="library-info-heading"><h2 id="library-info-title">Library information</h2><button class="small quiet" popovertarget="library-info" popovertargetaction="hide" aria-label="Close library information">×</button></div><p id="library-provider"></p><dl><div><dt>Collection path</dt><dd id="library-path"></dd></div></dl><pre id="library-stil"></pre></div><div class="track-profile"><span id="profile-badge" class="badge" hidden></span><span id="chip-profile-badge" class="badge" hidden></span><span id="routing-badge" class="badge" hidden>Player routing · SID 1 left / SID 2 right</span><span id="analysis-badge" class="badge">Generic inspection</span></div></div><span id="play-status" class="badge">Ready to load</span></div></section>
        <div class="inspection-grid">
          <section id="timeline-panel" class="panel unified-panel" aria-labelledby="timeline-title">
            <div class="unified-toolbar"><div class="transport-buttons"><button id="play-button" class="primary" disabled>▶ Play</button><button id="restart-button" class="small quiet" disabled aria-label="Restart from beginning" title="Restart from beginning">↺</button><div class="time-display"><span id="heard-time">0:00</span> <small id="duration-label">/ —</small></div><span id="loop-indicator" class="badge loop-indicator" role="status" hidden>Loop on</span></div>
              <button id="load-button" class="small quiet">Load sample</button><div class="follow-controls"><div class="timeline-modes" role="group" aria-label="Timeline view"><button id="timeline-scroll" class="small" aria-pressed="true" title="Center heard playback with equal past and upcoming space">Scroll</button><button id="timeline-fit" class="small" aria-pressed="false" title="Fit the whole song into the chart">Fit song</button></div><div id="timeline-zoom" class="timeline-zoom" role="group" aria-label="Timeline zoom"><button id="timeline-zoom-out" class="small" aria-label="Zoom out" title="Zoom out: show twice as much time">−</button><span id="timeline-scale" class="mono"></span><button id="timeline-zoom-in" class="small" aria-label="Zoom in" title="Zoom in: show twice the detail">+</button></div><button id="follow-button" class="small quiet" title="Hold the current moment in the Sound inspector">Hold</button><button id="return-button" class="small" aria-pressed="true" title="Return to centered playback and release held inspection">Follow</button></div></div>
            <div class="unified-heading"><h2 id="timeline-title">Voice activity</h2><small id="timeline-view-note" hidden>Centered on heard playback</small></div>
            <div class="lane-list">${CHIPS.map(chip => `<div id="chip-lanes-${chip}" class="chip-lanes"${chip ? ' hidden' : ''}><div id="chip-heading-${chip}" class="chip-heading" hidden>SID ${chip + 1}</div>${[0, 1, 2].map(localVoice => {
              const voice = chip * 3 + localVoice;
              return `<div class="voice-lane" style="--voice:${COLORS[localVoice]}"><div class="voice-label"><strong id="voice-label-${voice}">Voice ${localVoice + 1}</strong><small id="lane-wave-${voice}">No observation</small></div><canvas id="voice-lane-${voice}" class="lane-plot" tabindex="0" role="slider" aria-label="Select inspection time for voice ${voice + 1}" aria-valuemin="0" aria-valuemax="30" aria-valuenow="0" data-sid-number="${chip}"></canvas></div>`;
            }).join('')}<div class="voice-lane filter-lane" style="--voice:#b2a1ff"><div class="voice-label"><strong>Shared filter</strong><small>Cutoff register</small></div><canvas id="${filterLaneId(chip)}" class="lane-plot" tabindex="0" role="slider" aria-label="Select shared filter inspection time" aria-valuemin="0" aria-valuemax="30" aria-valuenow="0" data-sid-number="${chip}"></canvas></div></div>`).join('')}<div id="timeline-ruler" class="timeline-ruler"><div id="timeline-loop" hidden></div><input id="seek-slider" type="range" min="0" max="30" step="0.01" value="0" disabled aria-label="Seek playback in seconds" title="Click or drag the ruler to seek; arrow keys adjust playback" /><div class="timeline-key mono"><span id="timeline-start">0:00</span><span id="timeline-cursor">0:00.00</span><span id="timeline-end">0:30</span></div></div><div class="timeline-scrollbar"><button id="timeline-scroll-back" class="small" aria-label="Scroll timeline earlier">◀</button><div id="timeline-scroll-track" tabindex="0" role="scrollbar" aria-label="Browse timeline" aria-controls="voice-lane-0 voice-lane-1 voice-lane-2 filter-lane" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div id="timeline-scroll-thumb"></div></div><button id="timeline-scroll-forward" class="small" aria-label="Scroll timeline later">▶</button><div class="timeline-scroll-range mono"><span id="timeline-range-start">0:00</span><span id="timeline-range-end"></span></div></div>
            </div><div class="timeline-feedback"><div id="status-message" class="status-line" role="status" aria-live="polite">Choose a sample to begin.</div></div>
            <div id="history-summary" class="history-summary"><span id="history-description">No retained observations yet.</span> <span id="trace-warning" role="status" hidden></span> <a id="view-inspector" href="#inspector-title" hidden>View inspector →</a></div>
            <div class="panel-options"><details id="loop-details"><summary>Loop A–B</summary>
            <div class="loop-row"><label><span>A · seconds</span><input id="loop-start" class="loop-time" type="number" min="0" step="0.01" value="" aria-label="Loop start in seconds" /></label><button id="mark-a" class="small quiet" disabled>Set A</button><label><span>B · seconds</span><input id="loop-end" class="loop-time" type="number" min="0" step="0.01" value="" aria-label="Loop end in seconds" /></label><button id="mark-b" class="small quiet" disabled>Set B</button><button id="loop-button" class="small" aria-pressed="false" disabled>Loop A–B</button><button id="clear-loop" class="small quiet" disabled>Clear</button><span id="loop-summary" class="loop-summary">Set A before B. Loop restarts may briefly pause; playback is not gapless.</span></div></details><details id="playback-setup"><summary>Playback setup</summary><div class="settings"><label><span>Clock</span><select id="clock-select"><option>PAL</option><option>NTSC</option></select></label><label><span id="chip-model-label">Chip model</span><select id="model-select"><option value="MOS6581">MOS 6581</option><option value="MOS8580">MOS 8580</option></select></label><label><span>Subtune</span><select id="subtune-select"><option value="1">1</option></select></label><p id="settings-note" class="settings-note">Settings apply when you load. Prepared audio supports quick seeking; other positions need preparation. Trace timestamp alignment is approximate.</p></div></details><details id="timeline-help"><summary>Help & details</summary><p class="timeline-help">Drag the proportional scrollbar to browse without changing sound. Click or drag the time ruler to seek when released. Click a lane to seek playback. Shift-click a lane to inspect its settings; Hold captures the current heard position. Follow returns to centered playback. Drag the violet A/B loop handles; release to apply, or press Escape to cancel. Arrow keys adjust by 0.1 seconds, or 1 second with Shift. Zoom changes detail; wider charts show more time at the same zoom. Shading marks unavailable observations. Fit song shows the known duration. When length is unknown, Fit timeline fits the current range and keeps its scale fixed; click it again to update. A line shows register frequency, not loudness; gate clear can still release sound.</p><div class="transport-foot"><span id="seek-note"></span></div></details><button id="diagnosis-mode" class="diagnosis-mode" role="switch" aria-checked="false" aria-controls="diagnostics timeline-view-note">Diagnosis mode</button><div id="diagnostics" class="diagnostics-body" hidden><p id="timeline-availability"></p><p id="render-lead"></p><p id="audio-diagnostics">Device-local playback · no backend</p></div></div>
          </section>
          <div class="inspection-sidebar"><aside class="panel inspector" aria-labelledby="inspector-title"><div class="panel-header"><h2 id="inspector-title" tabindex="-1">Sound inspector</h2><span id="inspection-time" class="inspection-time mono">0:00.00</span></div><div class="inspector-body"><div id="inspector-note-row" class="inspector-note-row"><span id="inspector-note">Following playback</span><button id="inspector-tip-button" class="info-tip-button" aria-label="About sound inspection" aria-describedby="inspector-tip" aria-expanded="false" aria-controls="inspector-tip">ⓘ</button><div id="inspector-tip" class="info-tip" role="tooltip" popover><p id="inspector-tip-text"></p><p id="inspector-tip-range" hidden></p></div></div><div id="mix-controls" class="inspector-mixer" aria-busy="false"><div class="mixer-heading"><span>Voices</span><button id="restore-button" class="small quiet" disabled>Full mix</button></div><div class="mixer-chips">${CHIPS.map(chip => `<section id="mixer-chip-${chip}" class="mixer-chip" aria-label="SID ${chip + 1} voices"${chip ? ' hidden' : ''}><div class="mixer-heading"><strong>SID ${chip + 1}</strong><button id="chip-enabled-${chip}" class="small chip-switch" role="switch" aria-checked="true" aria-label="Enable SID ${chip + 1} voices" disabled>On</button></div><div class="mixer-voices">${[0, 1, 2].map(localVoice => {
              const voice = chip * 3 + localVoice;
              return `<div class="mixer-voice" style="--voice:${COLORS[localVoice]}"><button id="inspect-${voice}" class="small" aria-pressed="${voice === 0}">Voice ${localVoice + 1}</button><div class="voice-actions"><button id="mute-${voice}" class="small" aria-label="Mute voice ${voice + 1}" aria-pressed="false" disabled title="Mute voice ${voice + 1}">M</button><button id="solo-${voice}" class="small" aria-label="Solo voice ${voice + 1}" aria-pressed="false" disabled title="Solo voice ${voice + 1}">S</button></div></div>`;
            }).join('')}</div></section>`).join('')}</div><p id="voice-mix-status" class="intervention-note" role="status" aria-live="polite" aria-atomic="true"></p></div>
            <details id="voice-registers" class="voice-registers"><summary>Voice registers</summary><dl class="register-grid"><div><dt>Frequency register</dt><dd id="reg-frequency">—</dd></div><div><dt>Derived oscillator Hz</dt><dd id="reg-hz">—</dd></div><div class="wide"><dt>Waveform selection</dt><dd id="reg-waveform">—</dd></div><div><dt>Gate / Test</dt><dd id="reg-gate">—</dd></div><div><dt>Pulse width · 12-bit</dt><dd id="reg-pulse">—</dd></div><div><dt>AD / SR settings</dt><dd id="reg-adsr">—</dd></div><div><dt>Ring / Sync</dt><dd id="reg-coupling">—</dd></div></dl></details>
            <details class="shared-filter"><summary id="filter-title">One filter · all three voices</summary><div id="filter-details"><dl class="filter-registers"><div><dt>Cutoff</dt><dd id="filter-cutoff">—</dd></div><div><dt>Resonance</dt><dd id="filter-resonance">—</dd></div><div><dt>Low-pass</dt><dd id="filter-low-pass">—</dd></div><div><dt>Band-pass</dt><dd id="filter-band-pass">—</dd></div><div><dt>High-pass</dt><dd id="filter-high-pass">—</dd></div><div><dt>Routed voices</dt><dd id="filter-routed">—</dd></div><div><dt>Master volume</dt><dd id="filter-volume">—</dd></div><div><dt>Voice 3 direct</dt><dd id="filter-direct">—</dd></div></dl><p id="filter-note">No observed register frame at the selected time.</p></div></details><details class="inspector-writes"><summary>Ordered writes ≤ cursor</summary><ol id="write-list" class="write-list"><li class="write-empty">Load and play to collect writes.</li></ol></details></div></aside>
          <section class="panel" aria-labelledby="output-title"><div class="panel-header"><h2 id="output-title">Audio output</h2><span id="output-profile-badge" class="badge" hidden></span></div><div class="audio-body">
            <div id="audio-channel-left" class="audio-channel audio-left" role="group"><span id="audio-channel-label-left" class="audio-channel-name mono" aria-label="Left channel" hidden>L</span><div class="meter-label peak-reading"><span id="peak-title">Peak · measured PCM</span><span id="peak-label" class="mono">−∞ dBFS</span></div><div class="meter-track"><span id="peak-meter" class="meter-level"></span></div><div class="meter-label rms-reading"><span id="rms-title">RMS</span><span id="rms-label" class="mono">−∞ dBFS</span></div><canvas id="waveform-plot" class="audio-plot" aria-label="Actual output waveform"></canvas><div class="plot-caption"><span>WAVEFORM</span><span id="waveform-source">Audio output</span></div></div>
            <div id="audio-channel-right" class="audio-channel audio-right" role="group" hidden><span class="audio-channel-name mono" aria-label="Right channel">R</span><div class="meter-label peak-reading"><span>Peak</span><span id="peak-label-right" class="mono">−∞ dBFS</span></div><div class="meter-track"><span id="peak-meter-right" class="meter-level"></span></div><div class="meter-label rms-reading"><span>RMS</span><span id="rms-label-right" class="mono">−∞ dBFS</span></div><canvas id="waveform-plot-right" class="audio-plot" aria-label="Actual right output waveform"></canvas></div>
            <div class="audio-spectrum"><p id="analysis-monitor" class="audio-monitor" hidden><span class="audio-left">L · Left</span><span class="audio-right">R · Right</span></p><canvas id="spectrum-plot" class="audio-plot" aria-label="Actual output frequency spectrum"></canvas><div class="plot-caption"><span>SPECTRUM</span><span id="spectrum-range">0 → Nyquist</span></div></div>
          </div><div id="reference-section" class="reference-body"><h3>Retained reference · WAV</h3><p id="reference-scope">Load a catalog sample for its retained listening reference.</p><audio id="reference-audio" controls preload="none" aria-label="Retained reference recording"></audio></div></section>
          </div>
          <section class="panel evidence-panel" aria-labelledby="evidence-title"><div class="panel-header"><h2 id="evidence-title">Listen a little closer</h2><span class="badge">Linked evidence</span></div><div class="evidence-body"><div id="composition-analysis"></div><details id="playback-evidence" open><summary id="playback-evidence-summary" hidden>Playback evidence</summary><p id="evidence-scope" class="evidence-scope">Authored annotations apply only to their exact catalog file, clock, chip model and subtune.</p><div id="evidence-cards"></div></details></div></section>
        </div>
        <footer class="source-footer"><div id="source-links" class="source-links"></div><div id="engine-links" class="source-links" aria-label="Playback engine licenses and source"></div></footer>
      </main>
    </div>`;

  const el = <T extends HTMLElement = HTMLElement>(id: string) => {
    const found = root.querySelector<T>(`#${id}`);
    if (!found) throw new Error(`Missing UI element: ${id}`);
    return found;
  };
  const select = (id: string) => el<HTMLSelectElement>(id);
  const input = (id: string) => el<HTMLInputElement>(id);
  const button = (id: string) => el<HTMLButtonElement>(id);
  const setText = (id: string, value: string) => { const target = el(id); if (target.textContent !== value) target.textContent = value; };
  el<HTMLImageElement>('brand-logo').src = logoUrl;
  const reference = el<HTMLAudioElement>('reference-audio');
  const sampleSelect = select('sample-select');
  for (const entry of catalog.entries) sampleSelect.add(new Option(entry.title, entry.id));
  let chosenEntry: Entry | null = catalog.entries[0] ?? null;
  let loadedEntry: Entry | null = null;
  let loadedBytes: Uint8Array | null = null;
  let openedBytes: Uint8Array | null = null;
  let sourceMode: 'catalog' | 'local' | 'library' = 'catalog';
  let openedName = '';
  let libraryChoice: LibraryMetadata | null = null;
  let loadedLibrary: LibraryMetadata | null = null;
  let loadedProfile: Profile | null = null;
  let state: PlayerState | null = null;
  let voiceMix = createVoiceMix(1);
  let diagnosisMode = false;
  let held: HeldHistory | null = null;
  let chartHeld: HeldHistory | null = null;
  let inspectionSequence = 0;
  let timelineView: 'scroll' | 'fit' = 'scroll';
  let fittedEnd: number | null = null;
  const songLengths = new SongLengthLookup();
  const recentStorage = () => {
    try { return window.localStorage; } catch { return null; }
  };
  const recentSongs = new RecentSongs(recentStorage());
  const renderRecentSongs = () => {
    const entries = recentSongs.entries();
    select('recent-songs').replaceChildren(new Option('Choose a recent song…', ''));
    for (const song of entries) select('recent-songs').add(new Option(`${song.title}${song.author ? ` — ${song.author}` : ''}`, song.path));
    el('recent-songs-section').hidden = entries.length === 0;
  };
  renderRecentSongs();
  let timelineZoom = TIMELINE_DENSITIES.indexOf(64);
  let timelineSpan = FOLLOW_WINDOW_SECONDS;
  let seekViewport: {center: number; span: number; heard: number | null; marker: number | null} | null = null;
  let cursor = 0;
  let selectedEnd: number | null = null;
  let selectedLoopMarkers: LoopMarkers | null = null;
  let selectedVoice = 0;
  let selectedFilterChip: number | null = null;
  const chipCount = () => state?.info?.installedSids ?? 1;
  const voiceCount = () => chipCount() * 3;
  const inspectionSubject = () => {
    if (selectedFilterChip === null) return voiceName(selectedVoice, chipCount() > 1);
    return chipCount() > 1 ? `SID ${selectedFilterChip + 1} shared filter` : 'Shared filter';
  };
  let busy = false;
  let notice = '';
  let seekDragging = false;
  let timelineLimit = 30;
  let animationFrame = 0;
  let lastDraw = 0;
  let plotStart = 0;
  let plotEnd = FOLLOW_WINDOW_SECONDS;
  let evidenceKey = '';
  let compositionVisible = false;
  let sourceKey = '';
  let previousEpoch = -1;
  let liveObservationCache: {
    epoch: number;
    renderedUntil: number;
    historyStart: number;
    end: number;
    preview: TimelineObservation | null;
    observations: DisplayedObservation;
  } | null = null;

  const report = (message: string, isError = false) => {
    notice = message;
    el('status-message').hidden = false;
    setText('status-message', message);
    el('status-message').classList.toggle('error', isError);
  };
  const run = async (operation: () => void | Promise<void>) => {
    try { await operation(); } catch (error) { report(error instanceof Error ? error.message : String(error), true); }
  };
  const currentProfile = (): Profile => ({
    clock: select('clock-select').value as Profile['clock'],
    model: select('model-select').value as Profile['model'],
    subtune: Number(select('subtune-select').value),
    ...(sourceMode === 'catalog' && chosenEntry && select('clock-select').value === chosenEntry.target.clock ? { durationSeconds: chosenEntry.durationSeconds } : {}),
  });
  const hasMatchingAnalysis = () => Boolean(state?.info && !['error', 'loading'].includes(state.status) && loadedEntry && loadedEntry.analysis.annotations.length > 0 && loadedProfile && loadedProfile.clock === loadedEntry.target.clock && loadedProfile.model === loadedEntry.target.model && loadedProfile.subtune === loadedEntry.target.subtune && loadedEntry.analysis.sidSha256 === loadedEntry.files.sid.sha256);
  const setSubtunes = (count: number, selected: number) => {
    const target = select('subtune-select');
    target.replaceChildren();
    for (let song = 1; song <= count; song++) target.add(new Option(String(song), String(song), false, song === selected));
  };
  const applyCatalogDefaults = () => {
    if (!chosenEntry) return;
    select('clock-select').value = chosenEntry.target.clock;
    select('model-select').value = chosenEntry.target.model;
    setSubtunes(1, chosenEntry.target.subtune);
    setText('library-summary', chosenEntry.description);
  };
  const updateReference = () => {
    reference.pause();
    if (loadedEntry) {
      reference.src = loadedEntry.referenceUrl ?? generated(loadedEntry.files.reference!.filename);
      setText('reference-scope', `${loadedEntry.listening.status}: ${loadedEntry.listening.scope} This retained render is separate from live emulation.`);
      el('reference-section').hidden = false;
    } else {
      reference.removeAttribute('src');
      reference.load();
      el('reference-section').hidden = true;
    }
  };
  const setSelectedLoopMarkers = (markers: LoopMarkers | null) => {
    selectedLoopMarkers = markers;
    input('loop-start').value = markers?.start == null ? '' : String(markers.start);
    input('loop-end').value = markers?.end == null ? '' : String(markers.end);
  };
  const startViewport = () => {
    seekViewport = timelineView === 'scroll' ? {center:timelineSpan / 2, span:timelineSpan, heard:null, marker:null} : null;
  };
  const resetInspection = () => { voiceMix = createVoiceMix(chipCount() === 2 ? 2 : 1); setSelectedLoopMarkers(null); fittedEnd = null; startViewport(); held = null; cursor = 0; selectedEnd = null; timelineLimit = 30; evidenceKey = ''; sourceKey = ''; };
  const loadBytes = async (bytes: Uint8Array, entry: Entry | null, library: LibraryMetadata | null = null) => {
    reference.pause();
    const profile = currentProfile();
    loadedEntry = null;
    loadedLibrary = null;
    loadedProfile = null;
    if (el('library-info').matches(':popover-open')) el('library-info').hidePopover();
    el('library-info-button').hidden = true;
    setText('library-path', '');
    setText('library-stil', '');
    evidenceKey = '';
    updateReference();
    if (library) {
      const duration = await songLengths.lookup(bytes, profile.subtune, profile.clock);
      if (duration !== null) profile.durationSeconds = duration;
    }
    await controls.load(bytes, profile);
    loadedBytes = bytes;
    loadedEntry = entry;
    loadedLibrary = library;
    loadedProfile = profile;
    resetInspection();
    if (state?.info) setSubtunes(state.info.songs, state.info.subtune);
    const author = library?.author || state?.info?.author || 'Unknown author';
    const released = library?.released || state?.info?.released;
    setText('track-title', entry?.title ?? (library?.title || state?.info?.title || openedName));
    setText('track-description', entry?.description ?? `${author}${released ? ` · ${released}` : ''}. Generic inspection from locally observed SID registers.`);
    setText('source-kind', entry ? 'From the sample library' : library ? (library.provider === 'SIDquake' ? 'SIDquake · HVSC' : 'HVSC · SID highlight') : `Local file · ${openedName}`);
    el('library-info-button').hidden = library === null;
    setText('library-provider', library ? `Provided by ${library.provider === 'SIDquake' ? 'SIDquake / HVSC' : 'HVSC'}` : '');
    setText('library-path', library?.path ?? '');
    setText('library-stil', library?.stil ?? '');
    el('library-stil').hidden = !library?.stil;
    if (library) {
      recentSongs.remember({path: library.path, title: el('track-title').textContent || library.name, author});
      renderRecentSongs();
    }
    setText('load-button', 'Reload settings');
    el('settings-note').before(button('load-button'));
    updateReference();
    report('Loaded. Press Play to start live SID emulation.');
  };
  const loadSelected = async () => {
    if (busy) return;
    busy = true;
    draw();
    try {
      if (sourceMode !== 'catalog') {
        if (!openedBytes) throw new Error('Open a SID first.');
        report('Reloading SID with the selected settings…');
        await loadBytes(openedBytes, null, sourceMode === 'library' ? libraryChoice : null);
      } else {
        if (!chosenEntry) throw new Error('No catalog samples are available. Open a local PSID.');
        report('Fetching sample and verifying its SHA-256…');
        const response = await fetch(generated(chosenEntry.files.sid.filename), { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`Sample download failed (${response.status}). You can retry Load sample.`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== chosenEntry.files.sid.bytes || buffer.byteLength > MAX_FILE_BYTES) throw new Error('Sample size does not match the catalog. Playback was not started.');
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        const checksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (checksum !== chosenEntry.files.sid.sha256.toLowerCase()) throw new Error('Sample SHA-256 does not match the catalog. Playback was not started.');
        await loadBytes(new Uint8Array(buffer), chosenEntry);
      }
    } catch (error) {
      report(error instanceof Error ? error.message : String(error), true);
    } finally {
      busy = false;
      draw();
    }
  };
  const openSid = async (name: string, readBytes: () => Promise<Uint8Array>, library: LibraryMetadata | null = null) => {
    if (busy) return;
    busy = true;
    draw();
    try {
      const bytes = await readBytes();
      if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`This prototype accepts SID files up to ${MAX_FILE_BYTES.toLocaleString()} bytes.`);
      if (bytes.length < 118 || String.fromCharCode(...bytes.slice(0, 4)) !== 'PSID') throw new Error('Open a mono PSID or dual-SID PSID .sid file. RSID and ROM-dependent formats are outside this prototype.');
      const header = new DataView(bytes.buffer);
      const version = header.getUint16(4);
      const songs = header.getUint16(14);
      const start = header.getUint16(16);
      if (version < 1 || version > 4 || songs < 1 || songs > 256 || start < 1 || start > songs) throw new Error('The PSID header has an unsupported version or invalid subtune information.');
      if (version >= 2 && bytes.length < 124) throw new Error('The PSID header is truncated.');
      if (version >= 4 && bytes[123]) throw new Error('This player supports one or two SID chips. This file declares a third chip.');
      const flags = version >= 2 ? header.getUint16(118) : 0;
      const firstModel = (flags >> 4) & 3;
      const secondModel = version >= 3 && bytes[122] ? (flags >> 6) & 3 : 0;
      const concreteFirst = firstModel === 1 || firstModel === 2;
      const concreteSecond = secondModel === 1 || secondModel === 2;
      if (concreteFirst && concreteSecond && firstModel !== secondModel) {
        throw new Error('This dual-SID file declares different chip models. Mixed-model playback is outside the current shared-model profile.');
      }
      const model = concreteFirst ? firstModel : concreteSecond ? secondModel : 0;
      select('clock-select').value = ((flags >> 2) & 3) === 2 ? 'NTSC' : 'PAL';
      select('model-select').value = model === 2 ? 'MOS8580' : 'MOS6581';
      setSubtunes(songs, start);
      sourceMode = library ? 'library' : 'local';
      openedBytes = bytes;
      openedName = name;
      libraryChoice = library;
      report(library ? `Opening SID from ${library.provider}…` : 'Opening local SID on this device…');
      await loadBytes(bytes, null, library);
    } finally {
      busy = false;
      draw();
    }
  };
  const openLocal = async (file: File) => {
    if (busy) return;
    libraryPicker.close();
    if (file.size > MAX_FILE_BYTES) throw new Error(`This prototype accepts SID files up to ${MAX_FILE_BYTES.toLocaleString()} bytes.`);
    await openSid(file.name, async () => new Uint8Array(await file.arrayBuffer()));
  };
  const libraryPicker = mountLibraryPicker(root, button('browse-library'), selection => {
    void run(() => openSid(selection.name, async () => selection.bytes, selection));
  });
  window.addEventListener('pagehide', () => libraryPicker.close());
  select('recent-songs').addEventListener('change', () => {
    const song = recentSongs.entries().find(song => song.path === select('recent-songs').value);
    select('recent-songs').value = '';
    if (!song || busy) return;
    const name = song.path.split('/').pop()!;
    report(`Fetching ${song.title} from HVSC…`);
    void run(() => openSid(name, () => fetchHvscSong(song), {
      provider: 'HVSC', name, ...song, released: '', stil: '',
    }));
  });
  button('clear-recent-songs').addEventListener('click', () => {
    recentSongs.clear();
    renderRecentSongs();
    button('browse-library').focus();
  });
  const highlightSelect = select('sid-highlights');
  for (const chips of [1, 2] as const) {
    const group = document.createElement('optgroup');
    group.label = chips === 1 ? 'Mono · one SID' : 'Stereo · two SIDs';
    for (const highlight of SID_HIGHLIGHTS.filter(entry => entry.chips === chips)) {
      const option = document.createElement('option');
      option.value = highlight.id;
      option.textContent = `${highlight.title} · ${time(highlight.durationSeconds)}${highlight.subtune > 1 ? ` · subtune ${highlight.subtune}` : ''} — ${highlight.author} · ${chips === 2 ? '2 × ' : ''}${highlight.model.slice(3)}`;
      group.append(option);
    }
    highlightSelect.append(group);
  }
  highlightSelect.addEventListener('change', () => {
    const highlight = SID_HIGHLIGHTS.find(entry => entry.id === highlightSelect.value);
    highlightSelect.value = '';
    if (!highlight || busy) return;
    report(`Fetching ${highlight.title} from HVSC…`);
    void run(() => openSid(highlight.path.split('/').pop()!, () => fetchHighlight(highlight), {
      provider: 'HVSC', name: highlight.path.split('/').pop()!, path: highlight.path,
      title: highlight.title, author: highlight.author, released: '', stil: '',
    }));
  });

  sampleSelect.addEventListener('change', () => {
    chosenEntry = catalog.entries.find(entry => entry.id === sampleSelect.value) ?? null;
    sourceMode = 'catalog';
    applyCatalogDefaults();
    setText('load-button', 'Load sample');
    root.querySelector('.follow-controls')!.before(button('load-button'));
    report('Sample selected. Load sample applies its profile and replaces the current tune.');
  });
  button('load-button').addEventListener('click', () => { void loadSelected(); });
  button('use-sample-button').addEventListener('click', () => {
    sourceMode = 'catalog';
    applyCatalogDefaults();
    void loadSelected();
  });
  button('open-local-file').addEventListener('click', () => input('local-file').click());
  input('local-file').addEventListener('change', event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void run(() => openLocal(file));
    input('local-file').value = '';
  });
  const localDropTarget = el('local-drop-target');
  root.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    localDropTarget.classList.add('drop-active');
  });
  root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) localDropTarget.classList.remove('drop-active'); });
  root.addEventListener('drop', event => {
    event.preventDefault();
    localDropTarget.classList.remove('drop-active');
    const file = event.dataTransfer?.files[0];
    if (file) void run(() => openLocal(file));
  });
  for (const id of ['clock-select', 'model-select', 'subtune-select']) select(id).addEventListener('change', () => { report('Settings changed. Reload settings applies the new profile and restarts the tune.'); });
  button('play-button').addEventListener('click', () => { void run(async () => {
    reference.pause();
    if (state?.status === 'playing') controls.pause();
    else { await controls.play(); notice = ''; }
  }); });
  button('restart-button').addEventListener('click', () => {
    startViewport();
    held = null;
    selectedEnd = null;
    compositionPanel.follow();
    void run(async () => { reference.pause(); controls.setTimelineCenter(null); await controls.seek(0); notice = ''; });
  });
  reference.addEventListener('play', () => { controls.pause(); report('Retained reference playing. Its native transport is independent of live SID time.'); });
  reference.addEventListener('error', () => { if (reference.hasAttribute('src')) report('The retained reference could not be opened. Live SID playback remains available.', true); });
  input('seek-slider').addEventListener('input', () => { seekDragging = true; setText('heard-time', time(Number(input('seek-slider').value))); });
  input('seek-slider').addEventListener('change', () => { seekViewport = null; const target = Number(input('seek-slider').value); seekDragging = false; void run(async () => { reference.pause(); notice = ''; controls.setTimelineCenter(null); await controls.seek(target); }); });

  const heardObservations = (): DisplayedObservation => {
    const position = state?.position ?? 0;
    if (!state || ['loading', 'seeking', 'error'].includes(state.status)) {
      return {frames: [], writes: [], start: position, end: position, dropped: 0, endInclusive: false};
    }
    return {
      frames: state.frames.filter(frame => frame.time <= position),
      writes: state.writes.filter(write => write.timeSeconds <= position),
      start: state.historyStart, end: position, dropped: state.dropped, endInclusive: true,
    };
  };
  const liveObservations = (): DisplayedObservation => {
    if (!state || ['loading', 'error'].includes(state.status)) return heardObservations();
    const end = Math.min(state.renderedUntil, state.timelineCenterSeconds === null ? state.loop?.end ?? Infinity : Infinity);
    if (!liveObservationCache || liveObservationCache.epoch !== state.epoch || liveObservationCache.renderedUntil !== state.renderedUntil ||
      liveObservationCache.historyStart !== state.historyStart || liveObservationCache.end !== end || liveObservationCache.preview !== state.preview) {
      // Audio scheduling retains real observations beyond heard time, bridging a PCM cache that can evict scheduled audio.
      const retained: DisplayedObservation = {
        start: Math.min(state.historyStart, end), end, endInclusive: false,
        frames: state.historyStart <= end ? state.frames : [],
        writes: state.historyStart <= end ? state.writes : [], dropped: state.dropped,
      };
      const observations = state.preview
        ? composeTimelineObservations(retained, {...state.preview, endInclusive: false}) : retained;
      liveObservationCache = {
        epoch: state.epoch, renderedUntil: state.renderedUntil, historyStart: state.historyStart,
        end, preview: state.preview, observations,
      };
    }
    return liveObservationCache.observations;
  };
  const copyObservations = (observations: DisplayedObservation): DisplayedObservation => ({
    ...observations,
    frames: observations.frames.map(frame => ({time: frame.time, registers: [...frame.registers]})),
    writes: observations.writes.map(write => ({...write})),
  });
  const copyVisibleHistory = (): HeldHistory => {
    const history = copyObservations(heardObservations());
    const observations = copyObservations(liveObservations());
    return {
      ...observations,
      history,
      overview: state?.overview ? {...state.overview, frames:state.overview.frames.map(frame => ({time:frame.time, registers:[...frame.registers]}))} : null,
      inspectionPending: false,
      inspection: null,
      dropped: Math.max(observations.dropped, state?.dropped ?? 0),
      heardUntil: state?.position ?? 0,
      configuration: `${loadedProfile?.clock ?? ''} · ${loadedProfile?.model ?? ''} · ${state?.muted.some(Boolean) ? `muted ${state.muted.flatMap((muted, voice) => muted ? [`V${voice + 1}`] : []).join(', ')}` : 'full mix'}`,
      epoch: state?.epoch ?? 0,
      plotStart,
      plotEnd,
    };
  };
  const holdAt = (seconds: number, end: number | null = null) => {
    if (!held || state?.timelineCenterSeconds != null) held = copyVisibleHistory();
    seekViewport = null;
    controls.setTimelineCenter(null);
    cursor = seconds;
    selectedEnd = end;
    compositionPanel.selectAt(seconds, selectedFilterChip === null ? selectedVoice + 1 : null);
    const snapshot = held;
    const sequence = ++inspectionSequence;
    snapshot.inspectionPending = false;
    const captured = snapshot.overview ?? snapshot;
    if (snapshot.epoch === state?.epoch && seconds >= captured.start && seconds < captured.end &&
      !observationRegistersAt(snapshot, seconds, snapshot.endInclusive) &&
      !(snapshot.inspection && observationRegistersAt(snapshot.inspection, seconds))) {
      snapshot.inspectionPending = true;
      void controls.inspectTimeline(seconds).then(observation => {
        if (held !== snapshot || cursor !== seconds || sequence !== inspectionSequence) return;
        if (observation) snapshot.inspection = {...observation, endInclusive:false};
      }).catch(error => {
        if (held === snapshot && cursor === seconds && sequence === inspectionSequence) report(error instanceof Error ? error.message : String(error), true);
      }).finally(() => {
        if (held === snapshot && cursor === seconds && sequence === inspectionSequence) { snapshot.inspectionPending = false; draw(); }
      });
    }
    draw();
  };
  const follow = () => { seekViewport = null; held = null; selectedEnd = null; compositionPanel.follow(); timelineView = 'scroll'; controls.setTimelineCenter(null); draw(); };
  button('follow-button').addEventListener('click', () => holdAt(state?.position ?? 0));
  button('return-button').addEventListener('click', follow);
  for (const mode of ['scroll', 'fit'] as const) button(`timeline-${mode}`).addEventListener('click', () => {
    if (mode === timelineView && (mode !== 'fit' || state?.duration != null)) return;
    if (mode === 'fit') fittedEnd = timelineTotal();
    seekViewport = null;
    timelineView = mode;
    if (held && mode === 'scroll') {
      const window = followingWindow(cursor, timelineSpan);
      held.plotStart = window.start;
      held.plotEnd = window.end;
    }
    draw();
  });
  for (const [direction, step] of [['out', -1], ['in', 1]] as const) {
    button(`timeline-zoom-${direction}`).addEventListener('click', () => {
      timelineZoom = Math.max(0, Math.min(TIMELINE_DENSITIES.length - 1, timelineZoom + step));
      draw();
    });
  }
  const timelineTotal = () => Math.min(state?.duration ?? timelineLimit, MAX_SEEK_SECONDS);
  const browseAtStart = (start: number) => {
    if (!state?.info) return;
    seekViewport = null;
    const total = timelineTotal();
    const maximum = Math.max(0, total - timelineSpan);
    timelineView = 'scroll';
    const center = timelineSpan >= total ? total / 2 : Math.max(0, Math.min(maximum, start)) + timelineSpan / 2;
    controls.setTimelineCenter(center);
    draw();
  };
  const scrollTrack = el('timeline-scroll-track');
  let scrollDrag: {pointer: number; x: number; progress: number; width: number} | null = null;
  scrollTrack.addEventListener('pointerdown', event => {
    if (scrollTrack.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    scrollTrack.focus();
    const geometry = timelineScrollbarGeometry(timelineTotal(), timelineSpan, plotStart);
    if ((event.target as HTMLElement).closest('#timeline-scroll-thumb')) {
      scrollDrag = {pointer:event.pointerId, x:event.clientX, progress:geometry.maximumStart ? Math.max(0, Math.min(geometry.maximumStart, plotStart)) / geometry.maximumStart : 0, width:scrollTrack.clientWidth * (1 - geometry.thumbFraction)};
      scrollTrack.setPointerCapture(event.pointerId);
      scrollTrack.classList.add('dragging');
      browseAtStart(plotStart);
    } else {
      const thumb = el('timeline-scroll-thumb').getBoundingClientRect();
      browseAtStart(plotStart + (event.clientX < thumb.left ? -1 : 1) * timelineSpan * .9);
    }
  });
  scrollTrack.addEventListener('pointermove', event => {
    if (!scrollDrag || event.pointerId !== scrollDrag.pointer || scrollDrag.width <= 0) return;
    browseAtStart(timelineViewportStart(timelineTotal(), timelineSpan, scrollDrag.progress + (event.clientX - scrollDrag.x) / scrollDrag.width));
  });
  const releaseScroll = () => { scrollDrag = null; scrollTrack.classList.remove('dragging'); };
  scrollTrack.addEventListener('pointerup', releaseScroll);
  scrollTrack.addEventListener('pointercancel', releaseScroll);
  scrollTrack.addEventListener('lostpointercapture', releaseScroll);
  scrollTrack.addEventListener('keydown', event => {
    if (scrollTrack.getAttribute('aria-disabled') === 'true') return;
    let target: number;
    switch (event.key) {
      case 'Home': target = 0; break;
      case 'End': target = timelineTotal(); break;
      case 'ArrowLeft': target = plotStart - timelineSpan / 10; break;
      case 'ArrowRight': target = plotStart + timelineSpan / 10; break;
      case 'PageUp': target = plotStart - timelineSpan * .9; break;
      case 'PageDown': target = plotStart + timelineSpan * .9; break;
      default: return;
    }
    event.preventDefault();
    browseAtStart(target);
  });
  button('timeline-scroll-back').addEventListener('click', () => browseAtStart(plotStart - timelineSpan / 10));
  button('timeline-scroll-forward').addEventListener('click', () => browseAtStart(plotStart + timelineSpan / 10));
  const seekTimeline = (target: number) => {
    if (!state?.info || busy || state.seekTarget !== null || state.status === 'loading') return;
    const destination = Math.max(0, Math.min(timelineTotal(), target));
    const center = (plotStart + plotEnd) / 2;
    seekViewport = timelineView === 'fit' ? null : {center, span:plotEnd - plotStart, heard:null, marker:destination > center ? destination : null};
    held = null;
    selectedEnd = null;
    compositionPanel.selectAt(destination, selectedFilterChip === null ? selectedVoice + 1 : null, 'follow');
    void run(async () => {
      reference.pause();
      notice = '';
      controls.setTimelineCenter(null);
      await controls.seek(destination);
    });
  };
  const ruler = input('seek-slider');
  let rulerPointer: number | null = null;
  let rulerTarget = 0;
  const previewRulerSeek = (event: PointerEvent) => {
    const rect = ruler.getBoundingClientRect();
    ruler.value = String(Math.max(0, Math.min(timelineTotal(), plotStart + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (plotEnd - plotStart))));
    // Match native steps so PCM-frame flooring cannot undo the next keyboard step (tests/browser/unified-panel.spec.ts).
    rulerTarget = ruler.valueAsNumber;
    setText('heard-time', time(rulerTarget, true));
  };
  ruler.addEventListener('pointerdown', event => {
    if (ruler.disabled) return;
    event.preventDefault();
    ruler.focus();
    rulerPointer = event.pointerId;
    seekDragging = true;
    ruler.setPointerCapture(event.pointerId);
    previewRulerSeek(event);
  });
  ruler.addEventListener('pointermove', event => { if (rulerPointer === event.pointerId) previewRulerSeek(event); });
  ruler.addEventListener('pointerup', event => {
    if (rulerPointer !== event.pointerId) return;
    previewRulerSeek(event);
    rulerPointer = null;
    seekDragging = false;
    seekTimeline(rulerTarget);
  });
  ruler.addEventListener('pointercancel', () => { rulerPointer = null; seekDragging = false; draw(); });
  const loopEditor = mountTimelineLoop(el('timeline-loop'), {
    formatTime: seconds => time(seconds, true),
    onPreview: () => {
      const loop = loopEditor.draft() ?? selectedLoopMarkers;
      if (loop) {
        input('loop-start').value = loop.start == null ? '' : String(loop.start);
        input('loop-end').value = loop.end == null ? '' : String(loop.end);
      }
      draw();
    },
    onCommit: markers => { void run(() => editLoopMarkers(markers)); },
  });
  const applyVoiceMix = async (action: VoiceMixAction) => {
    if (!state?.info || busy || state.seekTarget != null || ['loading', 'error'].includes(state.status)) return;
    const next = updateVoiceMix(voiceMix, action);
    const mask = voiceMixMask(next);
    if (mask.some((muted, voice) => muted !== state!.muted[voice])) await controls.setMuted(mask);
    voiceMix = next;
    evidenceKey = '';
    draw();
  };
  for (const voice of VOICES) {
    button(`inspect-${voice}`).addEventListener('click', () => { selectedVoice = voice; selectedFilterChip = null; compositionPanel.selectAt(held ? cursor : state?.position ?? 0, voice + 1, held ? 'hold' : 'follow'); draw(); });
    for (const type of ['mute', 'solo'] as const) button(`${type}-${voice}`).addEventListener('click', () => { void run(() => applyVoiceMix({type, voice})); });
  }
  for (const chip of CHIPS) button(`chip-enabled-${chip}`).addEventListener('click', () => { void run(() => applyVoiceMix({type: 'chip', chip})); });
  button('restore-button').addEventListener('click', () => { void run(() => applyVoiceMix({type: 'restore'})); });
  button('diagnosis-mode').addEventListener('click', () => {
    diagnosisMode = !diagnosisMode;
    button('diagnosis-mode').setAttribute('aria-checked', String(diagnosisMode));
    el('diagnostics').hidden = !diagnosisMode;
    el('timeline-view-note').hidden = !diagnosisMode;
    el('inspector-tip-range').hidden = !diagnosisMode;
  });
  const positionPopover = (popup: HTMLElement, trigger: HTMLElement) => {
    if (!popup.matches(':popover-open')) return;
    const anchor = trigger.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 12))}px`;
    popup.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, innerHeight - bounds.height - 12))}px`;
  };
  const tip = el('inspector-tip');
  const tipButton = button('inspector-tip-button');
  const tipRow = el('inspector-note-row');
  let tipPinned = false;
  const showTip = () => { tip.showPopover(); positionPopover(tip, tipButton); };
  const hideTip = () => { if (tip.matches(':popover-open')) tip.hidePopover(); tipPinned = false; };
  tipRow.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') showTip(); });
  tipRow.addEventListener('pointerleave', () => { if (!tipPinned && !tipButton.matches(':focus')) hideTip(); });
  tipButton.addEventListener('focus', showTip);
  tipButton.addEventListener('blur', hideTip);
  tipButton.addEventListener('click', () => {
    if (tipPinned) hideTip();
    else { showTip(); tipPinned = true; }
  });
  tip.addEventListener('toggle', () => {
    const open = tip.matches(':popover-open');
    tipButton.setAttribute('aria-expanded', String(open));
    if (!open) tipPinned = false;
  });
  const positionPopovers = () => {
    positionPopover(el('library-info'), button('library-info-button'));
    positionPopover(tip, tipButton);
  };
  el('library-info').addEventListener('toggle', positionPopovers);
  window.addEventListener('resize', positionPopovers);
  window.addEventListener('scroll', positionPopovers, true);
  for (const lane of [...VOICES.map(voice => ({id: `voice-lane-${voice}`, voice, chip: Math.floor(voice / 3)})), ...CHIPS.map(chip => ({id: filterLaneId(chip), voice: null, chip}))]) {
    const {id, voice, chip} = lane;
    const canvas = el<HTMLCanvasElement>(id);
    canvas.title = 'Click to seek playback; Shift-click to inspect';
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const selectedTime = plotStart + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (plotEnd - plotStart);
      selectedFilterChip = voice === null ? chip : null;
      selectedVoice = voice ?? chip * 3 + selectedVoice % 3;
      if (event.shiftKey) holdAt(selectedTime);
      else seekTimeline(selectedTime);
    });
    canvas.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      selectedFilterChip = voice === null ? chip : null;
      selectedVoice = voice ?? chip * 3 + selectedVoice % 3;
      holdAt(Math.min(plotEnd, Math.max(plotStart, (held ? cursor : state?.position ?? 0) + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : .1))));
    });
  }
  const renderLoop = (loop = state?.loop) => {
    button('loop-button').setAttribute('aria-pressed', String(Boolean(loop)));
    setText('loop-button', loop ? 'Loop on' : 'Loop A–B');
    setText('loop-summary', loop ? `Looping ${time(loop.start, true)}–${time(loop.end, true)} · restart may briefly pause; not gapless.` : selectedLoopMarkers ? `A ${selectedLoopMarkers.start === null ? '—' : time(selectedLoopMarkers.start, true)} · B ${selectedLoopMarkers.end === null ? '—' : time(selectedLoopMarkers.end, true)} · Loop off.` : 'Set A before B. Loop restarts may briefly pause; playback is not gapless.');
    el('loop-indicator').hidden = !loop;
    el('loop-indicator').title = loop ? `Looping ${time(loop.start, true)}–${time(loop.end, true)}` : '';
  };
  const editLoopMarkers = async (markers: LoopMarkers | null) => {
    setSelectedLoopMarkers(markers);
    if (state?.loop) await controls.setLoop(markers?.start != null && markers.end != null ? {start: markers.start, end: markers.end} : null);
    draw();
  };
  const markLoopBoundary = async (boundary: 'start' | 'end', value: number | null = Number((state?.position ?? 0).toFixed(2))) => {
    const limit = Math.min(state?.duration ?? MAX_SEEK_SECONDS, MAX_SEEK_SECONDS);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > limit)) throw new Error(`Choose a loop position between 0 and ${limit} seconds.`);
    const markers = {...(selectedLoopMarkers ?? {start: null, end: null}), [boundary]: value};
    if (markers.start !== null && markers.end !== null && markers.start >= markers.end) {
      if (boundary === 'start') markers.end = null;
      else markers.start = null;
    }
    await editLoopMarkers(markers.start === null && markers.end === null ? null : markers);
  };
  const toggleLoop = async () => {
    if (state?.loop) await controls.setLoop(null);
    else {
      const markers = selectedLoopMarkers;
      if (markers?.start == null || markers.end == null) throw new Error('Set both A and B before enabling the loop.');
      await controls.setLoop({start: markers.start, end: markers.end});
    }
    draw();
  };
  const clearLoop = async () => {
    setSelectedLoopMarkers(null);
    if (state?.loop) await controls.setLoop(null);
    draw();
  };
  button('mark-a').addEventListener('click', () => { void run(() => markLoopBoundary('start')); });
  button('mark-b').addEventListener('click', () => { void run(() => markLoopBoundary('end')); });
  for (const boundary of ['start', 'end'] as const) {
    input(`loop-${boundary}`).addEventListener('change', () => {
      const field = input(`loop-${boundary}`);
      void run(() => markLoopBoundary(boundary, field.value === '' ? null : field.valueAsNumber));
    });
  }
  button('loop-button').addEventListener('click', () => { void run(toggleLoop); });
  button('clear-loop').addEventListener('click', () => { void run(clearLoop); });

  const hearPhrase = async (annotation: Pick<Annotation, 'title' | 'startSeconds' | 'endSeconds' | 'voices'>, options = {minimumContextSeconds: 4, preserveCompositionSelection: false}) => {
    seekViewport = null;
    reference.pause();
    held = null;
    controls.setTimelineCenter(null);
    cursor = annotation.startSeconds;
    selectedEnd = annotation.endSeconds;
    selectedFilterChip = null;
    selectedVoice = Math.max(0, (annotation.voices[0] ?? 1) - 1);
    if (!options.preserveCompositionSelection) compositionPanel.selectAt(annotation.startSeconds, selectedVoice + 1);
    const playbackLimit = Math.min(state?.duration ?? MAX_SEEK_SECONDS, MAX_SEEK_SECONDS);
    const {start: contextStart, end: contextEnd} = phrasePlaybackRange(annotation, playbackLimit, options.minimumContextSeconds);
    setSelectedLoopMarkers({start: contextStart, end: contextEnd});
    await controls.setLoop({ start: contextStart, end: contextEnd });
    el<HTMLDetailsElement>('loop-details').open = true;
    report(`Hearing ${annotation.title}. Playback context ${time(contextStart, true)}–${time(contextEnd, true)}; evidence span ${time(annotation.startSeconds, true)}–${time(annotation.endSeconds, true)} stays selected.`);
    draw();
    await controls.seek(contextStart);
    await controls.play();
  };
  const compositionPanel = mountCompositionPanel(el('composition-analysis'), {
    onHear: selection => { void run(() => hearPhrase(selection, {minimumContextSeconds: 0, preserveCompositionSelection: true})); },
    onSelectionChange: () => {
      const voice = compositionPanel.selection()?.voices[0];
      if (voice !== undefined) {selectedVoice = voice - 1; selectedFilterChip = null;}
      draw();
    },
  });
  const link = (text: string, href: string) => {
    const anchor = document.createElement('a');
    anchor.textContent = text;
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    return anchor;
  };
  const materialsList = el('local-build-materials').querySelector('ul')!;
  for (const material of catalog.materials) {
    const item = document.createElement('li');
    const anchor = link(material.title, material.sourceUrl);
    anchor.title = material.description;
    item.append(anchor);
    materialsList.append(item);
  }
  el('local-build-materials').hidden = catalog.materials.length === 0;

  const renderEvidence = () => {
    const matches = hasMatchingAnalysis();
    const intervention = state?.muted.some(Boolean) ?? false;
    const key = `${loadedEntry?.id}|${matches}|${intervention}`;
    if (key === evidenceKey) return;
    evidenceKey = key;
    const cards = el('evidence-cards');
    cards.replaceChildren();
    setText('analysis-badge', matches ? 'Source-linked analysis' : 'Generic inspection');
    setText('evidence-scope', matches ? `Exact catalog profile matched: ${loadedProfile?.clock} · ${loadedProfile?.model} · subtune ${loadedProfile?.subtune}.${intervention ? ' Voice intervention active; authored listening claims describe the full mix.' : ''} Timings are seconds from initialization.` : 'Generic inspection. Source-linked annotations require the exact catalog SID, clock, chip model and subtune. No instrument identity is inferred from live registers.');
    if (!matches || !loadedEntry) {
      const text = document.createElement('p');
      text.className = 'evidence-scope';
      text.textContent = loadedBytes ? 'Play, select a moment in any lane, and compare frequency, gate, pulse, waveform and shared-filter settings. These observations remain useful without annotations.' : 'Load the published sample to follow its documented sound programs, or open your own SID for live register inspection.';
      cards.append(text);
      return;
    }
    for (const annotation of loadedEntry.analysis.annotations) {
      const card = document.createElement('article');
      card.className = 'evidence-card';
      const body = document.createElement('div');
      const tag = document.createElement('span');
      tag.className = `evidence-tag ${annotation.evidenceLevel}`;
      tag.textContent = `${annotation.evidenceLevel} · ${time(annotation.startSeconds, true)}–${time(annotation.endSeconds, true)} · ${annotation.voices.length ? annotation.voices.map(voice => `V${voice}`).join(' / ') : 'Shared SID'}`;
      const title = document.createElement('h3');
      title.textContent = annotation.title;
      const description = document.createElement('p');
      description.textContent = annotation.description;
      body.append(tag, title, description, link('Read the evidence ↗', annotation.sourceUrl));
      const hear = document.createElement('button');
      hear.className = 'small quiet';
      hear.textContent = '▶ Hear phrase';
      hear.dataset.annotation = annotation.id;
      hear.addEventListener('click', () => { void run(() => hearPhrase(annotation)); });
      card.append(body, hear);
      cards.append(card);
    }
  };
  const engineLinks = el('engine-links');
  for (const [label, filename] of [['Engine license', 'engine-LICENSE.txt'], ['Notices', 'engine-NOTICES.txt'], ['Modifications', 'engine-MODIFICATIONS.txt'], ['Complete engine source ↓', 'engine-complete-source.tar.gz']]) engineLinks.append(link(label!, generated(filename!)));

  const renderSources = () => {
    const key = `${loadedEntry?.id}|${loadedLibrary?.path}|${Boolean(loadedBytes)}`;
    if (sourceKey === key) return;
    sourceKey = key;
    const links = el('source-links');
    links.replaceChildren();
    links.removeAttribute('title');
    if (loadedEntry) {
      links.append(link('Sample & attribution ↗', loadedEntry.rights.sourceUrl), link(loadedEntry.rights.license, loadedEntry.rights.licenseUrl), link('Corresponding source ↗', loadedEntry.rights.correspondingSourceUrl), link('Listening verdict ↗', loadedEntry.listening.sourceUrl), link('SID ↓', generated(loadedEntry.files.sid.filename)));
      if (loadedEntry.files.notices) links.append(link('Sample player notices ↓', generated(loadedEntry.files.notices.filename)));
      if (loadedEntry.stereo) {
        links.append(link('Stereo SID ↓', loadedEntry.stereo.sidUrl), link('Stereo WAV ↗', loadedEntry.stereo.referenceUrl));
        const scope = document.createElement('span');
        scope.textContent = 'Separate stereo arrangement downloads.';
        scope.className = 'attribution';
        links.append(scope);
      }
      const attribution = document.createElement('span');
      attribution.textContent = loadedEntry.rights.attribution;
      attribution.className = 'attribution';
      links.append(attribution);
      links.title = loadedEntry.rights.attribution;
    } else {
      if (loadedLibrary) {
        if (loadedLibrary.provider === 'SIDquake') links.append(link('SIDquake ↗', 'https://sidquake.c64demo.com/'));
        else links.append(link('SID charts ↗', 'https://www.transbyte.org/SID/HVSC_Top100.html'), link('Scene releases ↗', 'https://csdb.dk/'));
        links.append(link('HVSC ↗', 'https://hvsc.c64.org/'));
      }
      links.append(link('Explorer · GPL-3.0-or-later ↗', 'https://github.com/mbackschat/sid-song-explorer/blob/main/LICENSE'));
    }
  };

  const canvasContext = (id: string) => {
    const canvas = el<HTMLCanvasElement>(id);
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  };
  const drawLane = (id: string, frames: RegisterFrame[], writes: WriteObservation[], voice: number | null, chip: number, observedUntil: number, coverageStart: number) => {
    const plot = canvasContext(id);
    if (!plot) return;
    const { ctx, width, height } = plot;
    const x = (seconds: number) => (seconds - plotStart) / (plotEnd - plotStart) * width;
    const heardPosition = state?.position ?? 0;
    const seekMarker = seekViewport?.marker ?? null;
    const linePosition = seekMarker ?? heardPosition;
    const heardX = Math.min(width, Math.max(0, x(heardPosition)));
    ctx.fillStyle = '#20344740';
    ctx.fillRect(heardX, 0, width - heardX, height);
    ctx.strokeStyle = '#222c44';
    ctx.lineWidth = 1;
    for (let quarter = 1; quarter < 4; quarter++) { ctx.beginPath(); ctx.moveTo(width * quarter / 4, 0); ctx.lineTo(width * quarter / 4, height); ctx.stroke(); }
    const minX = Math.min(width, Math.max(0, x(coverageStart)));
    const maxX = Math.min(width, Math.max(0, x(observedUntil)));
    ctx.fillStyle = '#171a2b';
    ctx.fillRect(maxX, 0, width - maxX, height);
    ctx.fillRect(0, 0, minX, height);
    if (selectedEnd !== null) { ctx.fillStyle = '#8b72d322'; ctx.fillRect(x(cursor), 0, x(selectedEnd) - x(cursor), height); }
    let previous: RegisterFrame | null = null;
    ctx.strokeStyle = voice === null ? '#b2a1ff' : COLORS[voice % 3]!;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (const frame of frames) {
      if (frame.time < Math.max(plotStart, coverageStart) || frame.time > observedUntil) continue;
      const registers = frame.registers;
      const chipBase = chip * 32;
      const base = chipBase + (voice ?? 0) % 3 * 7;
      const value = voice === null ? ((registers[chipBase + 22] ?? 0) << 3) | ((registers[chipBase + 21] ?? 0) & 7) : ((registers[base + 1] ?? 0) << 8) | (registers[base] ?? 0);
      const normalized = voice === null ? value / 2047 : Math.log2(1 + value) / 16;
      const y = height - 15 - normalized * (height - 23);
      if (!started) { ctx.moveTo(x(frame.time), y); started = true; } else ctx.lineTo(x(frame.time), y);
      if (voice !== null && previous && ((previous.registers[base + 4] ?? 0) & 1)) {
        ctx.fillStyle = `${COLORS[voice % 3]}60`;
        ctx.fillRect(x(previous.time), height - 7, Math.max(1, x(frame.time) - x(previous.time)), 3);
      }
      previous = frame;
    }
    ctx.stroke();
    if (voice !== null) {
      let previousWaveform: number | null = null;
      for (const write of writes) {
        if (write.timeSeconds < Math.max(plotStart, coverageStart) || write.timeSeconds > observedUntil || write.sidNumber !== chip || (write.address & 31) !== voice % 3 * 7 + 4) continue;
        const waveform = write.value & 0xf0;
        if (previousWaveform !== waveform) { ctx.fillStyle = COLORS[voice % 3]!; ctx.fillRect(x(write.timeSeconds), 4, 2, 4); }
        previousWaveform = waveform;
      }
    }
    const compositionSelection = compositionPanel.selection();
    const mappedSpans = voice === null ? [] : compositionSelection?.spans.filter(span => span.voice === voice + 1 && span.endSeconds > plotStart && span.startSeconds < plotEnd) ?? [];
    for (const span of mappedSpans) {
      const left = Math.max(0, x(span.startSeconds));
      const spanWidth = Math.min(width, x(span.endSeconds)) - left;
      ctx.fillStyle = '#ccb2ff25';
      ctx.fillRect(left, 0, spanWidth, height);
      ctx.fillStyle = '#ccb2ff';
      ctx.fillRect(left, height - 3, spanWidth, 3);
    }
    const visibleLoop = loopEditor.draft() ?? selectedLoopMarkers;
    if (visibleLoop) {
      ctx.strokeStyle = '#b2a1ff';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 4]);
      for (const boundary of [visibleLoop.start, visibleLoop.end]) {
        if (boundary === null || boundary < plotStart || boundary > plotEnd) continue;
        const boundaryX = Math.max(.6, Math.min(width - .6, x(boundary)));
        ctx.beginPath();
        ctx.moveTo(boundaryX, 0);
        ctx.lineTo(boundaryX, height);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (linePosition >= plotStart && linePosition <= plotEnd) { ctx.strokeStyle = '#dce9fa'; ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x(linePosition), 0); ctx.lineTo(x(linePosition), height); ctx.stroke(); ctx.setLineDash([]); }
    if (held) { ctx.strokeStyle = '#c2a6ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x(cursor), 0); ctx.lineTo(x(cursor), height); ctx.stroke(); }
    const canvas = el(id);
    canvas.dataset.observedStart = String(coverageStart);
    canvas.dataset.observedUntil = String(observedUntil);
    canvas.dataset.futureFrames = String(frames.filter(frame => frame.time > (chartHeld?.heardUntil ?? heardPosition)).length);
    canvas.dataset.compositionOccurrence = mappedSpans.length ? compositionSelection!.id : '';
    canvas.setAttribute('aria-valuemin', plotStart.toFixed(2));
    canvas.setAttribute('aria-valuemax', plotEnd.toFixed(2));
    canvas.setAttribute('aria-valuenow', Math.max(plotStart, Math.min(plotEnd, held ? cursor : linePosition)).toFixed(2));
    canvas.setAttribute('aria-valuetext', `${time(held ? cursor : linePosition, true)} ${held ? 'held inspection' : seekMarker !== null ? 'seek point' : 'heard playback'}`);
  };
  const drawAudio = () => {
    const stereoOutput = state?.info?.channels === 2;
    const channelCount = stereoOutput ? 2 : 1;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
      const waveform = canvasContext(channelIndex === 0 ? 'waveform-plot' : 'waveform-plot-right');
      if (!waveform) continue;
      const { ctx, width, height } = waveform;
      const samples = state?.audioChannels[channelIndex]?.waveform;
      ctx.strokeStyle = '#27324b'; ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
      if (samples?.length) {
        ctx.strokeStyle = stereoOutput ? COLORS[channelIndex]! : '#7dd7d4'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x < width; x++) { const amplitude = samples[Math.floor(x / width * samples.length)] ?? 0; const y = height / 2 - amplitude * height * .45; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }
    const spectrum = canvasContext('spectrum-plot');
    if (!spectrum) return;
    const { ctx, width, height } = spectrum;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
      const frequencies = state?.audioChannels[channelIndex]?.spectrum;
      if (!frequencies?.length) continue;
      const bins = Math.min(64, frequencies.length);
      const slotWidth = width / bins;
      const channelWidth = slotWidth / channelCount;
      ctx.fillStyle = stereoOutput ? COLORS[channelIndex]! : '#ac96ed';
      for (let index = 0; index < bins; index++) {
        const start = Math.floor((index / bins) ** 2 * frequencies.length);
        const end = Math.max(start + 1, Math.floor(((index + 1) / bins) ** 2 * frequencies.length));
        let maximum = 0;
        for (let bin = start; bin < end; bin++) maximum = Math.max(maximum, frequencies[bin] ?? 0);
        const bar = maximum / 255 * (height - 5);
        ctx.fillRect(index * slotWidth + channelIndex * channelWidth, height - bar, Math.max(1, channelWidth - (stereoOutput ? 1 : 2)), bar);
      }
    }
  };
  const renderInspector = (observations: DisplayedObservation, registers: number[] | null) => {
    const {writes, start: coverageStart, end: observedUntil} = observations;
    const selectedTime = held ? cursor : state?.position ?? 0;
    setText('inspection-time', time(selectedTime, true));
    setText('inspector-title', held ? 'Held sound inspector' : 'Sound inspector');
    root.querySelector('.inspector')!.classList.toggle('held', Boolean(held));
    const coverage = held ? `Held ${inspectionSubject()} at ${time(cursor, true)}. ${state?.status === 'playing' ? 'Music continues; only inspection is frozen.' : 'Inspection is frozen independently of playback.'} ` : 'Following heard playback. ';
    setText('inspector-note', held ? `Inspecting ${time(cursor, true)}${held.inspectionPending ? ' · loading…' : ''}` : 'Following playback');
    setText('inspector-tip-text', `${coverage}${held && registers && cursor > held.heardUntil ? 'Prepared ahead of playback when held. ' : ''}${held ? `Captured ${held.configuration}. ` : ''}${held?.inspectionPending ? 'Loading selected settings…' : registers ? 'Register settings below describe the selected moment, not instrument identity or measured envelope amplitude.' : 'No retained observation at this time. Use Follow to inspect new observations.'}`);
    setText('inspector-tip-range', `Available ${time(coverageStart, true)}–${time(observedUntil, true)} · epoch ${held?.epoch ?? state?.epoch ?? 0}${registers ? ' · ordered writes applied through the cursor' : ''}${selectedEnd !== null ? ` · selected span ends ${time(selectedEnd, true)}` : ''}`);
    const chip = selectedFilterChip ?? Math.floor(selectedVoice / 3);
    const chipBase = chip * 32;
    for (const voice of VOICES) button(`inspect-${voice}`).setAttribute('aria-pressed', String(voice === selectedVoice));
    setText('filter-title', chipCount() > 1 ? `SID ${chip + 1} filter · its three voices` : 'One filter · all three voices');
    el('filter-details').dataset.sidNumber = String(chip);
    const ids = ['reg-frequency', 'reg-hz', 'reg-waveform', 'reg-gate', 'reg-pulse', 'reg-adsr', 'reg-coupling'];
    if (!registers) {
      for (const id of [...ids, 'filter-cutoff', 'filter-resonance', 'filter-low-pass', 'filter-band-pass', 'filter-high-pass', 'filter-routed', 'filter-volume', 'filter-direct']) setText(id, '—');
      setText('filter-note', 'No observed register frame at the selected time.');
    }
    else {
      const r = registers;
      const base = chipBase + selectedVoice % 3 * 7;
      const word = (offset: number) => (r[base + offset] ?? 0) | ((r[base + offset + 1] ?? 0) << 8);
      const frequency = word(0);
      const control = r[base + 4] ?? 0;
      const clockHz = loadedProfile?.clock === 'NTSC' ? 1022727 : 985248;
      setText('reg-frequency', `$${hex(frequency, 4)} · ${frequency}`);
      setText('reg-hz', `${(frequency * clockHz / 16777216).toFixed(2)} Hz`);
      setText('reg-waveform', waveforms(control));
      setText('reg-gate', `${control & 1 ? 'On' : 'Off'} / ${control & 8 ? 'On' : 'Off'}`);
      setText('reg-pulse', `${word(2) & 4095} / 4095`);
      setText('reg-adsr', `$${hex(r[base + 5] ?? 0)} / $${hex(r[base + 6] ?? 0)}`);
      setText('reg-coupling', `${control & 4 ? 'On' : 'Off'} / ${control & 2 ? 'On' : 'Off'}`);
      const route = r[chipBase + 23] ?? 0;
      const modeVolume = r[chipBase + 24] ?? 0;
      const voices = [0, 1, 2].filter(voice => route & (1 << voice)).map(voice => `V${voice + 1}`);
      setText('filter-cutoff', `${((r[chipBase + 22] ?? 0) << 3) | ((r[chipBase + 21] ?? 0) & 7)} / 2047`);
      setText('filter-resonance', `${route >> 4} / 15`);
      for (const [index, mode] of ['low-pass', 'band-pass', 'high-pass'].entries()) setText(`filter-${mode}`, modeVolume & (16 << index) ? 'On' : 'Off');
      setText('filter-routed', voices.join(', ') || 'None');
      setText('filter-volume', `${modeVolume & 15} / 15`);
      setText('filter-direct', modeVolume & 128 ? 'Off' : 'On');
      setText('filter-note', 'Settings, not a measured frequency response.');
    }
    const ordered: WriteObservation[] = [];
    for (let index = writes.length - 1; registers && index >= 0 && ordered.length < 7; index--) {
      const write = writes[index]!;
      if (write.timeSeconds < coverageStart) break;
      if (write.sidNumber !== chip) continue;
      if (write.timeSeconds <= selectedTime + .000001 && write.timeSeconds <= observedUntil) ordered.unshift(write);
    }
    const list = el('write-list');
    list.dataset.sidNumber = String(chip);
    const writeKey = `${chip}|${ordered.map(write => `${write.sidNumber}:${write.cyclePhi1}:${write.address}:${write.value}`).join('|')}`;
    if (list.dataset.key !== writeKey) {
      list.dataset.key = writeKey;
      list.replaceChildren();
      if (!ordered.length) { const item = document.createElement('li'); item.className = 'write-empty'; item.textContent = 'No retained writes at this cursor.'; list.append(item); }
      for (const write of ordered) { const item = document.createElement('li'); item.textContent = `${time(write.timeSeconds, true)}  ${chipCount() > 1 ? `SID ${write.sidNumber + 1} ` : ''}$${hex(write.address >= 0xd400 ? write.address : (state?.info?.sidChipBases[write.sidNumber] ?? 0xd400) + write.address, 4)} ← $${hex(write.value)}`; item.title = `Ordered emulation write · cycle φ1 ${write.cyclePhi1} · SID ${write.sidNumber + 1}`; list.append(item); }
    }
  };

  function draw(): void {
    const loaded = Boolean(state?.info) && !['empty', 'error', 'loading'].includes(state?.status ?? 'empty');
    const stereo = chipCount() > 1;
    if (selectedVoice >= voiceCount()) selectedVoice = 0;
    if (selectedFilterChip !== null && selectedFilterChip >= chipCount()) selectedFilterChip = null;
    for (const chip of CHIPS) {
      el(`chip-lanes-${chip}`).hidden = chip >= chipCount();
      el(`mixer-chip-${chip}`).hidden = chip >= chipCount();
      button(`chip-enabled-${chip}`).setAttribute('aria-checked', String(voiceMix.enabledChips[chip] ?? true));
      setText(`chip-enabled-${chip}`, (voiceMix.enabledChips[chip] ?? true) ? 'On' : 'Off');
      el(`chip-heading-${chip}`).hidden = !stereo;
      setText(`chip-heading-${chip}`, `SID ${chip + 1} · $${hex(state?.info?.sidChipBases[chip] ?? 0xd400, 4)} · ${chip === 0 ? 'Left' : 'Right'}`);
      el(filterLaneId(chip)).setAttribute('aria-label', stereo ? `Select SID ${chip + 1} shared filter inspection time` : 'Select shared filter inspection time');
    }
    for (const voice of VOICES) {
      button(`inspect-${voice}`).hidden = voice >= voiceCount();
      setText(`inspect-${voice}`, `Voice ${voice % 3 + 1}`);
      button(`inspect-${voice}`).setAttribute('aria-label', `Inspect ${voiceName(voice, stereo)}`);
      setText(`voice-label-${voice}`, `Voice ${voice % 3 + 1}`);
      const name = voiceName(voice, stereo).replace('Voice', 'voice');
      el(`voice-lane-${voice}`).setAttribute('aria-label', `Select inspection time for ${name}`);
      for (const operation of ['mute', 'solo']) {
        const label = `${operation === 'mute' ? 'Mute' : 'Solo'} ${name}`;
        button(`${operation}-${voice}`).setAttribute('aria-label', label);
        button(`${operation}-${voice}`).title = label;
      }
    }
    el('timeline-scroll-track').setAttribute('aria-controls', [...VOICES.filter(voice => voice < voiceCount()).map(voice => `voice-lane-${voice}`), ...CHIPS.filter(chip => chip < chipCount()).map(filterLaneId)].join(' '));
    setText('chip-profile-badge', `${chipCount()} SID${stereo ? 's' : ''} · ${(state?.info?.sidChipBases ?? [0xd400]).map(base => `$${hex(base, 4)}`).join(' / ')} · ${state?.info?.channels === 2 ? 'stereo' : 'mono'}`);
    el('chip-profile-badge').hidden = !state?.info;
    setText('output-profile-badge', `PCM · ${state?.info?.channels === 2 ? 'stereo' : 'mono'}`);
    el('output-profile-badge').hidden = !state?.info;
    setText('chip-model-label', stereo ? 'Chip model · both chips' : 'Chip model');
    el('routing-badge').hidden = !stereo;
    const stereoOutput = state?.info?.channels === 2;
    root.querySelector('.audio-body')!.classList.toggle('stereo', stereoOutput);
    el('audio-channel-left').setAttribute('aria-label', stereoOutput ? 'Left channel output' : 'Mono output');
    el('audio-channel-right').setAttribute('aria-label', 'Right channel output');
    el('audio-channel-right').hidden = !stereoOutput;
    el('audio-channel-label-left').hidden = !stereoOutput;
    el('analysis-monitor').hidden = !stereoOutput;
    setText('peak-title', stereoOutput ? 'Peak' : 'Peak · measured PCM');
    setText('rms-title', 'RMS');
    setText('waveform-source', stereoOutput ? 'Left output' : 'Audio output');
    el('waveform-plot').setAttribute('aria-label', stereoOutput ? 'Actual left output waveform' : 'Actual output waveform');
    el('spectrum-plot').setAttribute('aria-label', stereoOutput ? 'Actual left and right output frequency spectrum' : 'Actual output frequency spectrum');
    const seeking = state?.seekTarget != null;
    const preparingVoices = seeking && state?.pendingOperation === 'voice-mix';
    const preparationLabel = preparingVoices ? 'Preparing voices…' : 'Seeking…';
    const voiceMessage = preparingVoices
      ? `Preparing voice mix at ${time(state!.seekTarget!, true)}. Sound pauses while the SID replays to your position with the selected voices. Please wait…`
      : state?.error ? `Playback error: ${state.error}. Reload the tune to try again.`
      : 'Voice changes pause sound while the selected mix is prepared. Waveform-write intervention, not isolated stems; shared filtering and ring/sync coupling still apply.';
    el('voice-mix-status').setAttribute('aria-live', preparingVoices ? 'polite' : 'off');
    el('status-message').setAttribute('aria-live', preparingVoices ? 'off' : 'polite');
    setText('voice-mix-status', voiceMessage);
    el('voice-mix-status').classList.toggle('preparing', preparingVoices);
    el('mix-controls').setAttribute('aria-busy', String(preparingVoices));
    const changing = busy || state?.status === 'loading' || seeking;
    for (const id of ['play-button', 'restart-button', 'restore-button', 'mark-a', 'mark-b', 'loop-button', 'clear-loop']) button(id).disabled = !loaded || changing;
    for (const voice of VOICES) for (const operation of ['mute', 'solo']) button(`${operation}-${voice}`).disabled = !loaded || changing || voice >= voiceCount();
    for (const chip of CHIPS) button(`chip-enabled-${chip}`).disabled = !loaded || changing || chip >= chipCount();
    button('load-button').disabled = changing || sourceMode === 'catalog' && !chosenEntry;
    button('use-sample-button').disabled = changing || !chosenEntry;
    button('browse-library').disabled = changing;
    button('clear-recent-songs').disabled = changing;
    button('open-local-file').disabled = changing;
    for (const id of ['clock-select', 'model-select', 'subtune-select', 'sample-select', 'sid-highlights', 'recent-songs']) select(id).disabled = changing;
    input('local-file').disabled = changing;
    setText('play-button', seeking ? preparationLabel : state?.status === 'playing' ? 'Ⅱ Pause' : '▶ Play');
    const labels: Record<string, string> = { empty: 'Ready to load', loading: 'Loading…', ready: 'Ready', playing: 'Live SID', paused: 'Paused', seeking: 'Seeking…', ended: 'Ended', error: 'Playback error' };
    setText('play-status', busy ? 'Loading…' : seeking ? preparationLabel : labels[state?.status ?? 'empty']!);
    el('play-status').classList.toggle('live', state?.status === 'playing');
    el('status-message').classList.toggle('seeking', seeking);
    button('play-button').classList.toggle('seeking', seeking);
    if (state?.error) report(state.error, true);
    else if (seeking) {
      setText('status-message', preparingVoices ? voiceMessage : `Seeking to ${time(state!.seekTarget!, true)} — preparing sound…`);
      el('status-message').classList.remove('error');
    } else if (notice) setText('status-message', notice);
    else {
      const message = state?.status === 'playing' ? 'Live SID emulation.' : state?.status === 'ended' ? state.duration === null ? 'Playback reached the 10-minute prototype limit. Restart to listen again.' : 'Playback reached the declared ending. Restart to listen again.' : state?.status === 'paused' ? 'Live playback paused.' : loaded ? 'Ready to play.' : 'Choose the published sample or open a local file.';
      setText('status-message', message);
      el('status-message').classList.remove('error');
    }
    el('status-message').hidden = loaded && !changing && !state?.error && !notice && state?.status !== 'ended';
    const position = state?.position ?? 0;
    const transportPosition = state?.seekTarget ?? position;
    timelineLimit = Math.min(MAX_SEEK_SECONDS, Math.max(timelineLimit, position + 10, state?.renderedUntil ?? 0));
    if (!seekDragging) { input('seek-slider').max = String(Math.min(state?.duration ?? timelineLimit, MAX_SEEK_SECONDS)); input('seek-slider').value = String(transportPosition); setText('heard-time', time(transportPosition)); }
    input('seek-slider').disabled = !loaded || changing;
    input('loop-start').max = String(Math.min(state?.duration ?? MAX_SEEK_SECONDS, MAX_SEEK_SECONDS));
    input('loop-end').max = String(Math.min(state?.duration ?? MAX_SEEK_SECONDS, MAX_SEEK_SECONDS));
    input('seek-slider').setAttribute('aria-valuetext', `${time(transportPosition, true)} ${preparingVoices ? 'preparing selected voices' : seeking ? 'requested; seeking' : 'heard'}${state?.duration == null ? '; duration unknown' : ` of ${time(state.duration)}`}`);
    setText('duration-label', state?.duration != null ? `/ ${time(state.duration)}` : '/ —');
    const durationDescription = state?.duration != null ? `Duration ${time(state.duration)}` : loaded ? 'Duration unknown' : 'No SID loaded';
    el('duration-label').title = durationDescription;
    el('duration-label').setAttribute('aria-label', durationDescription);
    setText('seek-note', preparingVoices ? 'Position kept · preparing selected voices…' : seeking ? 'Requested position · restoring sound…' : state?.duration != null ? 'Heard position · white dashed cursor' : `Unknown length · current timeline limit ${time(timelineLimit)} · 10-minute prototype limit`);
    const prepared = state?.preparedRange;
    el('render-lead').dataset.preparedUntil = String(prepared?.end ?? 0);
    setText('render-lead', `${prepared ? `Prepared ${time(prepared.start)}–${time(prepared.end)}` : 'Preparing audio'} · audio queue ${Math.max(0, (state?.renderedUntil ?? 0) - position).toFixed(2)} s`);
    el('source-kind').hidden = !loadedProfile;
    el('profile-badge').hidden = !loadedProfile;
    if (loadedProfile) setText('profile-badge', `${loadedProfile.clock} · ${loadedProfile.model} · subtune ${loadedProfile.subtune}`);
    button('follow-button').classList.toggle('holding', Boolean(held));
    button('follow-button').disabled = !loaded;
    button('return-button').hidden = false;
    button('return-button').disabled = !loaded;
    button('return-button').setAttribute('aria-pressed', String(!held && !seekViewport && state?.timelineCenterSeconds == null && timelineView === 'scroll'));
    el('view-inspector').hidden = !held;
    for (const voice of VOICES) {
      button(`mute-${voice}`).setAttribute('aria-pressed', String(Boolean(voiceMix.muted[voice])));
      button(`solo-${voice}`).setAttribute('aria-pressed', String(voice < voiceMix.muted.length && voiceIsSolo(voiceMix, voice)));
    }
    const measuredSpan = Math.max(1, el<HTMLCanvasElement>('voice-lane-0').clientWidth) / TIMELINE_DENSITIES[timelineZoom]!;
    if (timelineSpan !== measuredSpan) {
      timelineSpan = measuredSpan;
      if (held) {
        const window = followingWindow(cursor, timelineSpan);
        held.plotStart = window.start;
        held.plotEnd = window.end;
      }
    }
    if (seekViewport && !seeking) {
      const elapsed = seekViewport.heard === null ? 0 : position - seekViewport.heard;
      if (elapsed < 0) seekViewport = null;
      else {
        if (state?.status === 'playing' && elapsed > 0) {
          // TIMELINE-3 in docs/PLAN.md pins right-side clicks to their note until center; only then does the line track heard time again.
          if (seekViewport.marker !== null) {
            seekViewport.center += elapsed;
            if (seekViewport.center >= seekViewport.marker) seekViewport = null;
          } else if (position >= seekViewport.center) seekViewport = null;
        }
        if (seekViewport) seekViewport.heard = position;
      }
    }
    const fitEnd = state?.duration != null ? timelineTotal() : (fittedEnd ??= timelineTotal());
    controls.setTimelineOverview(timelineView === 'fit' && !held ? fitEnd : null);
    const observationSpan = timelineSpan + (seekViewport && timelineView === 'scroll' ? 2 * Math.abs(seekViewport.center - transportPosition) : 0);
    if (state?.timelineWindowSeconds !== observationSpan) controls.setTimelineWindow(observationSpan);
    const browsing = timelineView === 'scroll' && state?.timelineCenterSeconds != null;
    if (browsing) {
      const total = timelineTotal();
      const center = timelineSpan >= total ? total / 2 : Math.max(timelineSpan / 2, Math.min(total - timelineSpan / 2, state!.timelineCenterSeconds!));
      if (center !== state!.timelineCenterSeconds) controls.setTimelineCenter(center);
    }
    chartHeld = browsing ? null : held;
    const observations = chartHeld ?? liveObservations();
    const heldOverview = chartHeld?.overview ?? null;
    const overview = timelineView === 'fit' ? chartHeld ? heldOverview : state?.overview :
      chartHeld && (cursor < chartHeld.start || cursor >= chartHeld.end) ? heldOverview : null;
    const chart = overview ?? observations;
    const {frames, start: historyStart, end: observedUntil} = chart;
    const writes = overview ? [] : observations.writes;
    const heardUntil = chartHeld?.heardUntil ?? position;
    const chartEnd = observedUntil;
    const window = loopEditor.viewport() ?? (timelineView === 'fit' ? fittedWindow(fitEnd) : seekViewport ? followingWindow(seekViewport.center, timelineSpan)
      : chartHeld ? {start: chartHeld.plotStart, end: chartHeld.plotEnd} : followingWindow(state?.timelineCenterSeconds ?? position, timelineSpan));
    plotStart = window.start;
    plotEnd = window.end;
    loopEditor.update(selectedLoopMarkers, window, Math.min(state?.duration ?? MAX_SEEK_SECONDS, MAX_SEEK_SECONDS), !loaded || changing && loopEditor.draft() === null);
    // Keep allocated marker space so Clear cannot shift the focused controls (docs/validation/mono-poc.md#stable-ruler-height).
    if (selectedLoopMarkers) el('timeline-ruler').classList.add('has-loop');
    if (el('timeline-loop').dataset.staggered === 'true') el('timeline-ruler').classList.add('loop-handles-staggered');
    renderLoop();
    const geometry = timelineScrollbarGeometry(timelineTotal(), plotEnd - plotStart, plotStart);
    const scrollDisabled = !loaded || changing || timelineView === 'fit' || geometry.disabled;
    scrollTrack.setAttribute('aria-disabled', String(scrollDisabled));
    scrollTrack.setAttribute('aria-valuemax', String(geometry.maximumStart));
    scrollTrack.setAttribute('aria-valuenow', String(Math.max(0, Math.min(geometry.maximumStart, plotStart))));
    scrollTrack.setAttribute('aria-valuetext', `${time(Math.max(0, plotStart), true)}–${time(Math.min(timelineTotal(), plotEnd), true)} visible; ${state?.duration == null ? 'length unknown; current timeline limit' : 'song duration'} ${time(timelineTotal())}`);
    scrollTrack.dataset.total = String(timelineTotal());
    scrollTrack.dataset.span = String(plotEnd - plotStart);
    setText('timeline-range-end', `${time(timelineTotal())}${state?.duration == null ? ' · length unknown' : ''}`);
    el('timeline-range-end').title = state?.duration == null ? 'Current timeline limit; song length unknown' : 'Song end';
    scrollTrack.title = timelineView === 'fit' ? 'Choose Scroll to browse the timeline' : 'Drag to browse without seeking. Arrows move; Page Up/Down page; Home/End reach the edges.';
    el('timeline-scroll-thumb').style.width = `${geometry.thumbFraction * 100}%`;
    el('timeline-scroll-thumb').style.left = `${geometry.leftFraction * 100}%`;
    button('timeline-scroll-back').disabled = scrollDisabled || plotStart <= 0;
    button('timeline-scroll-forward').disabled = scrollDisabled || plotEnd >= timelineTotal();
    button('timeline-scroll').setAttribute('aria-pressed', String(timelineView === 'scroll'));
    button('timeline-fit').setAttribute('aria-pressed', String(timelineView === 'fit'));
    setText('timeline-fit', state?.duration == null ? 'Fit timeline' : 'Fit song');
    button('timeline-fit').title = state?.duration == null ? 'Fit the current timeline range. Click again to update; song length is unknown.' : 'Fit the whole song into the chart';
    const loopInView = !chartHeld && !browsing && state?.loop && state.loop.end >= plotStart && state.loop.end <= plotEnd ? state.loop : null;
    const durationPrecision = timelineSpan < 1 ? 2 : 1;
    setText('timeline-view-note', seekViewport ? '' : timelineView === 'scroll' ? browsing ? 'Browsing · playback position unchanged' : `${Number((timelineSpan / 2).toFixed(durationPrecision))} s past · ${Number((timelineSpan / 2).toFixed(durationPrecision))} s upcoming` : state?.duration == null ? 'Length unknown · click Fit timeline to update' : 'Whole song');
    el('timeline-zoom').hidden = timelineView !== 'scroll';
    button('timeline-zoom-out').disabled = timelineZoom === 0;
    button('timeline-zoom-in').disabled = timelineZoom === TIMELINE_DENSITIES.length - 1;
    setText('timeline-scale', `${timelineSpan.toFixed(durationPrecision)} s`);
    const plotFrames = overview ? visibleTimelineFrames(frames, Math.max(plotStart, historyStart), Math.min(plotEnd, chartEnd))
      : timelinePlotFrames(observations, plotStart, plotEnd, Math.max(2, el<HTMLCanvasElement>('voice-lane-0').clientWidth * 2));
    const dropped = Math.max(chart.dropped, chartHeld?.dropped ?? Math.max(observations.dropped, state?.dropped ?? 0));
    el('history-summary').title = `${chartHeld ? 'HELD COPY' : 'PREPARED OBSERVATIONS'} ${time(historyStart, true)}–${time(observedUntil, true)} · ${frames.length} sampled frames · ${dropped} dropped writes · epoch ${chartHeld?.epoch ?? state?.epoch ?? 0}`;
    setText('history-description', held ? `Inspecting ${inspectionSubject()} at ${time(cursor, true)}${browsing ? '; browsing another passage' : ' · chart held'}${state?.status === 'playing' ? '; music continues' : ''}.` : '');
    el('history-summary').hidden = !held && dropped === 0;
    const upcoming = chartEnd > heardUntil;
    const loopBoundary = loopInView ? ` Loop returns to ${time(loopInView.start, true)} at ${time(loopInView.end, true)}; the timeline shows linear song material.` : '';
    setText('timeline-availability', chartHeld ? `Captured observations ${time(historyStart, true)}–${time(observedUntil, true)}. Heard through ${time(heardUntil, true)} when held.` : `${browsing ? `Browsing ${time(plotStart, true)}–${time(plotEnd, true)}. ` : ''}${upcoming ? `Upcoming prepared to ${time(chartEnd, true)}.` : 'Upcoming observations unavailable.'}${loopBoundary}`);
    const heldDropped = chartHeld ? 0 : held?.dropped ?? 0;
    const traceWarnings = [
      dropped ? `Trace incomplete: ${dropped} dropped writes.` : '',
      heldDropped ? `Held inspection trace incomplete: ${heldDropped} dropped writes.` : '',
    ].filter(Boolean).join(' ');
    el('trace-warning').hidden = traceWarnings.length === 0;
    setText('trace-warning', traceWarnings);
    el('history-summary').classList.toggle('held', Boolean(held));
    setText('timeline-start', time(plotStart, plotEnd - plotStart < 2));
    setText('timeline-end', time(plotEnd, plotEnd - plotStart < 2));
    setText('timeline-cursor', held ? `Held ${time(cursor, true)}` : seekViewport?.marker != null ? `Seek ${time(seekViewport.marker, true)}` : time(position, true));
    const inspectedTime = held ? cursor : position;
    const matchedComposition = state && !['loading', 'error'].includes(state.status) ? matchingCompositionPackage(compositionPackage, loadedEntry, loadedProfile, state.info) : null;
    compositionPanel.update({package: matchedComposition, timeSeconds: inspectedTime, voice: selectedFilterChip === null ? selectedVoice + 1 : null, disabled: changing || !loaded, intervention: state?.muted.some(Boolean)});
    if (compositionVisible !== Boolean(matchedComposition)) {
      compositionVisible = Boolean(matchedComposition);
      el<HTMLDetailsElement>('playback-evidence').open = !compositionVisible;
      el('playback-evidence-summary').hidden = !compositionVisible;
    }
    let inspection = held ?? observations;
    let registers = observationRegistersAt(inspection, inspectedTime, inspection.endInclusive);
    const capturedInspection = held?.overview ?? held;
    if (held?.inspection && capturedInspection && inspectedTime >= capturedInspection.start && inspectedTime < capturedInspection.end) {
      const exactRegisters = observationRegistersAt(held.inspection, inspectedTime);
      if (exactRegisters) { inspection = held.inspection; registers = exactRegisters; }
    }
    if (!registers) {
      const history = held?.history ?? heardObservations();
      const heardRegisters = observationRegistersAt(history, inspectedTime, history.endInclusive);
      if (heardRegisters) { inspection = history; registers = heardRegisters; }
    }
    for (let voice = 0; voice < voiceCount(); voice++) {
      const chip = Math.floor(voice / 3);
      setText(`lane-wave-${voice}`, registers ? waveforms(registers[chip * 32 + voice % 3 * 7 + 4] ?? 0) : 'No observation');
      drawLane(`voice-lane-${voice}`, plotFrames, writes, voice, chip, chartEnd, historyStart);
    }
    for (let chip = 0; chip < chipCount(); chip++) drawLane(filterLaneId(chip), plotFrames, writes, null, chip, chartEnd, historyStart);
    renderInspector(inspection, registers);
    for (let channelIndex = 0; channelIndex < (stereoOutput ? 2 : 1); channelIndex++) {
      const suffix = channelIndex === 0 ? '' : '-right';
      const channel = state?.audioChannels[channelIndex];
      setText(`peak-label${suffix}`, db(channel?.peakDb ?? -Infinity));
      setText(`rms-label${suffix}`, db(channel?.rmsDb ?? -Infinity));
      el(`peak-meter${suffix}`).style.width = `${Math.min(100, Math.max(0, ((channel?.peakDb ?? -60) + 60) / 60 * 100))}%`;
    }
    setText('spectrum-range', state?.info ? `0 → ${(state.info.sampleRate / 2000).toFixed(1)} kHz · frequency bins` : '0 → Nyquist');
    setText('audio-diagnostics', state?.info ? `${state.info.sampleRate.toLocaleString()} Hz PCM · ${state.underruns} buffer underruns · ${state.info.channels === 2 ? 'stereo' : 'mono'}` : 'Device-local playback · no backend');
    drawAudio();
    renderEvidence();
    root.querySelectorAll<HTMLButtonElement>('[data-annotation]').forEach(control => { control.disabled = changing || !loaded; });
    renderSources();
  }

  applyCatalogDefaults();
  updateReference();
  controls.subscribe(next => {
    if (['loading', 'error'].includes(next.status) || next.status === 'seeking' && seekViewport?.heard != null) seekViewport = null;
    state = next;
    if (next.epoch !== previousEpoch) { previousEpoch = next.epoch; timelineLimit = Math.min(MAX_SEEK_SECONDS, Math.max(30, next.position + 10)); }
    if (!animationFrame) animationFrame = requestAnimationFrame(timestamp => { animationFrame = 0; if (timestamp - lastDraw >= 70 || next.status !== 'playing') { lastDraw = timestamp; draw(); } });
  });
  window.addEventListener('resize', () => draw());
  draw();
}
