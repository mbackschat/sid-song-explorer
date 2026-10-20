#!/usr/bin/env python3
"""Prepare, build and verify the pinned raw-chip WASM adoption gate."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[3]
HERE = pathlib.Path(__file__).resolve().parent
WORK = ROOT / 'build/stereo-gate'
SOURCE_SHA256 = 'd0a3fa551bde2b55733b3c2bfd8ebd6f886ec9d81407c069d2ded15600eef0fb'
TONE_SHA256 = '179eef28203d70356ebbf3252a301e0467ae5aa8ef1043930325f4f2d0fd1119'
IMAGE = 'sid-song-explorer/stereo-gate:1.1.0'
BASE_IMAGE = 'emscripten/emsdk:3.1.74'
SOURCE_NAME = 'libsidplayfp-wasm-1.1.0-complete-source'
SOURCE = WORK / 'source' / SOURCE_NAME
WRAPPER = SOURCE / 'libsidplayfp-wasm'
OUTPUT = WORK / 'output'
BUILD_INPUTS = ['src/bindings/bindings.cpp', 'src/libsidplayfp.d.ts', 'docker/Dockerfile', 'docker/entrypoint.sh']
PHASES = [('resid-bootstrap', 120), ('resid-configure', 240), ('resid-build', 120),
          ('player-bootstrap', 120), ('player-configure', 240), ('player-build', 120), ('link', 120)]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace(path, old, new):
    content = path.read_text()
    if content.count(old) != 1:
        raise RuntimeError(f'Pinned source mismatch: {path.name}: {old!r}')
    path.write_text(content.replace(old, new))


def phases():
    """Separate the upstream commands without changing compiler flags or patches."""
    text = (WRAPPER / 'docker/entrypoint.sh').read_text()
    first_sync = text.index('sync_repo "${RESIDFP_GIT_URL}"')
    extra = text.index('\nEXTRA_FLAGS=') + 1
    first_autoreconf = text.index('autoreconf -vfi')
    first_configure = text.index('emconfigure ./configure')
    first_make = text.index('emmake make -j')
    second_sync = text.index('sync_repo "${GIT_URL}"')
    second_configure = text.index('emconfigure ./configure', first_configure + 1)
    second_make = text.index('emmake make -j', first_make + 1)
    link = text.index('cp /opt/libsidplayfp-wasm/src/bindings/bindings.cpp')
    common = text[:first_sync] + text[extra:first_autoreconf]
    common = common.replace('BUILD_ROOT=/tmp/libsidplayfp', 'BUILD_ROOT=/work/libsidplayfp')
    common = common.replace('RESIDFP_BUILD_ROOT=/tmp/libresidfp', 'RESIDFP_BUILD_ROOT=/work/libresidfp')
    common = common.replace('CACHE_ROOT=/opt/libsidplayfp-cache', 'CACHE_ROOT=/work/cache')
    common = common.replace('SYSROOT_PREFIX=/opt/wasm-sysroot', 'SYSROOT_PREFIX=/work/sysroot')
    common = common.replace('rm -rf "${BUILD_ROOT}" "${RESIDFP_BUILD_ROOT}"', ':')
    common += '\nexport PKG_CONFIG_PATH="${SYSROOT_PREFIX}/lib/pkgconfig"\n'
    bodies = {
        'resid-bootstrap': text[first_sync:extra] + 'autoreconf -vfi\n',
        'resid-configure': text[first_configure:first_make],
        'resid-build': text[first_make:second_sync],
        'player-bootstrap': text[second_sync:second_configure],
        'player-configure': text[second_configure:second_make],
        'player-build': text[second_make:link],
        'link': text[link:text.rindex('rm -rf "${BUILD_ROOT}"')],
    }
    directory = SOURCE / 'explorer-stereo-gate/phases'
    directory.mkdir(parents=True, exist_ok=True)
    for name, body in bodies.items():
        cwd = 'RESIDFP_BUILD_ROOT' if name.startswith('resid-') else 'BUILD_ROOT'
        (directory / f'{name}.sh').write_text(common + f'\ncd "${{{cwd}}}"\n' + body)
    return directory


def prepare():
    (OUTPUT / 'result.json').unlink(missing_ok=True)
    archive = ROOT / 'node_modules/libsidplayfp-wasm/dist/complete-source.tar.gz'
    if digest(archive) != SOURCE_SHA256:
        raise RuntimeError('Corresponding-source archive does not match its recorded SHA-256.')
    if SOURCE.exists():
        shutil.rmtree(SOURCE)
    with tarfile.open(archive) as package:
        package.extractall(WORK / 'source', filter='data')
    # The release's Dockerfile requires this fixture, but its source archive
    # omits test/fixtures; the same package distributes it under fixtures/.
    tone = ROOT / 'node_modules/libsidplayfp-wasm/fixtures/test-tone-c4.sid'
    if digest(tone) != TONE_SHA256:
        raise RuntimeError('Published synthetic smoke fixture differs from its pin.')
    (WRAPPER / 'test/fixtures').mkdir(parents=True)
    shutil.copy2(tone, WRAPPER / 'test/fixtures/test-tone-c4.sid')
    binding = WRAPPER / 'src/bindings/bindings.cpp'
    replace(binding, '    bool reset()\n', (HERE / 'render-raw.inc').read_text().rstrip('\n') + '\n\n    bool reset()\n')
    replace(binding, '.function("render", &SidPlayerContext::render)',
            '.function("render", &SidPlayerContext::render)\n        .function("renderRaw", &SidPlayerContext::renderRaw)')
    replace(WRAPPER / 'src/libsidplayfp.d.ts', '  render(cycles: number): Int16Array | null;',
            '''  render(cycles: number): Int16Array | null;
  /** Borrowed chip-order interleaved PCM; channels equal getInstalledSids(), not getChannels(). Copy before further WASM calls. */
  renderRaw(cycles: number): Int16Array | null;''')

    # The hash-verified release archive contains both pristine dependency trees,
    # including submodules; rebuilding need not fetch another copy from Git.
    entrypoint = WRAPPER / 'docker/entrypoint.sh'
    text = entrypoint.read_text()
    start = text.index('sync_repo() {\n')
    end = text.index('\n}\n', start) + 3
    text = text[:start] + '''sync_repo() {
    local url="$1" dest="$2" ref="$3" expected_commit="$4"
    local name="${url##*/}"
    rsync -a --delete "/opt/pinned-source/${name}/" "${dest}/"
    echo "archive pin: ${name} ${ref} ${expected_commit}"
}
''' + text[end:]
    text = text.replace('git config --global --add safe.directory \'*\'', ':')
    text = text.replace('$(git -C "${RESIDFP_CACHE_REPO}" rev-parse --short HEAD)', '${LIBRESIDFP_COMMIT}')
    text = text.replace('$(git -C "${CACHE_REPO}" rev-parse --short HEAD)', '${LIBSIDPLAYFP_COMMIT}')
    text = text.replace('git submodule update --init --recursive', ': # Submodule files are included in the pinned archive.')
    entrypoint.write_text(text)
    modifications = WRAPPER / 'MODIFICATIONS.md'
    modifications.write_text(modifications.read_text() + '''
## SID Song Explorer raw-chip adoption gate

Adds SidPlayerContext.renderRaw(cycles), returning chip-order interleaved PCM from one player.play call and fresh player.buffers pointers. The stock render method and emulator sources are unchanged. The build consumes the pristine dependency trees in this corresponding-source archive instead of fetching them again; compiler flags and upstream patches remain those of version 1.1.0. Restores the published package's synthetic test-tone-c4.sid fixture at the Dockerfile's required path, omitted by the original corresponding-source archive; its generating source is retained in scripts/generate-test-sid.ts.

Explorer's additions are GPL-3.0-or-later; EXPLORER-LICENSE.txt supplies that license. Original upstream notices and GPL-2.0-or-later terms remain intact.
''')
    shutil.copy2(ROOT / 'LICENSE', SOURCE / 'EXPLORER-LICENSE.txt')
    shutil.copytree(HERE, SOURCE / 'explorer-stereo-gate', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__'))
    (SOURCE / 'EXPLORER-REBUILD.md').write_text('''# Rebuild the Explorer raw-chip binding

The original archive SHA-256 is ''' + SOURCE_SHA256 + '''. The pristine library trees and upstream patches retain their original ownership and licenses. The binding, declaration and build-input adaptations are included as source here; explorer-stereo-gate contains the patching and verification inputs.

From this extracted directory, with Docker available:

```sh
docker pull --platform linux/amd64 emscripten/emsdk:3.1.74
docker build --platform linux/amd64 --progress plain -f libsidplayfp-wasm/docker/Dockerfile -t sid-song-explorer/stereo-gate:1.1.0 libsidplayfp-wasm
mkdir -p output compiler
printf '%s\\n' '{"type":"module"}' > output/package.json
for phase in resid-bootstrap resid-configure resid-build player-bootstrap player-configure player-build link; do
  docker run --rm --platform linux/amd64 --network none --entrypoint bash -e LIBSIDPLAYFP_WASM_ENGINE=sidlite -v "$PWD:/opt/pinned-source:ro" -v "$PWD/output:/dist" -v "$PWD/compiler:/work" sid-song-explorer/stereo-gate:1.1.0 "/opt/pinned-source/explorer-stereo-gate/phases/$phase.sh"
done
node explorer-stereo-gate/verify.mjs output/libsidplayfp.js output/result.json --standalone
```

The Docker image setup downloads the pinned Emscripten toolchain and operating-system build dependencies. The actual compiler containers are offline. The project runner separately bounds image download and toolchain package setup at 120 seconds each. Each bootstrap/compile/link phase has a 120-second limit, each configure phase has 240 seconds under the documented amd64-emulation measurement, and verification has 60 seconds. Intermediate libraries and configuration survive in compiler/. Standalone verification checks the rebuilt native binding without a project provenance receipt or the separately published original WASM, so its receipt cannot authorize project adoption. The project runner additionally compares the original shipped mono WASM and binds provenance. No playback, browser or listening acceptance follows from this gate.
''')
    phases()
    print('Prepared additive binding and offline pinned-source build inputs.', flush=True)


def run(command, stage, seconds, cleanup=None):
    WORK.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    log = WORK / f'{stage}.log'
    if log.exists():
        log.rename(WORK / f'{stage}-{time.time_ns()}.log')
    try:
        with log.open('w') as stream:
            process = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT)
            try:
                while True:
                    remaining = seconds - (time.monotonic() - started)
                    if remaining <= 0:
                        raise subprocess.TimeoutExpired(command, seconds)
                    try:
                        status = process.wait(timeout=min(20, remaining))
                        break
                    except subprocess.TimeoutExpired:
                        lines = log.read_text(errors='replace').splitlines()
                        latest = lines[-1][-200:] if lines else 'awaiting compiler output'
                        print(f'{stage}: {time.monotonic() - started:.0f}s / {seconds}s; {latest}', flush=True)
            except BaseException:
                process.kill()
                process.wait(timeout=5)
                raise
        if status:
            raise RuntimeError(f'{stage} failed ({status}); inspect {log}')
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f'{stage} exceeded its {seconds}-second budget; inspect {log}') from error
    finally:
        if cleanup:
            subprocess.run(cleanup, capture_output=True, timeout=15)
        print(f'{stage}: {time.monotonic() - started:.2f}s; log {log}', flush=True)


def atomic_copy(source, destination):
    """Replace container-owned metadata through the runner-owned output directory."""
    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=f'.{destination.name}.', delete=False) as stream:
        temporary = pathlib.Path(stream.name)
    try:
        shutil.copy2(source, temporary)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def bundle():
    shutil.copytree(HERE, SOURCE / 'explorer-stereo-gate', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__'))
    atomic_copy(SOURCE / 'EXPLORER-REBUILD.md', OUTPUT / 'EXPLORER-REBUILD.md')
    atomic_copy(ROOT / 'LICENSE', OUTPUT / 'EXPLORER-LICENSE.txt')
    atomic_copy(WRAPPER / 'MODIFICATIONS.md', OUTPUT / 'MODIFICATIONS.md')
    with tarfile.open(OUTPUT / 'complete-source.tar.gz', 'w:gz') as package:
        package.add(SOURCE, arcname=SOURCE_NAME)
    files = ['libsidplayfp.js', 'libsidplayfp.wasm', 'libsidplayfp.d.ts', 'LICENSE',
             'THIRD-PARTY-NOTICES.md', 'MODIFICATIONS.md', 'EXPLORER-LICENSE.txt', 'complete-source.tar.gz']
    receipt = {'date': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'basePackage': 'libsidplayfp-wasm', 'baseVersion': '1.1.0',
               'sourceArchiveSha256': SOURCE_SHA256, 'engine': 'SIDLite',
               'dockerImage': (WORK / 'image.id').read_text().strip(),
               'upstream': json.loads((WRAPPER / 'upstream.json').read_text()),
               'bindingPatchSha256': digest(HERE / 'render-raw.inc'),
               'buildRunnerSha256': digest(HERE / 'run.py'),
               'files': [{'file': name, 'bytes': (OUTPUT / name).stat().st_size,
                          'sha256': digest(OUTPUT / name)} for name in files]}
    (OUTPUT / 'provenance.json').write_text(json.dumps(receipt, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['prepare', 'red', 'toolchain', 'build', 'verify'])
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.stage == 'prepare':
        prepare()
    elif args.stage == 'red':
        run([args.node, str(HERE / 'verify.mjs'), str(ROOT / 'node_modules/libsidplayfp-wasm/dist/sidlite/libsidplayfp.js'),
             str(WORK / 'red.json'), '--expect-missing-api'], 'red', 60)
    elif args.stage == 'toolchain':
        run(['docker', 'pull', '--platform', 'linux/amd64', BASE_IMAGE], 'image-pull', 120)
        run(['docker', 'build', '--platform', 'linux/amd64', '--progress', 'plain', '--iidfile', str(WORK / 'image.id'),
             '-f', str(WRAPPER / 'docker/Dockerfile'), '-t', IMAGE, str(WRAPPER)], 'toolchain', 120)
        (WORK / 'toolchain-inputs.json').write_text(json.dumps({path: digest(WRAPPER / path)
                                                             for path in BUILD_INPUTS}, indent=2) + '\n')
    elif args.stage == 'build':
        (OUTPUT / 'result.json').unlink(missing_ok=True)
        recorded = json.loads((WORK / 'toolchain-inputs.json').read_text())
        if recorded != {path: digest(WRAPPER / path) for path in BUILD_INPUTS}:
            raise RuntimeError('Build inputs changed since toolchain creation; rebuild the project image.')
        # The upstream smoke check imports ESM before writing its package metadata.
        (OUTPUT / 'package.json').write_text('{"type":"module","private":true}\n')
        phase_directory = phases()
        compiler = WORK / 'compiler'
        compiler.mkdir(exist_ok=True)
        signature = hashlib.sha256(json.dumps(recorded, sort_keys=True).encode() +
                                   b''.join((phase_directory / f'{phase}.sh').read_bytes()
                                            for phase, _ in PHASES)).hexdigest()
        checkpoint = compiler / 'inputs.sha256'
        if checkpoint.exists() and checkpoint.read_text() != signature and any(compiler.glob('*.done')):
            raise RuntimeError('Persistent compiler inputs changed; explicitly remove build/stereo-gate/compiler before rebuilding.')
        checkpoint.write_text(signature)
        for phase, budget in PHASES:
            receipt = compiler / f'{phase}.done'
            if receipt.exists():
                print(f'{phase}: reuse completed phase with identical inputs.', flush=True)
                continue
            name = f'sid-explorer-stereo-{phase}-{os.getpid()}'
            run(['docker', 'run', '--rm', '--platform', 'linux/amd64', '--name', name, '--network', 'none',
                 '-e', 'LIBSIDPLAYFP_WASM_ENGINE=sidlite', '--entrypoint', 'bash',
                 '-v', f'{SOURCE}:/opt/pinned-source:ro', '-v', f'{OUTPUT}:/dist',
                 '-v', f'{compiler}:/work', '-v', f'{phase_directory}:/phases:ro',
                 (WORK / 'image.id').read_text().strip(), f'/phases/{phase}.sh'],
                phase, budget, ['docker', 'rm', '-f', name])
            receipt.write_text(signature)
        bundle()
    else:
        (OUTPUT / 'result.json').unlink(missing_ok=True)
        run([args.node, str(HERE / 'verify.mjs'), str(OUTPUT / 'libsidplayfp.js'),
             str(OUTPUT / 'result.json'), '--compare-stock',
             str(ROOT / 'node_modules/libsidplayfp-wasm/dist/sidlite/libsidplayfp.js')], 'verify', 60)


if __name__ == '__main__':
    main()
