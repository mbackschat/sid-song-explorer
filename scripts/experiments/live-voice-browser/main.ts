import type {Profile, RenderResult} from './session.ts';
import type {WorkerReply} from './worker.ts';
import './style.css';

type Status = 'Empty' | 'Loading' | 'Ready' | 'Playing' | 'Paused' | 'Ended' | 'Error';
interface Sample {id: string; title: string; duration: number; url: string}
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sample = element<HTMLSelectElement>('sample');
const model = element<HTMLSelectElement>('model');
const clock = element<HTMLSelectElement>('clock');
const loadButton = element<HTMLButtonElement>('load');
const playButton = element<HTMLButtonElement>('play');
const fullMix = element<HTMLButtonElement>('full-mix');
const volume = element<HTMLInputElement>('volume');
const voicePanel = element<HTMLDivElement>('voices');
const worker = new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});
const pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();
let requestId = 0;
let status: Status = 'Empty';
let samples: Sample[] = [];
let catalogReady = false;
let chips = 2;
let muted = 0;
let solo: number | null = null;
let context: AudioContext | null = null;
let gain: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let epoch = 0;
let pumping = false;
let transporting = false;
let nextFrame = 0;
let nextStart = 0;
let origin = 0;
let duration = 60;
let endingAt: number | null = null;
let lastAction: {mask: number; at: number; applied: boolean} | null = null;
const sources = new Set<AudioBufferSourceNode>();
const waveform = new Float32Array(512);
const canvas = element<HTMLCanvasElement>('waveform');
const pen = canvas.getContext('2d')!;
const effectiveMask = () => solo === null ? ((1 << chips * 3) - 1) & ~muted : 1 << solo;

worker.onmessage = (event: MessageEvent<WorkerReply>) => {
  const request = pending.get(event.data.id);
  if (!request) return;
  pending.delete(event.data.id);
  clearTimeout(request.timer);
  if ('error' in event.data) request.reject(new Error(event.data.error));
  else request.resolve(event.data.result);
};
worker.onerror = event => fail(new Error(event.message || 'Audio worker failed.'));

function request<T>(method: string, payload: unknown): Promise<T> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error(`${method} exceeded ten seconds. Reload the page to retry.`)), 10_000);
    pending.set(id, {resolve: value => resolve(value as T), reject, timer});
    worker.postMessage({id, method, payload});
  });
}

function updateControls() {
  element('status').textContent = status;
  playButton.textContent = status === 'Playing' ? 'Pause' : 'Play';
  playButton.disabled = transporting || !['Ready', 'Playing', 'Paused'].includes(status);
  loadButton.disabled = transporting || !catalogReady || status === 'Playing' || status === 'Loading' || status === 'Error';
  for (const field of [sample, model, clock]) field.disabled = transporting || !catalogReady || status === 'Playing' || status === 'Loading';
  fullMix.disabled = !['Ready', 'Playing', 'Paused'].includes(status);
  for (const button of voicePanel.querySelectorAll<HTMLButtonElement>('button')) {
    const voice = Number(button.dataset.voice) - 1;
    button.disabled = fullMix.disabled;
    button.setAttribute('aria-pressed', String(button.dataset.action === 'mute' ? Boolean(muted & 1 << voice) : solo === voice));
  }
  for (const row of voicePanel.querySelectorAll<HTMLElement>('.voice')) {
    row.classList.toggle('inactive', !(effectiveMask() & 1 << Number(row.dataset.index)));
  }
  fullMix.setAttribute('aria-pressed', String(!muted && solo === null));
}

function changeMix() {
  if (context && status === 'Playing') lastAction = {mask: effectiveMask(), at: context.currentTime, applied: false};
  updateControls();
}

voicePanel.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
  if (!button || button.disabled) return;
  const voice = Number(button.dataset.voice) - 1;
  if (button.dataset.action === 'mute') muted ^= 1 << voice;
  else solo = solo === voice ? null : voice;
  changeMix();
});
fullMix.onclick = () => { muted = 0; solo = null; changeMix(); };
volume.oninput = () => { if (gain) gain.gain.value = Number(volume.value); };

function fail(error: unknown) {
  if (status === 'Error') return;
  epoch++;
  status = 'Error';
  transporting = false;
  worker.terminate();
  for (const source of sources) { source.stop(); source.disconnect(); }
  sources.clear();
  void context?.close();
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error instanceof Error ? error : new Error(String(error)));
  }
  pending.clear();
  element('error').textContent = error instanceof Error ? error.message : String(error);
  updateControls();
}

async function load() {
  const generation = ++epoch;
  status = 'Loading';
  updateControls();
  try {
    for (const source of sources) { source.stop(); source.disconnect(); }
    sources.clear();
    await context?.close();
    context = null;
    gain = null;
    analyser = null;
    const entry = samples.find(entry => entry.id === sample.value);
    const url = entry?.url ?? `/samples/${sample.value}-${model.value}-${clock.value}.sid`;
    const response = await fetch(url, {signal: AbortSignal.timeout(10_000)});
    if (!response.ok) throw new Error(`Could not load sample (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const info = await request<{chips: 1 | 2}>('load', {bytes, model: model.value as Profile['model'], clock: clock.value as Profile['clock']} satisfies Profile & {bytes: Uint8Array});
    if (generation !== epoch) return;
    chips = info.chips;
    muted = 0;
    solo = null;
    nextFrame = 0;
    nextStart = 0;
    origin = 0;
    endingAt = null;
    lastAction = null;
    duration = entry?.duration ?? 60;
    voicePanel.replaceChildren();
    voicePanel.dataset.chips = String(chips);
    for (let voice = 0; voice < chips * 3; voice++) {
      const row = document.createElement('div');
      row.className = 'voice';
      row.dataset.index = String(voice);
      const label = document.createElement('span');
      label.textContent = `Voice ${voice % 3 + 1}`;
      const channel = document.createElement('small');
      channel.textContent = chips === 1 ? 'Mono' : voice < 3 ? 'SID A · Left' : 'SID B · Right';
      row.append(label, channel);
      for (const action of ['mute', 'solo'] as const) {
        const button = document.createElement('button');
        button.textContent = action === 'mute' ? 'M' : 'S';
        button.dataset.voice = String(voice + 1);
        button.dataset.action = action;
        button.setAttribute('aria-label', `${action === 'mute' ? 'Mute' : 'Solo'} voice ${voice + 1}`);
        button.title = `${action === 'mute' ? 'Mute' : 'Solo'} voice ${voice + 1}`;
        row.append(button);
      }
      voicePanel.append(row);
    }
    status = 'Ready';
    element('diagnostics').textContent = 'Ready to play';
    updateControls();
  } catch (error) { fail(error); }
}

async function pump() {
  if (pumping || status !== 'Playing' || !context || !gain || endingAt !== null) return;
  pumping = true;
  const generation = epoch;
  const audio = context;
  try {
    let empty = 0;
    while (status === 'Playing' && generation === epoch && nextStart < audio.currentTime + 0.25 && endingAt === null) {
      const mask = effectiveMask();
      const block = await request<RenderResult>('render', {mask});
      if (generation !== epoch) return;
      if (block.startFrame !== nextFrame || block.mask !== mask || block.chips !== chips || block.pcm.length !== (block.endFrame - block.startFrame) * chips) {
        throw new Error('The worker returned a discontinuous audio block.');
      }
      if (block.endFrame === block.startFrame) {
        if (++empty > 8) throw new Error('The engine returned no audio.');
        continue;
      }
      const frames = Math.min(block.endFrame, Math.round(duration * 44100)) - block.startFrame;
      const buffer = audio.createBuffer(chips, frames, 44100);
      for (let channel = 0; channel < chips; channel++) {
        const output = buffer.getChannelData(channel);
        for (let frame = 0; frame < frames; frame++) output[frame] = block.pcm[frame * chips + channel]! / 32768;
      }
      if (nextStart < audio.currentTime) throw new Error('Audio scheduling missed its deadline. Playback stopped; reload the page to retry.');
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(gain!);
      source.onended = () => { source.disconnect(); sources.delete(source); };
      sources.add(source);
      source.start(nextStart);
      if (lastAction && !lastAction.applied && lastAction.mask === block.mask) {
        element('diagnostics').textContent = `Switch delay: ${Math.round((nextStart - lastAction.at) * 1000)} ms`;
        lastAction.applied = true;
      }
      nextFrame = block.endFrame;
      nextStart += frames / 44100;
      if (block.endFrame >= Math.round(duration * 44100)) endingAt = nextStart;
    }
  } catch (error) { fail(error); }
  finally { pumping = false; }
}

loadButton.onclick = () => void load();
playButton.onclick = async () => {
  if (transporting) return;
  transporting = true;
  updateControls();
  const generation = epoch;
  try {
    if (status === 'Playing') {
      const audio = context!;
      status = 'Paused';
      await audio.suspend();
      if (generation !== epoch || audio !== context) return;
    } else if (status === 'Ready' || status === 'Paused') {
      const starting = !context;
      if (starting) {
        context = new AudioContext({sampleRate: 44100, latencyHint: 'interactive'});
        gain = context.createGain();
        gain.gain.value = Number(volume.value);
        analyser = context.createAnalyser();
        analyser.fftSize = waveform.length;
        gain.connect(analyser);
        analyser.connect(context.destination);
      }
      const audio = context!;
      await audio.resume();
      if (generation !== epoch || audio !== context) return;
      if (starting) origin = nextStart = audio.currentTime + 0.12;
      status = 'Playing';
      if (starting) element('diagnostics').textContent = 'M = mute · S = solo';
      void pump();
    }
  } catch (error) { if (generation === epoch) fail(error); }
  finally {
    if (generation === epoch) { transporting = false; updateControls(); }
  }
};

setInterval(() => void pump(), 40);
function paint() {
  const position = context ? Math.min(duration, Math.max(0, context.currentTime - origin)) : 0;
  element('position').textContent = `${Math.floor(position / 60)}:${(position % 60).toFixed(2).padStart(5, '0')}`;
  if (status === 'Playing' && endingAt !== null && context!.currentTime >= endingAt) {
    status = 'Ended';
    updateControls();
  }
  analyser?.getFloatTimeDomainData(waveform);
  pen.clearRect(0, 0, canvas.width, canvas.height);
  pen.strokeStyle = '#72ded6';
  pen.lineWidth = 2;
  pen.beginPath();
  waveform.forEach((value, index) => {
    const x = index / (waveform.length - 1) * canvas.width;
    const y = (0.5 - value * 0.45) * canvas.height;
    if (index) pen.lineTo(x, y); else pen.moveTo(x, y);
  });
  pen.stroke();
  requestAnimationFrame(paint);
}

updateControls();
paint();
fetch('/samples.json', {signal: AbortSignal.timeout(10_000)}).then(async response => {
  if (!response.ok) throw new Error('Prepared sample list is unavailable.');
  samples = await response.json() as Sample[];
  for (const entry of samples) sample.add(new Option(entry.title, entry.id));
  sample.value = 'rambo-stereo';
  catalogReady = true;
  updateControls();
}).catch(fail);
