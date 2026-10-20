import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AudioMonitor, createAudioChannels} from '../src/audio-monitor.ts';

class NodeFixture {
  connections: {destination: NodeFixture; output: number}[] = [];
  disconnected = false;
  connect(destination: NodeFixture, output = 0) { this.connections.push({destination,output}); }
  disconnect() { this.disconnected = true; }
}
class AnalyserFixture extends NodeFixture {
  fftSize = 0;
  readonly amplitude: number;
  readonly bin: number;
  constructor(amplitude: number, bin: number) { super(); this.amplitude = amplitude; this.bin = bin; }
  getFloatTimeDomainData(target: Float32Array) { target.forEach((_,index) => {target[index] = index % 2 ? -this.amplitude : this.amplitude;}); }
  getByteFrequencyData(target: Uint8Array) { target.fill(0); target[this.bin] = 200; }
}
function contextFixture() {
  const destination = new NodeFixture();
  const input = Object.assign(new NodeFixture(), {gain:{value:1}});
  const splitter = new NodeFixture();
  const analysers = [new AnalyserFixture(.5,8),new AnalyserFixture(.25,32)];
  let next = 0;
  const context = {
    destination,
    createGain: () => input,
    createChannelSplitter: (channels: number) => {assert.equal(channels,2); return splitter;},
    createAnalyser: () => analysers[next++],
  } as unknown as BaseAudioContext;
  return {context,input,splitter,analysers,destination};
}

test('monitor preserves a unity output path and analyses each splitter channel without mixing', () => {
  const fixture = contextFixture();
  const monitor = new AudioMonitor(fixture.context);
  assert.equal(monitor.input,fixture.input);
  assert.equal(fixture.input.gain.value,1);
  assert.deepEqual(fixture.input.connections.map(connection => connection.destination),[fixture.destination,fixture.splitter]);
  assert.deepEqual(fixture.splitter.connections,[{destination:fixture.analysers[0],output:0},{destination:fixture.analysers[1],output:1}]);
  assert.ok(fixture.analysers.every(analyser => analyser.fftSize === 1024 && analyser.connections.length === 0));
  const channels = createAudioChannels(2);
  monitor.read(channels);
  for (const [index,amplitude] of [.5,.25].entries()) {
    const channel = channels[index];
    assert.equal(channel.peakDb,20 * Math.log10(amplitude));
    assert.equal(channel.rmsDb,20 * Math.log10(amplitude));
    assert.equal(Math.max(...channel.waveform),amplitude);
    assert.equal(channel.spectrum[index ? 32 : 8],200);
    assert.equal(channel.spectrum[index ? 8 : 32],0);
  }
  monitor.dispose();
  assert.ok([fixture.input,fixture.splitter,...fixture.analysers].every(node => node.disconnected));
});

test('mono analysis uses its single channel and fresh buffers clear stereo measurements', () => {
  const fixture = contextFixture();
  const monitor = new AudioMonitor(fixture.context);
  const stereo = createAudioChannels(2);
  monitor.read(stereo);
  const mono = createAudioChannels(1);
  assert.equal(mono.length,1);
  assert.equal(mono[0].peakDb,-Infinity);
  assert.equal(mono[0].rmsDb,-Infinity);
  assert.ok(mono[0].waveform.every(value => value === 0));
  assert.ok(mono[0].spectrum.every(value => value === 0));
  assert.notEqual(mono[0].waveform,stereo[0].waveform);
  monitor.read(mono);
  assert.equal(mono[0].peakDb,20 * Math.log10(.5));
  monitor.dispose();
});
