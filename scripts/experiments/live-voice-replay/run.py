#!/usr/bin/env python3
"""Build and verify an isolated prefilter replay experiment using the stereo toolchain."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
WORK = ROOT / 'build/live-voice-replay'


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = module(HERE.parent / 'stereo/run.py', 'stereo_build')
base.WORK = WORK
base.SOURCE = WORK / 'source' / base.SOURCE_NAME
base.WRAPPER = base.SOURCE / 'libsidplayfp-wasm'
base.OUTPUT = WORK / 'output'


def fingerprint(paths):
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(str(path.relative_to(base.SOURCE)).encode() + b'\0')
        digest.update(path.read_bytes())
    return digest.hexdigest()


def source_files(directory):
    return [path for path in directory.rglob('*') if path.is_file() and '__pycache__' not in path.parts]


def tree_hashes(directory):
    return {str(path.relative_to(directory)): base.digest(path) for path in source_files(directory)}


def reuse_dependency(compiler, phases, image):
    adopted = ROOT / 'build/stereo-gate'
    source = adopted / 'source' / base.SOURCE_NAME
    provenance = json.loads((adopted / 'output/provenance.json').read_text())
    if provenance['dockerImage'] != image or provenance['sourceArchiveSha256'] != base.SOURCE_SHA256:
        raise RuntimeError('Adopted dependency toolchain/source pin differs.')
    if tree_hashes(source / 'libresidfp') != tree_hashes(base.SOURCE / 'libresidfp'):
        raise RuntimeError('Cannot reuse a changed libresidfp dependency.')
    for name in ['scripts/apply-thread-guards.py', 'scripts/upstream.mjs', 'upstream.json']:
        if (source / 'libsidplayfp-wasm' / name).read_bytes() != (base.WRAPPER / name).read_bytes():
            raise RuntimeError(f'Dependency build helper differs: {name}')
    inputs = json.loads((adopted / 'toolchain-inputs.json').read_text())
    if inputs != {name: base.digest(source / 'libsidplayfp-wasm' / name) for name in inputs}:
        raise RuntimeError('Adopted wrapper inputs changed after their build.')
    signature = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode() + b''.join(
        (source / f'explorer-stereo-gate/phases/{phase}.sh').read_bytes() for phase, _ in base.PHASES)).hexdigest()
    if (adopted / 'compiler/inputs.sha256').read_text() != signature:
        raise RuntimeError('Adopted compiler inputs differ from their successful receipt.')
    for phase, _ in base.PHASES[:3]:
        if (adopted / f'compiler/{phase}.done').read_text() != signature:
            raise RuntimeError(f'Adopted dependency phase is incomplete: {phase}')
        if (source / f'explorer-stereo-gate/phases/{phase}.sh').read_bytes() != (phases / f'{phase}.sh').read_bytes():
            raise RuntimeError(f'Adopted dependency command differs: {phase}')
    prefix = adopted / 'compiler/sysroot'
    payload = tree_hashes(prefix)
    expected = {'include/residfp/residfp_defs.h', 'include/residfp/sidversion.h', 'include/residfp/residfp.h',
                'lib/pkgconfig/libresidfp.pc', 'lib/libresidfp.la', 'lib/libresidfp.a'}
    if set(payload) != expected:
        raise RuntimeError('Dependency prefix contains missing or unrelated outputs.')
    if payload['lib/libresidfp.a'] != base.digest(adopted / 'compiler/libresidfp/src/.libs/libresidfp.a'):
        raise RuntimeError('Installed dependency archive differs from the completed compiler output.')
    shutil.copytree(prefix, compiler / 'sysroot', dirs_exist_ok=True)
    if tree_hashes(compiler / 'sysroot') != payload:
        raise RuntimeError('Dependency copy differs from its source.')
    print('Reuse verified unchanged libresidfp dependency; compile modified SIDLite/player separately.', flush=True)
    return {'source': 'build/stereo-gate/compiler/sysroot', 'compilerSignature': signature, 'files': payload}


def invalidate_verification():
    for receipt in WORK.glob("verify-*.json"):
        receipt.unlink()


def prepare():
    invalidate_verification()
    base.prepare()
    changed = module(HERE / 'patch.py', 'voice_patch').apply(base.SOURCE)
    shutil.copy2(base.WRAPPER / 'test/fixtures/test-tone-c4.sid', base.WRAPPER / 'test-tone-c4.sid')
    shutil.copytree(HERE, base.SOURCE / 'explorer-live-voice-replay', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__'))
    manifest = {name: base.digest(base.SOURCE / name) for name in changed}
    (WORK / 'patch-inputs.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Prepared isolated replay sources; {len(changed)} patched files.', flush=True)


def toolchain(image_id):
    if image_id is None:
        recorded = ROOT / 'build/stereo-gate/image.id'
        if not recorded.exists():
            raise RuntimeError('Pass --image with the verified stereo toolchain image, or prepare that toolchain first.')
        image_id = recorded.read_text().strip()
    result = subprocess.run(['docker', 'image', 'inspect', image_id, '--format', '{{.Id}} {{.Architecture}}'],
                            check=True, capture_output=True, text=True, timeout=15)
    resolved, architecture = result.stdout.strip().split()
    if architecture != 'amd64' or not resolved.startswith('sha256:'):
        raise RuntimeError('Expected the pinned amd64 stereo toolchain image.')
    (WORK / 'image.id').write_text(resolved + '\n')
    print(f'Reusing local toolchain {resolved}; no production artifact is changed.', flush=True)


def build():
    invalidate_verification()
    (base.OUTPUT / 'result.json').unlink(missing_ok=True)
    manifest = json.loads((WORK / 'patch-inputs.json').read_text())
    if manifest != {name: base.digest(base.SOURCE / name) for name in manifest}:
        raise RuntimeError('Patched source changed after preparation; rerun prepare before compiling.')
    base.OUTPUT.mkdir(parents=True, exist_ok=True)
    (base.OUTPUT / 'package.json').write_text('{"type":"module","private":true}\n')
    phases = base.phases()
    build_script = (phases / 'player-build.sh').read_text()
    (phases / 'player-clean.sh').write_text(build_script[:build_script.index('emmake make -j')] + 'emmake make clean\n')
    compiler = WORK / 'compiler'
    compiler.mkdir(exist_ok=True)
    image = (WORK / 'image.id').read_text().strip()
    dependency = reuse_dependency(compiler, phases, image)
    identity = {
        'toolchain': image,
        'resid': fingerprint(source_files(base.SOURCE / 'libresidfp')),
        'player': fingerprint(source_files(base.SOURCE / 'libsidplayfp')),
        'wrapper': fingerprint(source_files(base.WRAPPER)),
        'runner': base.digest(Path(__file__)),
        'stereoRunner': base.digest(HERE.parent / 'stereo/run.py'),
        'reusedDependency': dependency,
    }
    invalidated = False
    for phase, budget in [('player-bootstrap', 120), ('player-clean', 60), ('player-build', 120), ('link', 120)]:
        if phase == 'player-clean':
            identity['reusedConfiguration'] = module(HERE / 'configuration.py', 'replay_configuration').reuse(
                base.SOURCE, compiler, ROOT / 'build/stereo-gate', manifest, image)
            identity['configurationHelper'] = base.digest(HERE / 'configuration.py')
            invalidated = True
        inputs = {'toolchain': image, 'runner': identity['runner'], 'stereoRunner': identity['stereoRunner'],
                  'resid': identity['resid'], 'dependency': dependency, 'script': base.digest(phases / f'{phase}.sh')}
        if 'reusedConfiguration' in identity:
            inputs.update(configuration=identity['reusedConfiguration'], helper=identity['configurationHelper'])
        if not phase.startswith('resid-'):
            inputs.update(player=identity['player'], wrapper=identity['wrapper'])
        signature = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
        receipt = compiler / f'{phase}.done'
        if not invalidated and receipt.exists() and receipt.read_text() == signature:
            print(f'{phase}: reuse identical completed inputs.', flush=True)
            continue
        invalidated = True
        receipt.unlink(missing_ok=True)
        name = f'sid-explorer-voice-replay-{phase}-{os.getpid()}'
        base.run(['docker', 'run', '--rm', '--platform', 'linux/amd64', '--name', name,
                  '--network', 'none', '-e', 'LIBSIDPLAYFP_WASM_ENGINE=sidlite', '--entrypoint', 'bash',
                  '-v', f'{base.SOURCE}:/opt/pinned-source:ro', '-v', f'{base.WRAPPER}:/opt/libsidplayfp-wasm:ro',
                  '-v', f'{base.OUTPUT}:/dist', '-v', f'{compiler}:/work', '-v', f'{phases}:/phases:ro',
                  image, f'/phases/{phase}.sh'], phase, budget, ['docker', 'rm', '-f', name])
        if phase == 'player-clean' and any(path.suffix in {'.o', '.lo', '.a'} for path in source_files(compiler / 'libsidplayfp')):
            raise RuntimeError('Configured player reuse left compiled objects after make clean.')
        receipt.write_text(signature)
    modifications = base.OUTPUT / 'MODIFICATIONS.md'
    modifications.write_text((base.WRAPPER / 'MODIFICATIONS.md').read_text() + '\nExperimental prefilter capture and same-filter replay; not the adopted Explorer engine. See explorer-live-voice-replay in the corresponding source.\n')
    shutil.copy2(ROOT / 'LICENSE', base.OUTPUT / 'EXPLORER-LICENSE.txt')
    shutil.copytree(HERE, base.SOURCE / 'explorer-live-voice-replay', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__'))
    with tarfile.open(base.OUTPUT / 'complete-source.tar.gz', 'w:gz') as archive:
        archive.add(base.SOURCE, arcname=base.SOURCE_NAME)
    identity['files'] = {name: base.digest(base.OUTPUT / name) for name in
                         ['libsidplayfp.js', 'libsidplayfp.wasm', 'complete-source.tar.gz']}
    identity['patches'] = manifest
    (base.OUTPUT / 'provenance.json').write_text(json.dumps(identity, indent=2) + '\n')


def verify(node, red):
    if not red:
        invalidate_verification()
    module_path = ROOT / 'build/stereo-gate/output/libsidplayfp.js' if red else base.OUTPUT / 'libsidplayfp.js'
    for model in ['MOS6581', 'MOS8580']:
        for clock in ['PAL', 'NTSC']:
            name = f'{"red" if red else "verify"}-{model}-{clock}'
            receipt = WORK / f'{name}.json'
            receipt.unlink(missing_ok=True)
            command = [node, str(HERE / 'verify.mjs'), '--module', str(module_path),
                       '--raw-module', str(ROOT / 'build/stereo-gate/output/libsidplayfp.js'),
                       '--stock-module', str(ROOT / 'node_modules/libsidplayfp-wasm/dist/sidlite/libsidplayfp.js'),
                       '--sample', str(ROOT / 'public/generated/rambo-loader-main.sid'),
                       '--model', model, '--clock', clock, '--output', str(receipt)]
            if red:
                command.append('--expect-missing-api')
            base.run(command, name, 60)
    print('All requested profile checks completed.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['prepare', 'toolchain', 'build', 'red', 'verify'])
    parser.add_argument('--node', default='node')
    parser.add_argument('--image')
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    base.OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.stage == 'prepare':
        prepare()
    elif args.stage == 'toolchain':
        toolchain(args.image)
    elif args.stage == 'build':
        build()
    else:
        verify(args.node, args.stage == 'red')


if __name__ == '__main__':
    main()
