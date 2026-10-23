import {canonicalHvscPath} from './hvsc-download.ts';

export interface RecentSong {
  path: string;
  title: string;
  author: string;
}

export const RECENT_SONGS_STORAGE_KEY = 'sid-song-explorer.recent-songs.v1';

type RecentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function parseSong(value: unknown): RecentSong | null {
  if (!value || typeof value !== 'object') return null;
  const {path, title, author} = value as Record<string, unknown>;
  if (typeof path !== 'string' || typeof title !== 'string' || !title.trim() || title.length > 1024 || typeof author !== 'string' || author.length > 1024) return null;
  const canonicalPath = canonicalHvscPath(path);
  return canonicalPath ? {path: canonicalPath, title, author} : null;
}

export class RecentSongs {
  private songs: RecentSong[] = [];
  private readonly storage: RecentStorage | null;

  constructor(storage: RecentStorage | null) {
    this.storage = storage;
    try {
      const saved: unknown = JSON.parse(storage?.getItem(RECENT_SONGS_STORAGE_KEY) ?? '[]');
      if (!Array.isArray(saved)) return;
      const paths = new Set<string>();
      for (const value of saved) {
        const song = parseSong(value);
        if (!song || paths.has(song.path)) continue;
        this.songs.push(song);
        paths.add(song.path);
        if (this.songs.length === 10) break;
      }
    } catch {}
  }

  entries(): readonly RecentSong[] {
    return this.songs.map(song => ({...song}));
  }

  remember(value: RecentSong): void {
    const song = parseSong(value);
    if (!song) return;
    this.songs = [song, ...this.songs.filter(entry => entry.path !== song.path)].slice(0, 10);
    try {
      this.storage?.setItem(RECENT_SONGS_STORAGE_KEY, JSON.stringify(this.songs));
    } catch {}
  }

  clear(): void {
    this.songs = [];
    try {
      this.storage?.removeItem(RECENT_SONGS_STORAGE_KEY);
    } catch {}
  }
}
