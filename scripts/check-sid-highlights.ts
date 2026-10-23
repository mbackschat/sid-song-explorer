import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SID_HIGHLIGHTS, fetchHighlight} from '../src/sid-highlights.ts';
import {SongLengthLookup, SONG_LENGTHS_URL} from '../src/song-lengths.ts';
import {SidSession} from '../src/engine/session.ts';

const deadline = performance.now() + 55_000;
function remaining(): number {
  const milliseconds = Math.floor(deadline - performance.now());
  assert.ok(milliseconds > 0, 'Highlights validation exceeded its 55-second budget');
  return milliseconds;
}

function download(url: string, maximumBytes: number): Uint8Array<ArrayBuffer> {
  const budget = Math.min(12_000, remaining());
  const bytes = execFileSync('curl', ['--fail', '--silent', '--show-error', '--max-time', String(budget / 1000), url], {
    timeout: budget, maxBuffer: maximumBytes,
  });
  return new Uint8Array(bytes);
}

const database = download(SONG_LENGTHS_URL, 8 * 1024 * 1024);
const lengths = new SongLengthLookup(async () => new Response(database));
for (const entry of SID_HIGHLIGHTS) {
  remaining();
  const bytes = await fetchHighlight(entry, async url => new Response(download(String(url), 65_662)));
  const duration = await lengths.lookup(bytes, entry.subtune, 'PAL');
  assert.ok(duration !== null && duration > 120 && duration <= 600, `${entry.title}: missing or ineligible HVSC duration`);
  assert.ok(Math.abs(duration - entry.durationSeconds) < .001, `${entry.title}: dropdown duration differs from the exact-file HVSC entry`);
  const session = await SidSession.create({moduleUrl: pathToFileURL(resolve('build/engine/libsidplayfp.js')).href});
  try {
    const info = await session.load(bytes, {clock: 'PAL', model: entry.model, subtune: entry.subtune});
    assert.equal(info.installedSids, entry.chips, `${entry.title}: engine chip count`);
    assert.equal(info.channels, entry.chips, `${entry.title}: engine channel count`);
    const peaks = Array<number>(info.channels).fill(0);
    const writtenChips = new Set<number>();
    let differentChannels = false;
    for (let part = 0; part < 6; part++) {
      remaining();
      const block = session.render(info.sampleRate / 2);
      for (let i = 0; i < block.pcm.length; i++) {
        peaks[i % info.channels] = Math.max(peaks[i % info.channels]!, Math.abs(block.pcm[i]!));
        if (info.channels === 2 && i % 2 === 0 && block.pcm[i] !== block.pcm[i + 1]) differentChannels = true;
      }
      for (const write of block.writes) writtenChips.add(write.sidNumber);
    }
    assert.ok(peaks.every(peak => peak > 0), `${entry.title}: silent channel in three-second rendering`);
    assert.equal(writtenChips.size, entry.chips, `${entry.title}: missing chip writes`);
    if (entry.chips === 2) assert.ok(differentChannels, `${entry.title}: duplicated mono output`);
    console.log(JSON.stringify({path: entry.path, subtune: entry.subtune, durationSeconds: duration,
      md5: createHash('md5').update(bytes).digest('hex'), channels: info.channels, peaks}));
  } finally {
    session.dispose();
  }
}
