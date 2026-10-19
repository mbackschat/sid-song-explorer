import type { Catalog } from './catalog.ts';
import type { PlayerControls, PlayerState, Profile, RegisterFrame, WriteObservation, TimelineObservation } from './player-types.ts';
import { FOLLOW_WINDOW_SECONDS, followingWindow, fittedWindow, visibleTimelineFrames, observationRegistersAt } from './timeline.ts';
import {timelineScrollbarGeometry, timelineViewportStart} from './timeline-scrollbar.ts';
import logoUrl from '../assets/branding/sid-song-explorer.svg?url';
import './style.css';

type Entry = Catalog['entries'][number];
type Annotation = Entry['analysis']['annotations'][number];
type DisplayedObservation = TimelineObservation & {endInclusive: boolean};
type HeldHistory = DisplayedObservation & {
  history: DisplayedObservation;
  epoch: number;
  heardUntil: number;
  configuration: string;
  plotStart: number;
  plotEnd: number;
};
const COLORS = ['#6ee0de', '#f3c681', '#f493b5'];
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

export function mountExplorer(root: HTMLElement, controls: PlayerControls, catalog: Catalog): void {
  root.innerHTML = `
    <header class="app-header">
      <div class="brand"><img id="brand-logo" alt="SID Song Explorer sound lens" /><div><div class="brand-name">SID Song Explorer</div><div class="brand-subtitle">Hear the music. Explore the chip.</div></div></div>
      <div class="header-note"><span class="mono">COMMODORE 64</span><span class="badge">Mono POC</span></div>
    </header>
    <div class="app-shell">
      <aside class="sidebar" aria-label="Music library">
        <section><div class="eyebrow">Your listening desk</div><div class="library-mark"><span class="sid-icon mono">SID</span><div><strong>Published samples</strong><small>Source-backed listening</small></div></div>
          <label for="sample-select">Sample library</label><select id="sample-select" class="library-select"></select><button id="use-sample-button" class="small quiet library-load">Load selected sample →</button><p id="library-summary" class="library-summary"></p><details id="local-build-materials" class="local-materials"><summary>Local-build arrangements</summary><p>No audio download: build these locally using Crafter’s materials.</p><ul></ul></details>
        </section>
        <section class="local-section"><h2>Bring your own SID</h2><input id="local-file" class="file-input" type="file" accept=".sid,audio/prs.sid" /><label for="local-file" class="file-button">＋ Open local SID</label><p class="privacy-note">Stays on your device. No uploads, file-hash requests or metadata lookups. Mono PSID · max 65,662 bytes.</p></section>
        <div class="sidebar-footer"><span class="eyebrow">Made to explore</span><p>Three voices. One shared filter.<br />A whole world of sound.</p><p style="margin-top:12px"><a href="https://github.com/mbackschat/sid-song-explorer" target="_blank" rel="noreferrer">Project & source ↗</a></p></div>
      </aside>
      <main class="workspace">
        <section aria-labelledby="track-title"><div class="track-heading"><div><div class="eyebrow" id="source-kind">From the sample library</div><h1 id="track-title">Choose a SID to explore</h1><p id="track-description" class="track-description">Listen to a phrase, hold a moment, and see what the three SID voices are doing.</p><div class="track-profile"><span id="profile-badge" class="badge">PAL · MOS6581</span><span class="badge">1 SID · $D400 · mono</span><span id="analysis-badge" class="badge">Generic inspection</span></div></div><span id="play-status" class="badge">Ready to load</span></div></section>
        <div class="inspection-grid">
          <section id="timeline-panel" class="panel unified-panel" aria-labelledby="timeline-title">
            <div class="unified-toolbar"><div class="transport-buttons"><button id="play-button" class="primary" disabled>▶ Play</button><button id="restart-button" class="small quiet" disabled aria-label="Restart from beginning" title="Restart from beginning">↺</button><div class="time-display"><span id="heard-time">0:00</span> <small id="duration-label">/ —</small></div></div>
              <button id="load-button" class="small quiet">Load sample</button><div class="follow-controls"><div class="timeline-modes" role="group" aria-label="Timeline view"><button id="timeline-scroll" class="small" aria-pressed="true" title="Center heard playback with equal past and upcoming space">Scroll</button><button id="timeline-fit" class="small" aria-pressed="false" title="Fit all retained activity into the chart">Fit history</button></div><div id="timeline-zoom" class="timeline-zoom" role="group" aria-label="Timeline zoom"><button id="timeline-zoom-out" class="small" aria-label="Zoom out" title="Zoom out: show twice as much time">−</button><span id="timeline-scale" class="mono"></span><button id="timeline-zoom-in" class="small" aria-label="Zoom in" title="Zoom in: show twice the detail">+</button></div><button id="follow-button" class="small quiet" title="Hold the current moment in the Sound inspector">Hold</button><button id="return-button" class="small" aria-pressed="true" title="Return to centered playback and release held inspection">Follow</button></div></div>
            <div class="unified-heading"><h2 id="timeline-title">Voice activity</h2><small id="timeline-view-note">Centered on heard playback</small><button id="restore-button" class="small quiet" disabled>Full mix</button></div>
            <div id="mix-controls" class="lane-list" aria-busy="false"><div id="timeline-direction" class="timeline-direction"><span id="timeline-earlier">Past</span><span id="timeline-later">Upcoming · prepared</span></div>${COLORS.map((color, voice) => `<div class="voice-lane" style="--voice:${color}"><div class="voice-label"><strong>Voice ${voice + 1}</strong><small id="lane-wave-${voice}">No observation</small><div class="lane-mix"><button id="mute-${voice}" class="small" aria-label="Mute voice ${voice + 1}" aria-pressed="false" disabled title="Mute voice ${voice + 1}">M</button><button id="solo-${voice}" class="small" aria-label="Solo voice ${voice + 1}" aria-pressed="false" disabled title="Solo voice ${voice + 1}">S</button></div></div><canvas id="voice-lane-${voice}" class="lane-plot" tabindex="0" role="slider" aria-label="Select inspection time for voice ${voice + 1}" aria-valuemin="0" aria-valuemax="30" aria-valuenow="0"></canvas></div>`).join('')}
              <div class="voice-lane filter-lane" style="--voice:#b2a1ff"><div class="voice-label"><strong>Shared filter</strong><small>Cutoff register</small></div><canvas id="filter-lane" class="lane-plot" tabindex="0" role="slider" aria-label="Select shared filter inspection time" aria-valuemin="0" aria-valuemax="30" aria-valuenow="0"></canvas></div><div class="timeline-ruler"><input id="seek-slider" type="range" min="0" max="30" step="0.01" value="0" disabled aria-label="Seek playback in seconds" title="Click or drag the ruler to seek; arrow keys adjust playback" /><div class="timeline-key mono"><span id="timeline-start">0:00</span><span id="timeline-cursor">Heard playhead</span><span id="timeline-end">0:30</span></div></div><div class="timeline-scrollbar"><button id="timeline-scroll-back" class="small" aria-label="Scroll timeline earlier">◀</button><div id="timeline-scroll-track" tabindex="0" role="scrollbar" aria-label="Browse timeline" aria-controls="voice-lane-0 voice-lane-1 voice-lane-2 filter-lane" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div id="timeline-scroll-thumb"></div></div><button id="timeline-scroll-forward" class="small" aria-label="Scroll timeline later">▶</button></div>
            </div><div class="timeline-feedback"><span id="timeline-availability"></span><div id="status-message" class="status-line" role="status" aria-live="polite">Choose a sample to begin.</div></div>
            <div id="history-summary" class="history-summary"><span id="history-description">No retained observations yet.</span> <span id="trace-warning" role="status" hidden></span> <a id="view-inspector" href="#inspector-title" hidden>View inspector →</a></div>
            <p id="voice-mix-status" class="intervention-note" role="status" aria-live="polite" aria-atomic="true"></p>
            <div class="panel-options"><details id="loop-details"><summary>Loop A–B</summary>
            <div class="loop-row"><label><span>A · seconds</span><input id="loop-start" class="loop-time" type="number" min="0" step="0.01" value="0" aria-label="Loop start in seconds" /></label><button id="mark-a" class="small quiet" disabled>Set A</button><label><span>B · seconds</span><input id="loop-end" class="loop-time" type="number" min="0" step="0.01" value="8" aria-label="Loop end in seconds" /></label><button id="mark-b" class="small quiet" disabled>Set B</button><button id="loop-button" class="small" aria-pressed="false" disabled>Loop A–B</button><button id="clear-loop" class="small quiet" disabled>Clear</button><span id="loop-summary" class="loop-summary">Set A before B. Loop restarts may briefly pause; playback is not gapless.</span></div></details><details id="playback-setup"><summary>Playback setup</summary><div class="settings"><label><span>Clock</span><select id="clock-select"><option>PAL</option><option>NTSC</option></select></label><label><span>Chip model</span><select id="model-select"><option value="MOS6581">MOS 6581</option><option value="MOS8580">MOS 8580</option></select></label><label><span>Subtune</span><select id="subtune-select"><option value="1">1</option></select></label><p id="settings-note" class="settings-note">Settings apply when you load. Prepared audio supports quick seeking; other positions need preparation. Trace timestamp alignment is approximate.</p></div></details><details id="timeline-help"><summary>Help & details</summary><p class="timeline-help">Drag the proportional scrollbar to browse without changing sound. Click or drag the time ruler to seek when released. Click a lane to seek playback. Shift-click a lane to inspect its settings; Hold captures the current heard position. Follow returns to centered playback. Zoom changes detail; wider charts show more time at the same zoom. Shading marks unavailable observations. Fit history shows retained heard activity. A line shows register frequency, not loudness; gate clear can still release sound.</p><div class="transport-foot"><span id="seek-note"></span><span id="render-lead"></span></div></details></div>
          </section>
          <aside class="panel inspector" aria-labelledby="inspector-title"><div class="panel-header"><h2 id="inspector-title" tabindex="-1">Sound inspector</h2><span id="inspection-time" class="inspection-time mono">0:00.00</span></div><div class="inspector-body"><p id="inspector-note" class="inspector-note">Following heard playback. Register settings are derived observations, not recovered instruments or measured envelope amplitude.</p><div class="voice-tabs" role="group" aria-label="Inspect voice">${COLORS.map((_, voice) => `<button id="inspect-${voice}" class="small" aria-pressed="${voice === 0}">Voice ${voice + 1}</button>`).join('')}</div>
            <dl class="register-grid"><div><dt>Frequency register</dt><dd id="reg-frequency">—</dd></div><div><dt>Derived oscillator Hz</dt><dd id="reg-hz">—</dd></div><div class="wide"><dt>Waveform selection</dt><dd id="reg-waveform">—</dd></div><div><dt>Gate / Test</dt><dd id="reg-gate">—</dd></div><div><dt>Pulse width · 12-bit</dt><dd id="reg-pulse">—</dd></div><div><dt>AD / SR settings</dt><dd id="reg-adsr">—</dd></div><div><dt>Ring / Sync</dt><dd id="reg-coupling">—</dd></div></dl>
            <h3 class="inspector-subhead">One filter · all three voices</h3><div id="filter-details" class="shared-filter">No observed register frame.</div><h3 class="inspector-subhead">Last ordered writes ≤ cursor</h3><ol id="write-list" class="write-list"><li class="write-empty">Load and play to collect writes.</li></ol></div></aside>
        </div>
        <div class="bottom-grid"><section class="panel" aria-labelledby="evidence-title"><div class="panel-header"><h2 id="evidence-title">Listen a little closer</h2><span class="badge">Linked evidence</span></div><div class="evidence-body"><p id="evidence-scope" class="evidence-scope">Authored annotations apply only to their exact catalog file, clock, chip model and subtune.</p><div id="evidence-cards"></div></div></section>
          <section class="panel" aria-labelledby="output-title"><div class="panel-header"><h2 id="output-title">Audio output</h2><span class="badge">PCM · mono</span></div><div class="audio-body"><div class="meter-label"><span>Peak · measured PCM</span><span id="peak-label" class="mono">−∞ dBFS</span></div><div class="meter-track"><span id="peak-meter" class="meter-level"></span></div><div class="meter-label"><span>RMS</span><span id="rms-label" class="mono">−∞ dBFS</span></div><canvas id="waveform-plot" class="audio-plot" aria-label="Actual output waveform"></canvas><div class="plot-caption"><span>WAVEFORM</span><span>Audio output</span></div><canvas id="spectrum-plot" class="audio-plot" aria-label="Actual output frequency spectrum"></canvas><div class="plot-caption"><span>SPECTRUM</span><span id="spectrum-range">0 → Nyquist</span></div></div><div id="reference-section" class="reference-body"><h3>Retained reference · WAV</h3><p id="reference-scope">Load a catalog sample for its retained listening reference.</p><audio id="reference-audio" controls preload="none" aria-label="Retained reference recording"></audio></div></section>
        </div>
        <footer class="source-footer"><div id="source-links" class="source-links"></div><span id="audio-diagnostics">Device-local playback · no backend</span><div id="engine-links" class="source-links" aria-label="Playback engine licenses and source"></div></footer>
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
  let localBytes: Uint8Array | null = null;
  let sourceMode: 'catalog' | 'local' = 'catalog';
  let localName = '';
  let loadedProfile: Profile | null = null;
  let state: PlayerState | null = null;
  let held: HeldHistory | null = null;
  let chartHeld: HeldHistory | null = null;
  let timelineView: 'scroll' | 'fit' = 'scroll';
  let timelineZoom = TIMELINE_DENSITIES.indexOf(64);
  let timelineSpan = FOLLOW_WINDOW_SECONDS;
  let seekViewport: {center: number; span: number; heard: number | null} | null = null;
  let cursor = 0;
  let selectedEnd: number | null = null;
  let selectedVoice = 0;
  let selectedFilter = false;
  const inspectionSubject = () => selectedFilter ? 'Shared filter' : `Voice ${selectedVoice + 1}`;
  let busy = false;
  let notice = '';
  let seekDragging = false;
  let exploredUntil = 30;
  let animationFrame = 0;
  let lastDraw = 0;
  let plotStart = 0;
  let plotEnd = FOLLOW_WINDOW_SECONDS;
  let evidenceKey = '';
  let sourceKey = '';
  let previousEpoch = -1;

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
    if (!loadedBytes) {
      setText('track-title', chosenEntry.title);
      setText('track-description', chosenEntry.description);
      setText('profile-badge', `${chosenEntry.target.clock} · ${chosenEntry.target.model}`);
    }
  };
  const updateReference = () => {
    reference.pause();
    if (loadedEntry) {
      reference.src = generated(loadedEntry.files.reference.filename);
      setText('reference-scope', `${loadedEntry.listening.status}: ${loadedEntry.listening.scope} This retained render is separate from live emulation.`);
      el('reference-section').hidden = false;
    } else {
      reference.removeAttribute('src');
      reference.load();
      el('reference-section').hidden = true;
    }
  };
  const resetInspection = () => { seekViewport = null; held = null; cursor = 0; selectedEnd = null; exploredUntil = 30; evidenceKey = ''; sourceKey = ''; };
  const loadBytes = async (bytes: Uint8Array, entry: Entry | null) => {
    reference.pause();
    const profile = currentProfile();
    loadedEntry = null;
    loadedProfile = null;
    evidenceKey = '';
    updateReference();
    await controls.load(bytes, profile);
    loadedBytes = bytes;
    loadedEntry = entry;
    loadedProfile = profile;
    resetInspection();
    if (state?.info) setSubtunes(state.info.songs, state.info.subtune);
    setText('track-title', entry?.title ?? state?.info?.title ?? localName);
    setText('track-description', entry?.description ?? `${state?.info?.author || 'Unknown author'}${state?.info?.released ? ` · ${state.info.released}` : ''}. Generic inspection from locally observed SID registers.`);
    setText('source-kind', entry ? 'From the sample library' : `Local file · ${localName}`);
    setText('load-button', 'Reload settings');
    updateReference();
    report('Loaded. Press Play to start live SID emulation.');
  };
  const loadSelected = async () => {
    if (busy) return;
    busy = true;
    draw();
    try {
      if (sourceMode === 'local') {
        if (!localBytes) throw new Error('Open a local SID first.');
        report('Reloading local SID with the selected settings…');
        await loadBytes(localBytes, null);
      } else {
        if (!chosenEntry) throw new Error('No catalog samples are available. Open a local mono PSID.');
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
  const openLocal = async (file: File) => {
    if (busy) return;
    if (file.size > MAX_FILE_BYTES) throw new Error(`This prototype accepts SID files up to ${MAX_FILE_BYTES.toLocaleString()} bytes.`);
    busy = true;
    draw();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length < 118 || String.fromCharCode(...bytes.slice(0, 4)) !== 'PSID') throw new Error('Open a mono PSID .sid file. RSID and ROM-dependent formats are outside this prototype.');
      const header = new DataView(bytes.buffer);
      const version = header.getUint16(4);
      const songs = header.getUint16(14);
      const start = header.getUint16(16);
      if (version < 1 || version > 4 || songs < 1 || songs > 256 || start < 1 || start > songs) throw new Error('The PSID header has an unsupported version or invalid subtune information.');
      if (version >= 2 && bytes.length < 124) throw new Error('The PSID header is truncated.');
      if ((version >= 3 && bytes[122]) || (version >= 4 && bytes[123])) throw new Error('This first prototype supports one mono SID. This file declares additional chips.');
      const flags = version >= 2 ? header.getUint16(118) : 0;
      select('clock-select').value = ((flags >> 2) & 3) === 2 ? 'NTSC' : 'PAL';
      select('model-select').value = ((flags >> 4) & 3) === 2 ? 'MOS8580' : 'MOS6581';
      setSubtunes(songs, start);
      sourceMode = 'local';
      localBytes = bytes;
      localName = file.name;
      report('Opening local SID on this device…');
      await loadBytes(bytes, null);
    } finally {
      busy = false;
      draw();
    }
  };

  sampleSelect.addEventListener('change', () => {
    chosenEntry = catalog.entries.find(entry => entry.id === sampleSelect.value) ?? null;
    sourceMode = 'catalog';
    applyCatalogDefaults();
    setText('load-button', 'Load sample');
    report('Sample selected. Load sample applies its profile and replaces the current tune.');
  });
  button('load-button').addEventListener('click', () => { void loadSelected(); });
  button('use-sample-button').addEventListener('click', () => {
    sourceMode = 'catalog';
    applyCatalogDefaults();
    void loadSelected();
  });
  input('local-file').addEventListener('change', event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void run(() => openLocal(file));
    input('local-file').value = '';
  });
  root.addEventListener('dragover', event => { event.preventDefault(); root.classList.add('drop-active'); });
  root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('drop-active'); });
  root.addEventListener('drop', event => {
    event.preventDefault();
    root.classList.remove('drop-active');
    const file = event.dataTransfer?.files[0];
    if (file) void run(() => openLocal(file));
  });
  for (const id of ['clock-select', 'model-select', 'subtune-select']) select(id).addEventListener('change', () => { report('Settings changed. Reload settings applies the new profile and restarts the tune.'); });
  button('play-button').addEventListener('click', () => { void run(async () => {
    reference.pause();
    if (state?.status === 'playing') controls.pause();
    else { await controls.play(); notice = ''; }
  }); });
  button('restart-button').addEventListener('click', () => { seekViewport = null; void run(async () => { reference.pause(); controls.setTimelineCenter(null); await controls.seek(0); notice = ''; }); });
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
  const liveObservations = (): DisplayedObservation => timelineView === 'scroll' && state?.preview
    ? {...state.preview, endInclusive: false} : heardObservations();
  const copyObservations = (observations: DisplayedObservation): DisplayedObservation => ({
    ...observations,
    frames: observations.frames.map(frame => ({time: frame.time, registers: [...frame.registers]})),
    writes: observations.writes.map(write => ({...write})),
  });
  const copyVisibleHistory = (): HeldHistory => {
    const history = copyObservations(heardObservations());
    const observations = timelineView === 'scroll' && state?.preview
      ? copyObservations({...state.preview, endInclusive: false}) : history;
    return {
      ...observations,
      history,
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
    draw();
  };
  const follow = () => { seekViewport = null; held = null; selectedEnd = null; timelineView = 'scroll'; controls.setTimelineCenter(null); draw(); };
  button('follow-button').addEventListener('click', () => holdAt(state?.position ?? 0));
  button('return-button').addEventListener('click', follow);
  for (const mode of ['scroll', 'fit'] as const) button(`timeline-${mode}`).addEventListener('click', () => {
    if (mode === timelineView) return;
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
  const timelineTotal = () => Math.min(state?.duration ?? exploredUntil, MAX_SEEK_SECONDS);
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
    seekViewport = {center:(plotStart + plotEnd) / 2, span:plotEnd - plotStart, heard:null};
    held = null;
    selectedEnd = null;
    void run(async () => {
      reference.pause();
      notice = '';
      controls.setTimelineCenter(null);
      await controls.seek(Math.max(0, Math.min(timelineTotal(), target)));
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
  for (let voice = 0; voice < 3; voice++) {
    button(`inspect-${voice}`).addEventListener('click', () => { selectedVoice = voice; selectedFilter = false; draw(); });
    button(`mute-${voice}`).addEventListener('click', () => { void run(async () => {
      const mask = [...(state?.muted ?? [false, false, false])];
      mask[voice] = !mask[voice];
      await controls.setMuted(mask);
      evidenceKey = '';
    }); });
    button(`solo-${voice}`).addEventListener('click', () => { void run(async () => {
      const soloed = state?.muted.every((muted, index) => muted === (index !== voice));
      await controls.setMuted(soloed ? [false, false, false] : [0, 1, 2].map(index => index !== voice));
      evidenceKey = '';
    }); });
  }
  button('restore-button').addEventListener('click', () => { void run(async () => { await controls.setMuted([false, false, false]); evidenceKey = ''; }); });
  for (const id of ['voice-lane-0', 'voice-lane-1', 'voice-lane-2', 'filter-lane']) {
    const canvas = el<HTMLCanvasElement>(id);
    canvas.title = 'Click to seek playback; Shift-click to inspect';
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const selectedTime = plotStart + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (plotEnd - plotStart);
      selectedFilter = id === 'filter-lane';
      if (!selectedFilter) selectedVoice = Number(id.slice(-1));
      if (event.shiftKey) holdAt(selectedTime);
      else seekTimeline(selectedTime);
    });
    canvas.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      selectedFilter = id === 'filter-lane';
      if (!selectedFilter) selectedVoice = Number(id.slice(-1));
      holdAt(Math.min(plotEnd, Math.max(plotStart, (held ? cursor : state?.position ?? 0) + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : .1))));
    });
  }
  button('mark-a').addEventListener('click', () => { input('loop-start').value = (state?.position ?? 0).toFixed(2); });
  button('mark-b').addEventListener('click', () => { input('loop-end').value = (state?.position ?? 0).toFixed(2); });
  button('loop-button').addEventListener('click', () => { void run(async () => {
    if (state?.loop) { await controls.setLoop(null); return; }
    const start = input('loop-start').valueAsNumber;
    const end = input('loop-end').valueAsNumber;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > Math.min(state?.duration ?? MAX_SEEK_SECONDS, MAX_SEEK_SECONDS)) throw new Error(`Choose a valid loop: A ≥ 0, B > A, and B at most ${Math.min(state?.duration ?? MAX_SEEK_SECONDS, MAX_SEEK_SECONDS)} seconds.`);
    await controls.setLoop({ start, end });
    report(`Loop set from ${time(start, true)} to ${time(end, true)}. Start playback to hear it.`);
  }); });
  button('clear-loop').addEventListener('click', () => { void run(async () => { await controls.setLoop(null); }); });

  const hearPhrase = async (annotation: Annotation) => {
    seekViewport = null;
    reference.pause();
    controls.setTimelineCenter(null);
    held = copyVisibleHistory();
    held.plotStart = annotation.startSeconds;
    held.plotEnd = annotation.startSeconds + FOLLOW_WINDOW_SECONDS;
    cursor = annotation.startSeconds;
    selectedEnd = annotation.endSeconds;
    selectedFilter = false;
    selectedVoice = Math.max(0, (annotation.voices[0] ?? 1) - 1);
    const playbackLimit = Math.min(state?.duration ?? MAX_SEEK_SECONDS, MAX_SEEK_SECONDS);
    const contextEnd = Math.min(playbackLimit, Math.max(annotation.endSeconds, annotation.startSeconds + 4));
    const contextStart = Math.max(0, Math.min(annotation.startSeconds, contextEnd - 4));
    input('loop-start').value = String(contextStart);
    input('loop-end').value = String(contextEnd);
    await controls.setLoop({ start: contextStart, end: contextEnd });
    report(`Hearing ${annotation.title}. Playback context ${time(contextStart, true)}–${time(contextEnd, true)}; evidence span ${time(annotation.startSeconds, true)}–${time(annotation.endSeconds, true)} stays selected. The held view contains only observations available when selected; Follow returns to new activity.`);
    draw();
    await controls.seek(contextStart);
    await controls.play();
  };
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
    const key = `${loadedEntry?.id}|${Boolean(loadedBytes)}`;
    if (sourceKey === key) return;
    sourceKey = key;
    const links = el('source-links');
    links.replaceChildren();
    if (loadedEntry) {
      links.append(link('Sample & attribution ↗', loadedEntry.rights.sourceUrl), link(loadedEntry.rights.license, loadedEntry.rights.licenseUrl), link('Corresponding source ↗', loadedEntry.rights.correspondingSourceUrl), link('Listening verdict ↗', loadedEntry.listening.sourceUrl), link('SID ↓', generated(loadedEntry.files.sid.filename)));
      if (loadedEntry.files.notices) links.append(link('Sample player notices ↓', generated(loadedEntry.files.notices.filename)));
      if (loadedEntry.stereo) {
        links.append(link('Stereo SID ↓', loadedEntry.stereo.sidUrl), link('Stereo WAV ↗', loadedEntry.stereo.referenceUrl));
        const scope = document.createElement('span');
        scope.textContent = 'Live inspection uses the mono version. The stereo SID requires a two-SID player.';
        scope.className = 'attribution';
        links.append(scope);
      }
      const attribution = document.createElement('span');
      attribution.textContent = loadedEntry.rights.attribution;
      attribution.className = 'attribution';
      links.append(attribution);
      links.title = loadedEntry.rights.attribution;
    } else links.append(link('Explorer · GPL-3.0-or-later ↗', 'https://github.com/mbackschat/sid-song-explorer/blob/main/LICENSE'));
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
  const drawLane = (id: string, frames: RegisterFrame[], writes: WriteObservation[], voice: number | null, observedUntil: number, coverageStart: number) => {
    const plot = canvasContext(id);
    if (!plot) return;
    const { ctx, width, height } = plot;
    const x = (seconds: number) => (seconds - plotStart) / (plotEnd - plotStart) * width;
    const heardPosition = state?.position ?? 0;
    const heardX = Math.min(width, Math.max(0, x(chartHeld?.heardUntil ?? heardPosition)));
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
    if (selectedEnd !== null && held) { ctx.fillStyle = '#8b72d322'; ctx.fillRect(x(cursor), 0, x(selectedEnd) - x(cursor), height); }
    let previous: RegisterFrame | null = null;
    const stride = Math.max(1, Math.floor(frames.length / Math.max(1, width * 2)));
    ctx.strokeStyle = voice === null ? '#b2a1ff' : COLORS[voice]!;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (let index = 0; index < frames.length; index += stride) {
      const frame = frames[index]!;
      if (frame.time < Math.max(plotStart, coverageStart) || frame.time > observedUntil) continue;
      const registers = frame.registers;
      const base = (voice ?? 0) * 7;
      const value = voice === null ? ((registers[22] ?? 0) << 3) | ((registers[21] ?? 0) & 7) : ((registers[base + 1] ?? 0) << 8) | (registers[base] ?? 0);
      const normalized = voice === null ? value / 2047 : Math.log2(1 + value) / 16;
      const y = height - 15 - normalized * (height - 23);
      if (!started) { ctx.moveTo(x(frame.time), y); started = true; } else ctx.lineTo(x(frame.time), y);
      if (voice !== null && previous && ((previous.registers[base + 4] ?? 0) & 1)) {
        ctx.fillStyle = `${COLORS[voice]}60`;
        ctx.fillRect(x(previous.time), height - 7, Math.max(1, x(frame.time) - x(previous.time)), 3);
      }
      previous = frame;
    }
    ctx.stroke();
    if (voice !== null) {
      let previousWaveform: number | null = null;
      for (const write of writes) {
        if (write.timeSeconds < Math.max(plotStart, coverageStart) || write.timeSeconds > observedUntil || (write.address & 31) !== voice * 7 + 4) continue;
        const waveform = write.value & 0xf0;
        if (previousWaveform !== waveform) { ctx.fillStyle = COLORS[voice]!; ctx.fillRect(x(write.timeSeconds), 4, 2, 4); }
        previousWaveform = waveform;
      }
    }
    if (heardPosition >= plotStart && heardPosition <= plotEnd) { ctx.strokeStyle = '#dce9fa'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x(heardPosition), 0); ctx.lineTo(x(heardPosition), height); ctx.stroke(); ctx.setLineDash([]); }
    if (held) { ctx.strokeStyle = '#c2a6ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x(cursor), 0); ctx.lineTo(x(cursor), height); ctx.stroke(); }
    const canvas = el(id);
    canvas.dataset.observedStart = String(coverageStart);
    canvas.dataset.observedUntil = String(observedUntil);
    canvas.dataset.futureFrames = String(frames.filter(frame => frame.time > (chartHeld?.heardUntil ?? heardPosition)).length);
    canvas.setAttribute('aria-valuemin', plotStart.toFixed(2));
    canvas.setAttribute('aria-valuemax', plotEnd.toFixed(2));
    canvas.setAttribute('aria-valuenow', Math.max(plotStart, Math.min(plotEnd, held ? cursor : heardPosition)).toFixed(2));
    canvas.setAttribute('aria-valuetext', `${time(held ? cursor : heardPosition, true)} ${held ? 'held inspection' : 'heard playback'}`);
  };
  const drawAudio = () => {
    const waveform = canvasContext('waveform-plot');
    if (waveform) {
      const { ctx, width, height } = waveform;
      ctx.strokeStyle = '#27324b'; ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
      if (state?.waveform.length) {
        ctx.strokeStyle = '#7dd7d4'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x < width; x++) { const amplitude = state.waveform[Math.floor(x / width * state.waveform.length)] ?? 0; const y = height / 2 - amplitude * height * .45; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }
    const spectrum = canvasContext('spectrum-plot');
    if (spectrum && state?.spectrum.length) {
      const { ctx, width, height } = spectrum;
      const bins = Math.min(64, state.spectrum.length);
      ctx.fillStyle = '#ac96ed';
      for (let index = 0; index < bins; index++) {
        const start = Math.floor((index / bins) ** 2 * state.spectrum.length);
        const end = Math.max(start + 1, Math.floor(((index + 1) / bins) ** 2 * state.spectrum.length));
        let maximum = 0;
        for (let bin = start; bin < end; bin++) maximum = Math.max(maximum, state.spectrum[bin] ?? 0);
        const bar = maximum / 255 * (height - 5);
        ctx.fillRect(index / bins * width, height - bar, Math.max(1, width / bins - 2), bar);
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
    setText('inspector-note', `${coverage}${held && registers && cursor > held.heardUntil ? 'Prepared ahead of playback when held. ' : ''}${held ? `Captured ${held.configuration}. ` : ''}${registers ? 'Register settings below describe the selected moment, not instrument identity or measured envelope amplitude.' : 'No retained observation at this time. Use Follow to inspect new observations.'}`);
    el('inspector-note').title = `Available ${time(coverageStart, true)}–${time(observedUntil, true)} · epoch ${held?.epoch ?? state?.epoch ?? 0}${registers ? ' · ordered writes applied through the cursor' : ''}${selectedEnd !== null ? ` · selected span ends ${time(selectedEnd, true)}` : ''}`;
    for (let voice = 0; voice < 3; voice++) button(`inspect-${voice}`).setAttribute('aria-pressed', String(voice === selectedVoice));
    const ids = ['reg-frequency', 'reg-hz', 'reg-waveform', 'reg-gate', 'reg-pulse', 'reg-adsr', 'reg-coupling'];
    if (!registers) { for (const id of ids) setText(id, '—'); setText('filter-details', 'No observed register frame at the selected time.'); }
    else {
      const r = registers;
      const base = selectedVoice * 7;
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
      const route = r[23] ?? 0;
      const modeVolume = r[24] ?? 0;
      const modes = ['Low-pass', 'Band-pass', 'High-pass'].filter((_, index) => modeVolume & (16 << index));
      const voices = [0, 1, 2].filter(voice => route & (1 << voice)).map(voice => `V${voice + 1}`);
      setText('filter-details', `Cutoff ${((r[22] ?? 0) << 3) | ((r[21] ?? 0) & 7)} / 2047 · resonance ${route >> 4} / 15. ${modes.join(' + ') || 'No filter mode'}. Routed: ${voices.join(', ') || 'none'}. Master volume ${modeVolume & 15} / 15${modeVolume & 128 ? ' · V3 direct off' : ''}. Settings, not a measured frequency response.`);
    }
    const ordered: WriteObservation[] = [];
    for (let index = writes.length - 1; registers && index >= 0 && ordered.length < 7; index--) {
      const write = writes[index]!;
      if (write.timeSeconds < coverageStart) break;
      if (write.timeSeconds <= selectedTime + .000001 && write.timeSeconds <= observedUntil) ordered.unshift(write);
    }
    const list = el('write-list');
    const writeKey = ordered.map(write => `${write.cyclePhi1}:${write.address}:${write.value}`).join('|');
    if (list.dataset.key !== writeKey) {
      list.dataset.key = writeKey;
      list.replaceChildren();
      if (!ordered.length) { const item = document.createElement('li'); item.className = 'write-empty'; item.textContent = 'No retained writes at this cursor.'; list.append(item); }
      for (const write of ordered) { const item = document.createElement('li'); item.textContent = `${time(write.timeSeconds, true)}  $${hex(write.address >= 0xd400 ? write.address : 0xd400 + write.address, 4)} ← $${hex(write.value)}`; item.title = `Ordered emulation write · cycle φ1 ${write.cyclePhi1} · SID ${write.sidNumber}`; list.append(item); }
    }
  };

  function draw(): void {
    const loaded = Boolean(state?.info) && !['empty', 'error', 'loading'].includes(state?.status ?? 'empty');
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
    for (const id of ['play-button', 'restart-button', 'restore-button', 'mark-a', 'mark-b', 'loop-button', 'clear-loop', 'mute-0', 'mute-1', 'mute-2', 'solo-0', 'solo-1', 'solo-2']) button(id).disabled = !loaded || changing;
    button('load-button').disabled = changing || sourceMode === 'catalog' && !chosenEntry;
    button('use-sample-button').disabled = changing || !chosenEntry;
    for (const id of ['clock-select', 'model-select', 'subtune-select', 'sample-select']) select(id).disabled = changing;
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
    el('timeline-availability').hidden = !el('status-message').hidden;
    const position = state?.position ?? 0;
    const transportPosition = state?.seekTarget ?? position;
    exploredUntil = Math.min(MAX_SEEK_SECONDS, Math.max(exploredUntil, position + 10, state?.renderedUntil ?? 0));
    if (!seekDragging) { input('seek-slider').max = String(Math.min(state?.duration ?? exploredUntil, MAX_SEEK_SECONDS)); input('seek-slider').value = String(transportPosition); setText('heard-time', time(transportPosition)); }
    input('seek-slider').disabled = !loaded || changing;
    input('loop-start').max = String(Math.min(state?.duration ?? MAX_SEEK_SECONDS, MAX_SEEK_SECONDS));
    input('loop-end').max = String(Math.min(state?.duration ?? MAX_SEEK_SECONDS, MAX_SEEK_SECONDS));
    input('seek-slider').setAttribute('aria-valuetext', `${time(transportPosition, true)} ${preparingVoices ? 'preparing selected voices' : seeking ? 'requested; seeking' : 'heard'}${state?.duration == null ? '; duration unknown' : ` of ${time(state.duration)}`}`);
    setText('duration-label', state?.duration != null ? `/ ${time(state.duration)}` : '/ duration unknown');
    setText('seek-note', preparingVoices ? 'Position kept · preparing selected voices…' : seeking ? 'Requested position · restoring sound…' : state?.duration != null ? 'Heard position · white dashed cursor' : `Unknown duration · explored seek window ${time(exploredUntil)} · 10-minute prototype limit`);
    const prepared = state?.preparedRange;
    el('render-lead').dataset.preparedUntil = String(prepared?.end ?? 0);
    setText('render-lead', `${prepared ? `Prepared ${time(prepared.start)}–${time(prepared.end)}` : 'Preparing audio'} · audio queue ${Math.max(0, (state?.renderedUntil ?? 0) - position).toFixed(2)} s`);
    if (loadedProfile) setText('profile-badge', `${loadedProfile.clock} · ${loadedProfile.model} · subtune ${loadedProfile.subtune}`);
    button('follow-button').classList.toggle('holding', Boolean(held));
    button('follow-button').disabled = !loaded;
    button('return-button').hidden = false;
    button('return-button').disabled = !loaded;
    button('return-button').setAttribute('aria-pressed', String(!held && !seekViewport && state?.timelineCenterSeconds == null && timelineView === 'scroll'));
    el('view-inspector').hidden = !held;
    for (let voice = 0; voice < 3; voice++) {
      button(`mute-${voice}`).setAttribute('aria-pressed', String(Boolean(state?.muted[voice])));
      button(`solo-${voice}`).setAttribute('aria-pressed', String(state?.muted.every((muted, index) => muted === (index !== voice)) ?? false));
    }
    button('loop-button').setAttribute('aria-pressed', String(Boolean(state?.loop)));
    setText('loop-button', state?.loop ? 'Loop on' : 'Loop A–B');
    setText('loop-summary', state?.loop ? `Looping ${time(state.loop.start, true)}–${time(state.loop.end, true)} · restart may briefly pause; not gapless.` : 'Set A before B. Loop restarts may briefly pause; playback is not gapless.');
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
      if (elapsed < 0 || timelineView === 'fit' && elapsed > 0) seekViewport = null;
      else {
        if (state?.status === 'playing' && elapsed > 0) {
          // The normal-motion guards in tests/browser/unified-panel.spec.ts prohibit scrolling faster than heard playback after a seek.
          if (seekViewport.heard! > seekViewport.center) seekViewport.center += elapsed;
          else if (position >= seekViewport.center) seekViewport = null;
        }
        if (seekViewport) seekViewport.heard = position;
      }
    }
    const observationSpan = timelineSpan + (seekViewport && timelineView === 'scroll' ? 2 * Math.abs(seekViewport.center - transportPosition) : 0);
    if (state?.timelineWindowSeconds !== observationSpan) controls.setTimelineWindow(observationSpan);
    const browsing = timelineView === 'scroll' && state?.timelineCenterSeconds != null;
    if (browsing) {
      const total = timelineTotal();
      const center = timelineSpan >= total ? total / 2 : Math.max(timelineSpan / 2, Math.min(total - timelineSpan / 2, state!.timelineCenterSeconds!));
      if (center !== state!.timelineCenterSeconds) controls.setTimelineCenter(center);
    }
    chartHeld = browsing ? null : held;
    const observations = chartHeld ? timelineView === 'fit' ? chartHeld.history : chartHeld : liveObservations();
    const {frames, writes, start: historyStart, end: observedUntil} = observations;
    const heardUntil = chartHeld?.heardUntil ?? position;
    const chartEnd = timelineView === 'fit' ? Math.min(observedUntil, heardUntil) : observedUntil;
    const window = seekViewport ? followingWindow(seekViewport.center, timelineView === 'fit' ? seekViewport.span : timelineSpan) : timelineView === 'fit'
      ? fittedWindow(historyStart, chartEnd, held ? {start: cursor, end: selectedEnd ?? cursor} : undefined)
      : chartHeld ? {start: chartHeld.plotStart, end: chartHeld.plotEnd} : followingWindow(state?.timelineCenterSeconds ?? position, timelineSpan);
    plotStart = window.start;
    plotEnd = window.end;
    const geometry = timelineScrollbarGeometry(timelineTotal(), plotEnd - plotStart, plotStart);
    const scrollDisabled = !loaded || changing || timelineView === 'fit' || geometry.disabled;
    scrollTrack.setAttribute('aria-disabled', String(scrollDisabled));
    scrollTrack.setAttribute('aria-valuemax', String(geometry.maximumStart));
    scrollTrack.setAttribute('aria-valuenow', String(Math.max(0, Math.min(geometry.maximumStart, plotStart))));
    scrollTrack.setAttribute('aria-valuetext', `${time(Math.max(0, plotStart), true)}–${time(Math.min(timelineTotal(), plotEnd), true)} visible; ${state?.duration == null ? 'duration unknown; explored range' : 'song duration'} ${time(timelineTotal())}`);
    scrollTrack.dataset.total = String(timelineTotal());
    scrollTrack.dataset.span = String(plotEnd - plotStart);
    scrollTrack.title = timelineView === 'fit' ? 'Choose Scroll to browse the timeline' : 'Drag to browse without seeking. Arrows move; Page Up/Down page; Home/End reach the edges.';
    el('timeline-scroll-thumb').style.width = `${geometry.thumbFraction * 100}%`;
    el('timeline-scroll-thumb').style.left = `${geometry.leftFraction * 100}%`;
    button('timeline-scroll-back').disabled = scrollDisabled || plotStart <= 0;
    button('timeline-scroll-forward').disabled = scrollDisabled || plotEnd >= timelineTotal();
    button('timeline-scroll').setAttribute('aria-pressed', String(timelineView === 'scroll'));
    button('timeline-fit').setAttribute('aria-pressed', String(timelineView === 'fit'));
    el('timeline-direction').hidden = timelineView !== 'scroll';
    setText('timeline-earlier', browsing ? 'Earlier' : 'Past');
    setText('timeline-later', browsing ? 'Later · prepared' : 'Upcoming · prepared');
    const durationPrecision = timelineSpan < 1 ? 2 : 1;
    setText('timeline-view-note', seekViewport ? '' : timelineView === 'scroll' ? browsing ? 'Browsing · playback position unchanged' : `${Number((timelineSpan / 2).toFixed(durationPrecision))} s past · ${Number((timelineSpan / 2).toFixed(durationPrecision))} s upcoming` : 'All retained heard history');
    el('timeline-zoom').hidden = timelineView !== 'scroll';
    button('timeline-zoom-out').disabled = timelineZoom === 0;
    button('timeline-zoom-in').disabled = timelineZoom === TIMELINE_DENSITIES.length - 1;
    setText('timeline-scale', `${timelineSpan.toFixed(durationPrecision)} s`);
    const plotFrames = visibleTimelineFrames(frames, Math.max(plotStart, historyStart), Math.min(plotEnd, chartEnd));
    const dropped = chartHeld?.dropped ?? Math.max(observations.dropped, state?.dropped ?? 0);
    el('history-summary').title = `${chartHeld ? 'HELD COPY' : timelineView === 'scroll' ? 'PREPARED OBSERVATIONS' : 'HEARD HISTORY'} ${time(historyStart, true)}–${time(observedUntil, true)} · ${frames.length} sampled frames · ${dropped} dropped writes · epoch ${chartHeld?.epoch ?? state?.epoch ?? 0}`;
    setText('history-description', held ? `Inspecting ${inspectionSubject()} at ${time(cursor, true)}${browsing ? '; browsing another passage' : ' · chart held'}${state?.status === 'playing' ? '; music continues' : ''}.` : '');
    el('history-summary').hidden = !held && dropped === 0;
    const upcoming = chartEnd > heardUntil;
    const loopBoundary = !chartHeld && !browsing && state?.loop && state.loop.end <= plotEnd ? ` Loop returns to ${time(state.loop.start, true)} at ${time(state.loop.end, true)}; wrapped preview is not shown.` : '';
    setText('timeline-availability', chartHeld ? `Captured observations ${time(historyStart, true)}–${time(observedUntil, true)}. Heard through ${time(heardUntil, true)} when held.` : timelineView === 'scroll' ? `${browsing ? `Browsing ${time(plotStart, true)}–${time(plotEnd, true)}. ` : ''}${upcoming ? `Upcoming prepared to ${time(chartEnd, true)}.` : 'Upcoming observations unavailable.'}${loopBoundary}` : 'Only heard observations are shown.');
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
    setText('timeline-cursor', held ? `Held ${time(cursor, true)}` : `Heard ${time(position, true)}`);
    const inspectedTime = held ? cursor : position;
    let inspection = held ?? observations;
    let registers = observationRegistersAt(inspection, inspectedTime, inspection.endInclusive);
    if (!registers) {
      const history = held?.history ?? heardObservations();
      const heardRegisters = observationRegistersAt(history, inspectedTime, history.endInclusive);
      if (heardRegisters) { inspection = history; registers = heardRegisters; }
    }
    for (let voice = 0; voice < 3; voice++) { setText(`lane-wave-${voice}`, registers ? waveforms(registers[voice * 7 + 4] ?? 0) : 'No observation'); drawLane(`voice-lane-${voice}`, plotFrames, writes, voice, chartEnd, historyStart); }
    drawLane('filter-lane', plotFrames, writes, null, chartEnd, historyStart);
    renderInspector(inspection, registers);
    setText('peak-label', db(state?.peakDb ?? -Infinity));
    setText('rms-label', db(state?.rmsDb ?? -Infinity));
    el('peak-meter').style.width = `${Math.min(100, Math.max(0, ((state?.peakDb ?? -60) + 60) / 60 * 100))}%`;
    setText('spectrum-range', state?.info ? `0 → ${(state.info.sampleRate / 2000).toFixed(1)} kHz · frequency bins` : '0 → Nyquist');
    setText('audio-diagnostics', state?.info ? `${state.info.sampleRate.toLocaleString()} Hz PCM · ${state.underruns} buffer underruns · mono` : 'Device-local playback · no backend');
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
    if (next.epoch !== previousEpoch) { previousEpoch = next.epoch; exploredUntil = Math.min(MAX_SEEK_SECONDS, Math.max(30, next.position + 10)); }
    if (!animationFrame) animationFrame = requestAnimationFrame(timestamp => { animationFrame = 0; if (timestamp - lastDraw >= 70 || next.status !== 'playing') { lastDraw = timestamp; draw(); } });
  });
  window.addEventListener('resize', () => draw());
  draw();
}
