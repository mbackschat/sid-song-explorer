import type {AudioChannelAnalysis} from './player-types.ts';

const FFT_SIZE = 1024;

export function createAudioChannels(count: 1 | 2): AudioChannelAnalysis[] {
  return Array.from({length:count}, () => ({
    peakDb:-Infinity, rmsDb:-Infinity,
    waveform:new Float32Array(FFT_SIZE), spectrum:new Uint8Array(FFT_SIZE / 2),
  }));
}

export class AudioMonitor {
  readonly input: GainNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly analysers: AnalyserNode[];

  constructor(context: BaseAudioContext) {
    this.input = context.createGain();
    this.input.gain.value = 1;
    this.splitter = context.createChannelSplitter(2);
    this.analysers = [context.createAnalyser(),context.createAnalyser()];
    this.input.connect(context.destination);
    this.input.connect(this.splitter);
    this.analysers.forEach((analyser,channel) => {
      analyser.fftSize = FFT_SIZE;
      this.splitter.connect(analyser,channel);
      // Unconnected analyser outputs are supported; monitoring must not add a second audible path (Web Audio §1.8).
      // https://www.w3.org/TR/webaudio-1.0/#AnalyserNode
    });
  }

  read(channels: AudioChannelAnalysis[]) {
    channels.forEach((channel,index) => {
      const analyser = this.analysers[index]!;
      analyser.getByteFrequencyData(channel.spectrum as Uint8Array<ArrayBuffer>);
      analyser.getFloatTimeDomainData(channel.waveform as Float32Array<ArrayBuffer>);
      let peak = 0, squares = 0;
      for (const value of channel.waveform) { peak = Math.max(peak,Math.abs(value)); squares += value * value; }
      channel.peakDb = 20 * Math.log10(peak);
      channel.rmsDb = 20 * Math.log10(Math.sqrt(squares / channel.waveform.length));
    });
  }

  dispose() {
    this.input.disconnect();
    this.splitter.disconnect();
    for (const analyser of this.analysers) analyser.disconnect();
  }
}
