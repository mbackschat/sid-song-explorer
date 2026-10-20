import type {CatalogEntry} from './catalog.ts';
import type {Profile, TuneDetails} from './player-types.ts';

export type CompositionEvidence = 'verified' | 'derived' | 'interpretation';
type SourceClaim = {sourcePath: string; evidenceLevel: CompositionEvidence};
export type CompositionPart = SourceClaim & {id: string; title: string; role: string};
export type CompositionInstrument = SourceClaim & {
  id: string;
  title: string;
  description: string;
  behavior: string[];
  kind: 'source-program-state';
  program: {data: number[]};
};
export type CompositionEvent = {
  id: string;
  partId: string;
  instrumentId: string;
  sourceCall: number;
  endSourceCall: number;
  startSeconds: number;
  endSeconds: number;
  pitchIndex: number;
  frequencyWord: number;
  nodeId: string;
  sourceAddress: number;
  entrySound: number[];
  evidenceLevel: CompositionEvidence;
};
export type CompositionPassage = SourceClaim & {
  id: string;
  title: string;
  description: string;
  sourceStartCall: number;
  sourceEndCall: number;
  startSeconds: number;
  endSeconds: number;
  recurrence: null | {of: string; partIds: string[]; relationship: 'same-source-phrase'; description: string};
  events: CompositionEvent[];
  dependencies: (SourceClaim & {kind: 'shared-chip-filter' | 'oscillator-coupling'; partIds: string[]; description: string})[];
};
export type CompositionPackage = {
  schemaVersion: 1;
  id: string;
  catalogEntryId: string;
  title: string;
  source: {repository: string; revision: string; scorePath: string; evidencePath: string; rightsPath: string};
  binding: {sidSha256: string; subtune: 1; clock: 'PAL'; sidModel: 'MOS6581'; sidCount: 1; baseAddress: 54272; routing: 'mono'};
  timing: {sourceStartCall: number; callCycles: 19656; clockHz: number; timeBasis: 'source-call-grid'; rule: '(sourceCall-sourceStartCall)*callCycles/clockHz'};
  coverage: {scope: 'selected-passages'; wholeSong: false; description: string};
  parts: CompositionPart[];
  instruments: CompositionInstrument[];
  allocations: {partId: string; chip: 1; voice: number}[];
  passages: CompositionPassage[];
  rights: {license: 'GPL-3.0-only'; attribution: string; sourcePath: string};
};

function requireValue(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid composition package: ${field}`);
}

function record(value: unknown, keys: string[], field: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), field);
  const result = value as Record<string, unknown>;
  requireValue(keys.every(key => Object.hasOwn(result, key)) && Object.keys(result).every(key => keys.includes(key)), `${field} fields`);
  return result;
}

function text(value: unknown, field: string): asserts value is string {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= 8000, field);
}

function id(value: unknown, field: string): asserts value is string {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value), field);
}

function sourcePath(value: unknown): asserts value is string {
  text(value, 'source path');
  const [path, fragment, extra] = value.split('#');
  requireValue(extra === undefined && (fragment === undefined || /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(fragment)), 'source fragment');
  requireValue(/^[A-Za-z0-9_.\/-]+$/.test(path!) && path!.split('/').every(part => part && part !== '.' && part !== '..'), 'relative source path');
}

function integer(value: unknown, min: number, max: number, field: string): asserts value is number {
  requireValue(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, field);
}

function list(value: unknown, maximum: number, field: string, minimum = 1): asserts value is unknown[] {
  requireValue(Array.isArray(value) && value.length >= minimum && value.length <= maximum, field);
}

function evidence(value: unknown): void {
  requireValue(value === 'verified' || value === 'derived' || value === 'interpretation', 'evidence category');
}

function claim(value: Record<string, unknown>): void {
  sourcePath(value.sourcePath);
  evidence(value.evidenceLevel);
}

function uniqueId(value: unknown, ids: Set<string>, field: string): asserts value is string {
  id(value, field);
  requireValue(!ids.has(value), `duplicate ${field}`);
  ids.add(value);
}

function references(value: unknown, ids: Set<string>, field: string): void {
  list(value, ids.size, field);
  requireValue(value.every(item => typeof item === 'string' && ids.has(item)) && new Set(value).size === value.length, field);
}

function bytes(value: unknown, length: number): void {
  requireValue(Array.isArray(value) && value.length === length && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255), 'program bytes');
}

export function compositionSourceUrl(pkg: CompositionPackage, path: string): string {
  sourcePath(path);
  return `${pkg.source.repository}/blob/${pkg.source.revision}/${path}`;
}

export function parseCompositionPackage(value: unknown): CompositionPackage {
  const root = record(value, ['schemaVersion', 'id', 'catalogEntryId', 'title', 'source', 'binding', 'timing', 'coverage', 'parts', 'instruments', 'allocations', 'passages', 'rights'], 'root');
  requireValue(root.schemaVersion === 1, 'schemaVersion must be 1');
  id(root.id, 'id'); id(root.catalogEntryId, 'catalog entry'); text(root.title, 'title');
  const source = record(root.source, ['repository', 'revision', 'scorePath', 'evidencePath', 'rightsPath'], 'source');
  requireValue(typeof source.repository === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(source.repository), 'source repository');
  requireValue(typeof source.revision === 'string' && /^[a-f0-9]{40}$/.test(source.revision), 'source revision');
  for (const key of ['scorePath', 'evidencePath', 'rightsPath']) sourcePath(source[key]);
  const binding = record(root.binding, ['sidSha256', 'subtune', 'clock', 'sidModel', 'sidCount', 'baseAddress', 'routing'], 'binding');
  requireValue(typeof binding.sidSha256 === 'string' && /^[a-f0-9]{64}$/.test(binding.sidSha256), 'SID fingerprint');
  requireValue(binding.subtune === 1 && binding.clock === 'PAL' && binding.sidModel === 'MOS6581' && binding.sidCount === 1 && binding.baseAddress === 54272 && binding.routing === 'mono', 'unsupported playback binding');
  const timing = record(root.timing, ['sourceStartCall', 'callCycles', 'clockHz', 'timeBasis', 'rule'], 'timing');
  integer(timing.sourceStartCall, 0, 1_000_000, 'source start call');
  requireValue(timing.callCycles === 19656 && timing.clockHz === 17734475 / 18 && timing.timeBasis === 'source-call-grid' && timing.rule === '(sourceCall-sourceStartCall)*callCycles/clockHz', 'unsupported timing');
  const timeAt = (call: number) => (call - (timing.sourceStartCall as number)) * 19656 / (17734475 / 18);
  const interval = (item: Record<string, unknown>, startKey: string, endKey: string) => {
    const start = item[startKey], end = item[endKey];
    integer(start, timing.sourceStartCall as number, 1_000_000, startKey);
    integer(end, start + 1, 1_000_000, endKey);
    for (const [key, call] of [['startSeconds', start], ['endSeconds', end]] as const) {
      requireValue(typeof item[key] === 'number' && Number.isFinite(item[key]) && Math.abs(item[key] - timeAt(call)) < 1e-8, `${key} source-call alignment`);
    }
  };
  const coverage = record(root.coverage, ['scope', 'wholeSong', 'description'], 'coverage');
  requireValue(coverage.scope === 'selected-passages' && coverage.wholeSong === false, 'coverage');
  text(coverage.description, 'coverage description');
  const rights = record(root.rights, ['license', 'attribution', 'sourcePath'], 'rights');
  requireValue(rights.license === 'GPL-3.0-only', 'unsupported rights');
  text(rights.attribution, 'attribution'); sourcePath(rights.sourcePath);
  list(root.parts, 3, 'parts');
  const partIds = new Set<string>();
  for (const item of root.parts) {
    const part = record(item, ['id', 'title', 'role', 'evidenceLevel', 'sourcePath'], 'part');
    uniqueId(part.id, partIds, 'part id'); text(part.title, 'part title'); text(part.role, 'part role'); claim(part);
  }
  list(root.instruments, 256, 'instruments');
  const instrumentIds = new Set<string>();
  for (const item of root.instruments) {
    const instrument = record(item, ['id', 'title', 'description', 'evidenceLevel', 'behavior', 'kind', 'program', 'sourcePath'], 'instrument');
    uniqueId(instrument.id, instrumentIds, 'instrument id'); text(instrument.title, 'instrument title'); text(instrument.description, 'instrument description'); claim(instrument);
    requireValue(instrument.kind === 'source-program-state', 'instrument kind');
    list(instrument.behavior, 16, 'program behavior');
    instrument.behavior.forEach(item => text(item, 'behavior'));
    bytes(record(instrument.program, ['data'], 'program').data, 49);
  }
  list(root.allocations, 3, 'allocations');
  const allocated = new Set<string>();
  const voices = new Set<number>();
  for (const item of root.allocations) {
    const allocation = record(item, ['partId', 'chip', 'voice'], 'allocation');
    uniqueId(allocation.partId, allocated, 'allocated part');
    requireValue(partIds.has(allocation.partId) && allocation.chip === 1, 'allocation');
    integer(allocation.voice, 1, 3, 'voice');
    requireValue(!voices.has(allocation.voice), 'duplicate allocated voice');
    voices.add(allocation.voice);
  }
  requireValue(allocated.size === partIds.size, 'every part must have an allocation');
  list(root.passages, 64, 'passages');
  const passageIds = new Set<string>();
  const eventIdentities = new Map<string, string>();
  for (const item of root.passages) {
    const passage = record(item, ['id', 'title', 'description', 'sourceStartCall', 'sourceEndCall', 'startSeconds', 'endSeconds', 'recurrence', 'events', 'dependencies', 'sourcePath', 'evidenceLevel'], 'passage');
    id(passage.id, 'passage id');
    if (passage.recurrence !== null) {
      const recurrence = record(passage.recurrence, ['of', 'partIds', 'relationship', 'description'], 'recurrence');
      requireValue(typeof recurrence.of === 'string' && passageIds.has(recurrence.of) && recurrence.of !== passage.id, 'recurrence must reference an earlier passage');
      references(recurrence.partIds, partIds, 'recurring parts');
      requireValue(recurrence.relationship === 'same-source-phrase', 'recurrence relationship');
      text(recurrence.description, 'recurrence description');
    }
    uniqueId(passage.id, passageIds, 'passage id');
    text(passage.title, 'passage title'); text(passage.description, 'passage description'); claim(passage);
    interval(passage, 'sourceStartCall', 'sourceEndCall');
    list(passage.events, 4096, 'events');
    const passageEventIds = new Set<string>();
    for (const item of passage.events) {
      const event = record(item, ['id', 'partId', 'instrumentId', 'sourceCall', 'endSourceCall', 'startSeconds', 'endSeconds', 'pitchIndex', 'frequencyWord', 'nodeId', 'sourceAddress', 'entrySound', 'evidenceLevel'], 'event');
      uniqueId(event.id, passageEventIds, 'event id');
      requireValue(typeof event.partId === 'string' && partIds.has(event.partId), 'event part reference');
      requireValue(typeof event.instrumentId === 'string' && instrumentIds.has(event.instrumentId), 'event instrument reference');
      interval(event, 'sourceCall', 'endSourceCall');
      requireValue((event.startSeconds as number) < (passage.endSeconds as number) && (event.endSeconds as number) > (passage.startSeconds as number), 'event must intersect passage');
      integer(event.pitchIndex, 0, 255, 'pitch index'); integer(event.frequencyWord, 0, 65535, 'frequency word'); integer(event.sourceAddress, 0, 65535, 'source address');
      id(event.nodeId, 'score node'); bytes(event.entrySound, 39); evidence(event.evidenceLevel);
      const signature = JSON.stringify(Object.entries(event).sort(([a], [b]) => a.localeCompare(b)));
      requireValue(!eventIdentities.has(event.id) || eventIdentities.get(event.id) === signature, 'conflicting event identity');
      eventIdentities.set(event.id, signature);
    }
    list(passage.dependencies, 16, 'dependencies', 0);
    for (const item of passage.dependencies) {
      const dependency = record(item, ['kind', 'partIds', 'description', 'sourcePath', 'evidenceLevel'], 'dependency');
      requireValue(dependency.kind === 'shared-chip-filter' || dependency.kind === 'oscillator-coupling', 'dependency kind');
      references(dependency.partIds, partIds, 'dependent parts');
      text(dependency.description, 'dependency description'); claim(dependency);
    }
  }
  return root as CompositionPackage;
}

export function compositionMatchesEntry(pkg: Pick<CompositionPackage, 'binding' | 'catalogEntryId' | 'passages'>, entry: CatalogEntry): boolean {
  const binding = pkg.binding;
  return entry.id === pkg.catalogEntryId && entry.files.sid.sha256 === binding.sidSha256 &&
    entry.target.clock === binding.clock && entry.target.model === binding.sidModel && entry.target.subtune === binding.subtune &&
    entry.target.sidCount === binding.sidCount && entry.target.baseAddress === binding.baseAddress &&
    pkg.passages.every(passage => passage.endSeconds <= entry.durationSeconds);
}

export function matchingCompositionPackage<T extends Pick<CompositionPackage, 'binding' | 'catalogEntryId' | 'passages'>>(pkg: T | null, entry: CatalogEntry | null, profile: Profile | null, info: TuneDetails | null): T | null {
  if (!pkg || !entry || !profile || !info || !compositionMatchesEntry(pkg, entry)) return null;
  const binding = pkg.binding;
  if (profile.clock !== binding.clock || profile.model !== binding.sidModel || profile.subtune !== binding.subtune ||
      info.clock !== binding.clock || info.model !== binding.sidModel || info.subtune !== binding.subtune ||
      info.installedSids !== binding.sidCount || info.channels !== 1 || info.sidChipBases.length !== 1 || info.sidChipBases[0] !== binding.baseAddress) return null;
  return pkg;
}
