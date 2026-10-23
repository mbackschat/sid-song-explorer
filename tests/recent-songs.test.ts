import test from 'node:test';
import assert from 'node:assert/strict';
import {RECENT_SONGS_STORAGE_KEY, RecentSongs, type RecentSong} from '../src/recent-songs.ts';

function song(index = 1): RecentSong {
  return {path: `MUSICIANS/E/Example/Tune_${index}.sid`, title: `Tune ${index}`, author: 'Composer'};
}

function storage(initial: unknown = []) {
  const values = new Map<string, string>([[RECENT_SONGS_STORAGE_KEY, JSON.stringify(initial)]]);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('newest successful songs appear first and only ten distinct paths remain', () => {
  const recent = new RecentSongs(null);
  for (let index = 1; index <= 12; index++) recent.remember(song(index));
  assert.deepEqual(recent.entries(), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map(song));
});

test('replaying a prefixed path moves its canonical identity first and refreshes metadata', () => {
  const recent = new RecentSongs(null);
  recent.remember(song(1));
  recent.remember(song(2));
  recent.remember({...song(1), path: `C64Music/${song(1).path}`, title: 'Updated title'});
  assert.deepEqual(recent.entries(), [{...song(1), title: 'Updated title'}, song(2)]);
});

test('storage survives a new instance and includes only canonical song metadata', () => {
  const saved = storage();
  const recent = new RecentSongs(saved);
  recent.remember({...song(), path: `C64Music/${song().path}`, bytes: new Uint8Array([1, 2, 3]), released: '2026'} as RecentSong);
  assert.deepEqual(JSON.parse(saved.getItem(RECENT_SONGS_STORAGE_KEY)!), [song()]);
  assert.deepEqual(new RecentSongs(saved).entries(), [song()]);
  assert.match(RECENT_SONGS_STORAGE_KEY, /v\d+$/);
});

test('restoration discards invalid records and duplicate paths before applying the ten-song limit', () => {
  const saved = storage([
    null, false, {}, {...song(), author: 1}, {...song(), title: ''}, {...song(), path: '../Private.sid'},
    {...song(12), path: `C64Music/${song(12).path}`}, {...song(12), title: 'Older duplicate'},
    ...[11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(song),
  ]);
  assert.deepEqual(new RecentSongs(saved).entries(), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map(song));
});

for (const initial of ['broken JSON', '{}', 'null', '"a song"']) {
  test(`corrupt saved history ${initial} becomes an empty usable list`, () => {
    const saved = storage();
    saved.setItem(RECENT_SONGS_STORAGE_KEY, initial);
    const recent = new RecentSongs(saved);
    assert.deepEqual(recent.entries(), []);
    recent.remember(song());
    assert.deepEqual(recent.entries(), [song()]);
  });
}

test('blocked storage preserves the in-memory history and clearing remains usable', () => {
  const blocked = () => { throw new DOMException('Storage is blocked', 'SecurityError'); };
  const recent = new RecentSongs({getItem: blocked, setItem: blocked, removeItem: blocked});
  recent.remember(song());
  recent.remember(song(2));
  assert.deepEqual(recent.entries(), [song(2), song()]);
  recent.clear();
  assert.deepEqual(recent.entries(), []);
  recent.remember(song(3));
  assert.deepEqual(recent.entries(), [song(3)]);
});

test('clearing removes the persisted list and a new instance starts empty', () => {
  const saved = storage([song()]);
  const recent = new RecentSongs(saved);
  recent.clear();
  assert.equal(saved.getItem(RECENT_SONGS_STORAGE_KEY), null);
  assert.deepEqual(recent.entries(), []);
  assert.deepEqual(new RecentSongs(saved).entries(), []);
});

test('invalid paths cannot enter history and unknown authors remain valid', () => {
  const recent = new RecentSongs(null);
  for (const path of ['/Private.sid', '../Private.sid', 'https://example.test/Tune.sid', 'MUSICIANS/../Private.sid', 'Tune.mp3']) {
    recent.remember({...song(), path});
  }
  assert.deepEqual(recent.entries(), []);
  recent.remember({...song(), author: ''});
  assert.deepEqual(recent.entries(), [{...song(), author: ''}]);
});

test('callers cannot mutate remembered metadata through inputs or returned entries', () => {
  const recent = new RecentSongs(null);
  const input = song();
  recent.remember(input);
  input.title = 'Changed input';
  const entries = recent.entries() as RecentSong[];
  entries[0].title = 'Changed result';
  entries.length = 0;
  assert.deepEqual(recent.entries(), [song()]);
});
