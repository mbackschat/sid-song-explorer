"""Reuse configure output after bootstrap; require a clean rebuild before compilation."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[3]
SOURCE_NAME = 'libsidplayfp-wasm-1.1.0-complete-source'
PHASES = ['resid-bootstrap', 'resid-configure', 'resid-build', 'player-bootstrap',
          'player-configure', 'player-build', 'link']
PLAYER_PATCHES = {
    'src/builders/sidlite-builder/sidlite/Filter.h',
    'src/builders/sidlite-builder/sidlite/sl_settings.h',
    'src/builders/sidlite-builder/sidlite/WavGen.h',
    'src/builders/sidlite-builder/sidlite/WavGen.cpp',
    'src/builders/sidlite-builder/sidlite/SID.h',
    'src/builders/sidlite-builder/sidlite/SID.cpp',
    'src/builders/sidlite-builder/sidlite-emu.h',
    'src/builders/sidlite-builder/sidlite/VoiceReplay.h',
}
CONFIGURED_OUTPUTS = ['config.status', 'libtool', 'Makefile', 'tests/Makefile',
                      'libsidplayfp.pc', 'libstilview.pc', 'src/config.h',
                      'src/stamp-h1', 'src/sidplayfp/sidversion.h',
                      'src/builders/sidlite-builder/sidlite/sl_defs.h']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(directory):
    return {str(path.relative_to(directory)): digest(path)
            for path in directory.rglob('*') if path.is_file() and '__pycache__' not in path.parts}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def reuse(source: Path, compiler: Path, adopted: Path, manifest: dict, image: str) -> dict:
    source, compiler, adopted = source.resolve(), compiler.resolve(), adopted.resolve()
    work = ROOT / 'build/live-voice-replay'
    require(source == work / 'source' / SOURCE_NAME and compiler == work / 'compiler'
            and adopted == ROOT / 'build/stereo-gate', 'Configuration reuse is restricted to the isolated spike paths.')
    donor_source = adopted / 'source' / SOURCE_NAME
    donor = adopted / 'compiler/libsidplayfp'
    target = compiler / 'libsidplayfp'
    staging = compiler / 'configuration-reuse-staging'
    require(target.is_dir(), 'Run isolated player-bootstrap before reusing configuration.')
    require(not target.is_symlink() and not staging.is_symlink(), 'Configuration target cannot be a symlink.')
    provenance = json.loads((adopted / 'output/provenance.json').read_text())
    require(provenance['dockerImage'] == image == (adopted / 'image.id').read_text().strip(),
            'Configuration toolchain differs from the adopted build.')
    inputs = json.loads((adopted / 'toolchain-inputs.json').read_text())
    require(all(digest(donor_source / 'libsidplayfp-wasm' / path) == value for path, value in inputs.items()),
            'Donor build inputs differ from their receipt.')
    signature = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode() + b''.join(
        (donor_source / f'explorer-stereo-gate/phases/{phase}.sh').read_bytes() for phase in PHASES)).hexdigest()
    require((adopted / 'compiler/inputs.sha256').read_text() == signature,
            'Donor compiler signature differs.')
    for phase in PHASES[:5]:
        require((adopted / f'compiler/{phase}.done').read_text() == signature,
                f'Donor configuration prerequisite is incomplete: {phase}')
        require((donor_source / f'explorer-stereo-gate/phases/{phase}.sh').read_bytes()
                == (source / f'explorer-stereo-gate/phases/{phase}.sh').read_bytes(),
                f'Configuration command changed: {phase}')
    for helper in ['scripts/apply-thread-guards.py', 'scripts/apply-sid-write-hook.py',
                   'scripts/upstream.mjs', 'upstream.json']:
        require((donor_source / 'libsidplayfp-wasm' / helper).read_bytes()
                == (source / 'libsidplayfp-wasm' / helper).read_bytes(), f'Bootstrap helper changed: {helper}')
    require(inventory(adopted / 'compiler/sysroot') == inventory(compiler / 'sysroot'),
            'Configured dependency prefix differs.')
    player_manifest = {name.removeprefix('libsidplayfp/'): value for name, value in manifest.items()
                       if name.startswith('libsidplayfp/')}
    require(set(player_manifest) == PLAYER_PATCHES, 'Configuration reuse requires the declared eight player patches.')
    pristine = inventory(donor_source / 'libsidplayfp')
    patched = inventory(source / 'libsidplayfp')
    require({k: v for k, v in pristine.items() if k not in PLAYER_PATCHES}
            == {k: v for k, v in patched.items() if k not in PLAYER_PATCHES},
            'Player source changed outside the declared experiment.')
    require(all(patched.get(name) == value for name, value in player_manifest.items()),
            'Player patch bytes differ from the manifest.')
    for name in pristine:
        if name not in PLAYER_PATCHES:
            require(digest(donor / name) == digest(target / name), f'Bootstrapped source changed: {name}')
    configure_inputs = {'configure', 'configure.ac', 'aclocal.m4', 'src/config.h.in'}
    configure_inputs.update(str(path.relative_to(donor)) for path in donor.rglob('Makefile.in'))
    configure_inputs.update(str(path.relative_to(donor)) for path in donor.rglob('*.m4'))
    configured_inputs = {name: digest(donor / name) for name in sorted(configure_inputs)}
    require(all(digest(target / name) == value for name, value in configured_inputs.items()),
            'Generated configure inputs differ from the adopted build.')
    configured_outputs = {name: digest(donor / name) for name in CONFIGURED_OUTPUTS}
    require('#define HAVE_RESIDFP 1' in (donor / 'src/config.h').read_text(),
            'Donor configuration lacks the required dependency.')
    require('S["CXXDEPMODE"]="depmode=none"' in (donor / 'config.status').read_text(),
            'Unexpected donor dependency tracking configuration.')
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(donor, staging)
    for name, expected in player_manifest.items():
        shutil.copy2(source / 'libsidplayfp' / name, staging / name)
        require(digest(staging / name) == expected, f'Copied experiment patch differs: {name}')
    require(all(digest(staging / name) == value for name, value in configured_outputs.items()),
            'Copied configuration differs from the donor.')
    shutil.rmtree(target)
    staging.rename(target)
    return {'source': 'build/stereo-gate/compiler/libsidplayfp', 'compilerSignature': signature,
            'toolchain': image, 'configuredInputs': configured_inputs, 'configuredOutputs': configured_outputs,
            'overlaidPlayerFiles': player_manifest, 'requiresCleanBeforeBuild': True}
