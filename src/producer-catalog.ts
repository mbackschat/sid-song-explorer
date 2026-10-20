import { MAX_ASSET_BYTES, parseCatalog } from './catalog.ts';
import type { Annotation, Catalog, CatalogEntry, CatalogMaterial } from './catalog.ts';

export type ProducerAsset = {
  path: string;
  sha256: string;
  bytes: number;
  filename: string;
  transport: 'raw' | 'media';
  delivery: 'prepared' | 'link-only';
};

type ProducerAnnotation = Omit<Annotation, 'sourceUrl'> & { sourcePath: string };
type ProducerEntry = Omit<CatalogEntry, 'files' | 'referenceUrl' | 'stereo' | 'target' | 'rights' | 'listening' | 'analysis'> & {
  publication: 'cleared';
  files: { sid: ProducerAsset; license: ProducerAsset; reference?: ProducerAsset; notices?: ProducerAsset };
  externalReference?: ProducerAsset;
  stereo?: { sid: ProducerAsset; reference: ProducerAsset };
  target: CatalogEntry['target'] & { routing: 'mono' | 'sid-a-left-sid-b-right' };
  rights: Omit<CatalogEntry['rights'], 'sourceUrl' | 'licenseUrl' | 'correspondingSourceUrl'> & { sourcePath: string; licensePath: string };
  listening: Omit<CatalogEntry['listening'], 'sourceUrl'> & { sourcePath: string };
  analysis: Omit<CatalogEntry['analysis'], 'annotations'> & { annotations: ProducerAnnotation[] };
};

export type ProducerCatalog = {
  schemaVersion: 1;
  source: Catalog['source'];
  entries: ProducerEntry[];
  materials: (Omit<CatalogMaterial, 'sourceUrl'> & { sourcePath: string; publication: 'materials-only' })[];
};

export type ProducerPin = {
  schemaVersion: 1;
  repository: string;
  revision: string;
  path: string;
  bytes: number;
  sha256: string;
};

export const MAX_INDEX_BYTES = 2 * 1024 * 1024;

export function parseProducerJson(text: string): unknown {
  requireValue(text.length <= MAX_INDEX_BYTES, 'JSON size limit exceeded');
  const result: unknown = JSON.parse(text);
  const containers: ({ keys: Set<string>; expectingKey: boolean } | null)[] = [];
  // JSON.parse discards earlier duplicate keys; the producer's strict JSON contract rejects them before validation.
  for (let position = 0; position < text.length; position++) {
    const character = text[position];
    if (character === '{') containers.push({ keys: new Set(), expectingKey: true });
    else if (character === '[') containers.push(null);
    else if (character === '}' || character === ']') containers.pop();
    else if (character === ',') {
      const container = containers.at(-1);
      if (container) container.expectingKey = true;
    } else if (character === '"') {
      const start = position++;
      while (text[position] !== '"') position += text[position] === '\\' ? 2 : 1;
      const container = containers.at(-1);
      if (container?.expectingKey) {
        const key = JSON.parse(text.slice(start, position + 1)) as string;
        requireValue(!container.keys.has(key), `duplicate JSON key: ${key}`);
        container.keys.add(key);
        container.expectingKey = false;
      }
    }
  }
  return result;
}

function requireValue(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid producer catalog: ${field}`);
}

function record(value: unknown, keys: string[], field: string, optional: string[] = []): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), field);
  const result = value as Record<string, unknown>;
  requireValue(keys.every((key) => Object.hasOwn(result, key)) && Object.keys(result).every((key) => keys.includes(key) || optional.includes(key)), `${field} fields`);
  return result;
}

function sourceIdentity(repository: unknown, revision: unknown): void {
  requireValue(typeof repository === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'source repository');
  requireValue(typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision), 'source revision');
}

function sourcePath(value: unknown, field: string, fragment = false): asserts value is string {
  requireValue(typeof value === 'string', field);
  const parts = value.split('#');
  requireValue(parts.length === 1 || (fragment && parts.length === 2 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(parts[1]!)), `${field} fragment`);
  requireValue(/^[A-Za-z0-9_.\/-]+$/.test(parts[0]!) && parts[0]!.split('/').every((part) => part && part !== '.' && part !== '..'), `${field} relative path`);
}

function fingerprint(value: Record<string, unknown>, field: string, maximum: number): void {
  requireValue(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256), `${field} SHA-256`);
  requireValue(typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= maximum, `${field} bytes`);
}

export function parseProducerPin(value: unknown): ProducerPin {
  try {
    const pin = record(value, ['schemaVersion', 'repository', 'revision', 'path', 'bytes', 'sha256'], 'pin');
    requireValue(pin.schemaVersion === 1, 'pin schemaVersion must be 1');
    sourceIdentity(pin.repository, pin.revision);
    sourcePath(pin.path, 'pin.path');
    fingerprint(pin, 'pin', MAX_INDEX_BYTES);
    return pin as ProducerPin;
  } catch (error) {
    throw new Error(`Invalid producer pin: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function producerIndexUrl(value: unknown): string {
  const pin = parseProducerPin(value);
  return `https://raw.githubusercontent.com/${pin.repository.slice('https://github.com/'.length)}/${pin.revision}/${pin.path}`;
}

function assetUrl(source: Catalog['source'], asset: ProducerAsset): string {
  const host = asset.transport === 'raw' ? 'https://raw.githubusercontent.com/' : 'https://media.githubusercontent.com/media/';
  return `${host}${source.repository.slice('https://github.com/'.length)}/${source.revision}/${asset.path}`;
}

function runtimeCatalog(index: ProducerCatalog): Catalog {
  const ownerUrl = (relative: string) => `${index.source.repository}/blob/${index.source.revision}/${relative}`;
  const runtimeAsset = (asset: ProducerAsset) => ({ url: assetUrl(index.source, asset), sha256: asset.sha256, bytes: asset.bytes, filename: asset.filename });
  return {
    schemaVersion: 1,
    source: { ...index.source },
    entries: index.entries.map((entry) => {
      const { publication: _, externalReference, stereo, target, rights, listening, analysis, ...rest } = entry;
      const { routing: __, ...runtimeTarget } = target;
      return {
        ...rest,
        files: Object.fromEntries(Object.entries(entry.files).map(([kind, asset]) => [kind, runtimeAsset(asset)])),
        ...(externalReference ? { referenceUrl: assetUrl(index.source, externalReference) } : {}),
        ...(stereo ? { stereo: { sidUrl: assetUrl(index.source, stereo.sid), referenceUrl: assetUrl(index.source, stereo.reference) } } : {}),
        target: runtimeTarget,
        rights: { license: rights.license, attribution: rights.attribution, sourceUrl: ownerUrl(rights.sourcePath), licenseUrl: ownerUrl(rights.licensePath), correspondingSourceUrl: `${index.source.repository}/archive/${index.source.revision}.tar.gz` },
        listening: { status: listening.status, scope: listening.scope, sourceUrl: ownerUrl(listening.sourcePath) },
        analysis: { ...analysis, annotations: analysis.annotations.map(({ sourcePath: relative, ...annotation }) => ({ ...annotation, sourceUrl: ownerUrl(relative) })) },
      };
    }),
    materials: index.materials.map(({ publication: _, sourcePath: relative, ...material }) => ({ ...material, sourceUrl: ownerUrl(relative) })),
  } as Catalog;
}

export function parseProducerCatalog(value: unknown): ProducerCatalog {
  const index = record(value, ['schemaVersion', 'source', 'entries', 'materials'], 'root');
  requireValue(index.schemaVersion === 1, 'schemaVersion must be 1');
  const source = record(index.source, ['repository', 'revision'], 'source');
  sourceIdentity(source.repository, source.revision);
  requireValue(Array.isArray(index.entries) && index.entries.length > 0 && index.entries.length <= 1000, 'entries must contain 1 to 1000 records');
  requireValue(Array.isArray(index.materials) && index.materials.length <= 1000, 'materials must contain at most 1000 records');
  const paths = new Map<string, string>();
  const filenames = new Map<string, string>();
  function asset(value: unknown, field: string, delivery: ProducerAsset['delivery']): void {
    const file = record(value, ['path', 'sha256', 'bytes', 'filename', 'transport', 'delivery'], field);
    sourcePath(file.path, `${field}.path`);
    fingerprint(file, field, delivery === 'prepared' ? MAX_ASSET_BYTES : Number.MAX_SAFE_INTEGER);
    requireValue(typeof file.filename === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(file.filename), `${field}.filename`);
    requireValue(file.transport === 'raw' || file.transport === 'media', `${field}.transport`);
    requireValue(file.delivery === delivery, `${field}.delivery must be ${delivery}`);
    const identity = JSON.stringify([file.sha256, file.bytes, file.transport]);
    requireValue(!paths.has(file.path) || paths.get(file.path) === identity, 'shared asset path must have identical hash, byte length and transport');
    paths.set(file.path, identity);
    const aliasIdentity = JSON.stringify([file.path, file.sha256, file.bytes, file.transport]);
    requireValue(!filenames.has(file.filename) || filenames.get(file.filename) === aliasIdentity, 'shared asset filename must identify the same source path, hash, byte length and transport');
    filenames.set(file.filename, aliasIdentity);
  }
  for (const rawEntry of index.entries) {
    const entry = record(rawEntry, ['id', 'title', 'description', 'durationSeconds', 'publication', 'files', 'target', 'rights', 'listening', 'analysis'], 'entry', ['externalReference', 'stereo']);
    requireValue(entry.publication === 'cleared', 'entry publication must be cleared');
    const files = record(entry.files, ['sid', 'license'], 'files', ['reference', 'notices']);
    requireValue(Object.hasOwn(files, 'reference') !== Object.hasOwn(entry, 'externalReference'), 'exactly one prepared or external reference');
    for (const [kind, file] of Object.entries(files)) asset(file, `files.${kind}`, 'prepared');
    if (Object.hasOwn(entry, 'externalReference')) asset(entry.externalReference, 'externalReference', 'link-only');
    if (Object.hasOwn(entry, 'stereo')) {
      const stereo = record(entry.stereo, ['sid', 'reference'], 'stereo');
      asset(stereo.sid, 'stereo.sid', 'link-only');
      asset(stereo.reference, 'stereo.reference', 'link-only');
    }
    const target = record(entry.target, ['clock', 'model', 'sidCount', 'baseAddress', 'subtune', 'routing'], 'target', ['secondSidAddress']);
    requireValue(target.sidCount === 1 ? target.routing === 'mono' : target.sidCount === 2 && target.routing === 'sid-a-left-sid-b-right', 'unsupported routing for SID count');
    const rights = record(entry.rights, ['license', 'attribution', 'sourcePath', 'licensePath'], 'rights');
    sourcePath(rights.sourcePath, 'rights.sourcePath', true);
    sourcePath(rights.licensePath, 'rights.licensePath', true);
    requireValue(rights.licensePath === (files.license as Record<string, unknown>).path, 'rights.licensePath must match the prepared license path');
    const listening = record(entry.listening, ['status', 'scope', 'sourcePath'], 'listening');
    sourcePath(listening.sourcePath, 'listening.sourcePath', true);
    const analysis = record(entry.analysis, ['schemaVersion', 'sidSha256', 'subtune', 'clock', 'timeBasis', 'annotations'], 'analysis');
    requireValue(Array.isArray(analysis.annotations), 'analysis.annotations');
    for (const rawAnnotation of analysis.annotations) {
      const annotation = record(rawAnnotation, ['id', 'startSeconds', 'endSeconds', 'title', 'description', 'evidenceLevel', 'voices', 'sourcePath'], 'annotation');
      sourcePath(annotation.sourcePath, 'annotation.sourcePath', true);
    }
  }
  for (const rawMaterial of index.materials) {
    const material = record(rawMaterial, ['id', 'title', 'description', 'sourcePath', 'publication'], 'material');
    requireValue(material.publication === 'materials-only', 'material publication must be materials-only');
    sourcePath(material.sourcePath, 'material.sourcePath', true);
  }
  const result = index as ProducerCatalog;
  parseCatalog(runtimeCatalog(result));
  return result;
}

export function adaptProducerCatalog(value: unknown): Catalog {
  return runtimeCatalog(parseProducerCatalog(value));
}
