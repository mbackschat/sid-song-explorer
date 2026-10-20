export const UNIT_SHARDS = 7;
export const BROWSER_SHARDS = 1;
export const BROWSER_GLOBAL_TIMEOUT_MS = 170_000;

export function releaseBrowserMatrix() {
  return {include: [
    {project: 'chrome', os: 'ubuntu-24.04', install: 'chrome'},
    {project: 'webkit', os: 'macos-26', install: 'webkit'},
  ].flatMap(project => Array.from({length: BROWSER_SHARDS}, (_, index) => ({...project, index: index + 1, shard: `${index + 1}/${BROWSER_SHARDS}`})))};
}
