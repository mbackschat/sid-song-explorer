export type CatalogFile = {
  url: string;
  sha256: string;
  bytes: number;
  filename: string;
};

export type Annotation = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  title: string;
  description: string;
  evidenceLevel: 'verified' | 'derived' | 'interpretation';
  voices: number[];
  sourceUrl: string;
};

export type CatalogEntry = {
  id: string;
  title: string;
  description: string;
  durationSeconds: number;
  files: { sid: CatalogFile; reference: CatalogFile; license: CatalogFile };
  target: { clock: 'PAL'; model: 'MOS6581'; sidCount: 1; baseAddress: 54272; subtune: 1 };
  rights: { license: string; attribution: string; sourceUrl: string; licenseUrl: string; correspondingSourceUrl: string };
  listening: { status: string; scope: string; sourceUrl: string };
  analysis: {
    schemaVersion: 1;
    sidSha256: string;
    subtune: 1;
    clock: 'PAL';
    timeBasis: 'seconds-from-init';
    annotations: Annotation[];
  };
};

export type Catalog = {
  schemaVersion: 1;
  source: { repository: string; revision: string };
  entries: CatalogEntry[];
};

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

function requireValue(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid catalog: ${field}`);
}

function record(value: unknown, keys: string[], field: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), field);
  const result = value as Record<string, unknown>;
  requireValue(Object.keys(result).length === keys.length && keys.every((key) => Object.hasOwn(result, key)), `${field} fields`);
  return result;
}

function text(value: unknown, field: string): asserts value is string {
  requireValue(typeof value === 'string' && value.trim().length > 0, field);
}

function httpsUrl(value: unknown, field: string): asserts value is string {
  text(value, field);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid catalog: ${field} URL`);
  }
  requireValue(url.protocol === 'https:' && !url.username && !url.password, `${field} HTTPS URL`);
}

function digest(value: unknown, field: string): asserts value is string {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), `${field} SHA-256`);
}

function identifier(value: unknown, field: string): asserts value is string {
  requireValue(typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), `${field} identifier`);
}

export function assetSourcePath(source: Catalog['source'], url: string): string {
  const repository = source.repository.slice('https://github.com/'.length);
  // GitHub raw serves these ordinary blobs; LFS objects require the media endpoint.
  const prefixes = [
    `https://raw.githubusercontent.com/${repository}/${source.revision}/`,
    `https://media.githubusercontent.com/media/${repository}/${source.revision}/`,
  ];
  const prefix = prefixes.find((candidate) => url.startsWith(candidate));
  requireValue(prefix, 'asset URL must use the pinned repository revision');
  const sourcePath = url.slice(prefix.length);
  requireValue(/^[A-Za-z0-9_.\/-]+$/.test(sourcePath) && sourcePath.split('/').every((part) => part && part !== '.' && part !== '..'), 'asset source path');
  return sourcePath;
}

export function parseCatalog(value: unknown): Catalog {
  const catalog = record(value, ['schemaVersion', 'source', 'entries'], 'root');
  requireValue(catalog.schemaVersion === 1, 'schemaVersion must be 1');
  const source = record(catalog.source, ['repository', 'revision'], 'source');
  requireValue(typeof source.repository === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(source.repository), 'source repository');
  requireValue(typeof source.revision === 'string' && /^[a-f0-9]{40}$/.test(source.revision), 'source revision');
  requireValue(Array.isArray(catalog.entries) && catalog.entries.length > 0, 'entries');
  const entryIds = new Set<string>();
  const filenames = new Set<string>();

  for (const rawEntry of catalog.entries) {
    const entry = record(rawEntry, ['id', 'title', 'description', 'durationSeconds', 'files', 'target', 'rights', 'listening', 'analysis'], 'entry');
    identifier(entry.id, 'entry.id');
    requireValue(!entryIds.has(entry.id), 'duplicate entry id');
    entryIds.add(entry.id);
    text(entry.title, 'entry.title');
    text(entry.description, 'entry.description');
    requireValue(typeof entry.durationSeconds === 'number' && Number.isFinite(entry.durationSeconds) && entry.durationSeconds > 0, 'durationSeconds');
    const files = record(entry.files, ['sid', 'reference', 'license'], 'files');
    for (const [kind, rawFile] of Object.entries(files)) {
      const file = record(rawFile, ['url', 'sha256', 'bytes', 'filename'], `files.${kind}`);
      httpsUrl(file.url, `files.${kind}.url`);
      assetSourcePath(source as Catalog['source'], file.url);
      digest(file.sha256, `files.${kind}.sha256`);
      requireValue(typeof file.bytes === 'number' && Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= MAX_ASSET_BYTES, `files.${kind}.bytes`);
      requireValue(typeof file.filename === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(file.filename), `files.${kind}.filename`);
      requireValue(!filenames.has(file.filename), 'duplicate output filename');
      filenames.add(file.filename);
    }

    const target = record(entry.target, ['clock', 'model', 'sidCount', 'baseAddress', 'subtune'], 'target');
    requireValue(target.clock === 'PAL' && target.model === 'MOS6581' && target.sidCount === 1 && target.baseAddress === 54272 && target.subtune === 1, 'unsupported POC target');
    const rights = record(entry.rights, ['license', 'attribution', 'sourceUrl', 'licenseUrl', 'correspondingSourceUrl'], 'rights');
    text(rights.license, 'rights.license');
    text(rights.attribution, 'rights.attribution');
    for (const field of ['sourceUrl', 'licenseUrl', 'correspondingSourceUrl']) httpsUrl(rights[field], `rights.${field}`);
    const listening = record(entry.listening, ['status', 'scope', 'sourceUrl'], 'listening');
    text(listening.status, 'listening.status');
    text(listening.scope, 'listening.scope');
    httpsUrl(listening.sourceUrl, 'listening.sourceUrl');

    const analysis = record(entry.analysis, ['schemaVersion', 'sidSha256', 'subtune', 'clock', 'timeBasis', 'annotations'], 'analysis');
    requireValue(analysis.schemaVersion === 1 && analysis.subtune === target.subtune && analysis.clock === target.clock && analysis.timeBasis === 'seconds-from-init', 'analysis identity');
    digest(analysis.sidSha256, 'analysis.sidSha256');
    requireValue(analysis.sidSha256 === (files.sid as Record<string, unknown>).sha256, 'analysis SID hash must match playable SID');
    requireValue(Array.isArray(analysis.annotations), 'analysis.annotations');
    const annotationIds = new Set<string>();
    for (const rawAnnotation of analysis.annotations) {
      const annotation = record(rawAnnotation, ['id', 'startSeconds', 'endSeconds', 'title', 'description', 'evidenceLevel', 'voices', 'sourceUrl'], 'annotation');
      identifier(annotation.id, 'annotation.id');
      requireValue(!annotationIds.has(annotation.id), 'duplicate annotation id');
      annotationIds.add(annotation.id);
      requireValue(typeof annotation.startSeconds === 'number' && Number.isFinite(annotation.startSeconds) && annotation.startSeconds >= 0, 'annotation.startSeconds');
      requireValue(typeof annotation.endSeconds === 'number' && Number.isFinite(annotation.endSeconds) && annotation.endSeconds > annotation.startSeconds && annotation.endSeconds <= entry.durationSeconds, 'annotation.endSeconds');
      text(annotation.title, 'annotation.title');
      text(annotation.description, 'annotation.description');
      requireValue(typeof annotation.evidenceLevel === 'string' && ['verified', 'derived', 'interpretation'].includes(annotation.evidenceLevel), 'annotation.evidenceLevel');
      requireValue(Array.isArray(annotation.voices) && annotation.voices.length > 0 && annotation.voices.every((voice) => Number.isInteger(voice) && voice >= 1 && voice <= 3) && new Set(annotation.voices).size === annotation.voices.length, 'annotation.voices');
      httpsUrl(annotation.sourceUrl, 'annotation.sourceUrl');
    }
  }
  return value as Catalog;
}
