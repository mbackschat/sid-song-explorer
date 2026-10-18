#!/usr/bin/env python3
"""Bound the native live-gain feasibility test against the shipped SIDLite source."""
import argparse
import datetime
import platform
import hashlib
import json
import pathlib
import shutil
import subprocess
import tarfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[3]
SOURCE_SHA256 = 'd0a3fa551bde2b55733b3c2bfd8ebd6f886ec9d81407c069d2ded15600eef0fb'
FILES = ['SID.cpp', 'SID.h', 'WavGen.cpp', 'WavGen.h', 'ADSR.cpp', 'ADSR.h', 'Filter.cpp', 'Filter.h',
         'cw_tables.h', 'filt_tables.h', 'sl_constants.h', 'sl_settings.h', 'sl_defs.h.in']


def replace(path, old, new, count=1):
    text = path.read_text()
    if text.count(old) != count:
        raise RuntimeError(f'Pinned source mismatch in {path.name}: {old!r}')
    path.write_text(text.replace(old, new))


def apply_gains(source):
    replace(source / 'SID.h', '    int getLevel() const',
            '    void setOutputMask(unsigned mask) { wavgen.setOutputMask(mask); }\n\n    int getLevel() const')
    replace(source / 'WavGen.h', '    wg_output_t clock(const ADSR *adsr);', '''    wg_output_t clock(const ADSR *adsr);
    void setOutputMask(unsigned mask)
    {
        for (int channel = 0; channel < 3; channel++)
            outputTarget[channel] = (mask & (1u << channel)) ? 0 : 256;
    }''')
    replace(source / 'WavGen.h', '    unsigned char *m_regs;',
            '    int outputGain[3] = {256, 256, 256};\n    int outputTarget[3] = {256, 256, 256};\n\n    unsigned char *m_regs;')
    replace(source / 'WavGen.cpp', '        if (UNLIKELY(FilterSwitchReso & (1 << Channel)))', '''        if (outputGain[Channel] < outputTarget[Channel]) outputGain[Channel]++;
        else if (outputGain[Channel] > outputTarget[Channel]) outputGain[Channel]--;
        const int contribution = ((swave * Envelope) / ENVELOPE_MAGNITUDE_DIV) * outputGain[Channel] / 256;
        if (UNLIKELY(FilterSwitchReso & (1 << Channel)))''')
    replace(source / 'WavGen.cpp', '+= (swave * Envelope) / ENVELOPE_MAGNITUDE_DIV;', '+= contribution;', 2)
    replace(source / 'WavGen.cpp', '        PhaseAccu[Channel] = 0;',
            '        outputGain[Channel] = outputTarget[Channel] = 256;\n        PhaseAccu[Channel] = 0;')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='build/live-voice-prototype')
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    if not output.is_relative_to(ROOT / 'build'):
        parser.error('Output must be inside this repository’s ignored build directory.')
    output.mkdir(parents=True, exist_ok=True)
    (output / 'result.json').unlink(missing_ok=True)
    archive = ROOT / 'public/generated/engine-complete-source.tar.gz'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise RuntimeError('Engine corresponding-source archive differs from the pin.')
    started = time.monotonic()
    deadline = started + 60

    def run_bounded(command, stage):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError('Prototype exceeded the 60-second total budget.')
        result = subprocess.run(command, capture_output=True, text=True, timeout=min(20, remaining))
        (output / f'{stage}.log').write_text(result.stdout + result.stderr)
        return result

    with tarfile.open(archive) as package:
        for variant in ['stock', 'gains', 'wrong-mask']:
            source = output / variant
            source.mkdir(exist_ok=True)
            for name in FILES:
                member = next(m for m in package.getmembers() if m.name.endswith('/sidlite/' + name))
                (source / name).write_bytes(package.extractfile(member).read())
            (source / 'sl_defs.h').write_text((source / 'sl_defs.h.in').read_text().replace('@HAVE_BUILTIN_EXPECT@', '1'))
            if variant != 'stock':
                apply_gains(source)
            if variant == 'wrong-mask':
                replace(source / 'WavGen.h', '(mask & (1u << channel)) ? 0 : 256', 'mask ? 0 : 256')
            command = [shutil.which('clang++') or 'clang++', '-std=c++17', '-O2', '-I', str(source)]
            if variant != 'stock':
                command += ['-DOUTPUT_GAINS']
            command += [str(ROOT / 'scripts/experiments/live-voice/probe.cpp')]
            command += [str(source / name) for name in ['SID.cpp', 'WavGen.cpp', 'ADSR.cpp', 'Filter.cpp']]
            command += ['-o', str(source / 'probe')]
            compiled = run_bounded(command, f'{variant}-compile')
            if compiled.returncode:
                raise RuntimeError(f'{variant} compilation failed: {compiled.stderr}')
    red = run_bounded([str(output / 'stock/probe'), str(output / 'red.pcm'), 'verify'], 'red')
    if red.returncode != 1 or 'selected voices differ from independent gate-off oracle' not in red.stderr:
        raise RuntimeError(f'Unmodified engine did not fail the intended guard: {red.stderr}')
    print('RED: no-op output control failed the sustained-note selection oracle.', flush=True)
    wrong_mask = run_bounded([str(output / 'wrong-mask/probe'), str(output / 'wrong-mask.pcm'), 'verify'], 'wrong-mask')
    if wrong_mask.returncode != 1 or 'selected voices differ from independent gate-off oracle' not in wrong_mask.stderr:
        raise RuntimeError('The independent oracle failed to reject a mask that always mutes every voice.')
    print('RED: always-mute-all mutation failed the independent per-voice selection oracle.', flush=True)
    results = {}
    for variant, mode in [('stock', 'baseline'), ('gains', 'verify')]:
        run = run_bounded([str(output / variant / 'probe'), str(output / f'{variant}.pcm'), mode], variant)
        if run.returncode:
            raise RuntimeError(f'{variant}: {run.stderr}')
        results[variant] = json.loads(run.stdout)
    stock = (output / 'stock.pcm').read_bytes()
    gains = (output / 'gains.pcm').read_bytes()
    if len(stock) != results['stock']['frames'] * 2 or len(gains) != results['gains']['frames'] * 2:
        raise RuntimeError('Native PCM output was truncated.')
    if stock != gains:
        raise RuntimeError('Default full-mix PCM differs from separately compiled unmodified SIDLite.')
    compiler = run_bounded([shutil.which('clang++') or 'clang++', '--version'], 'compiler')
    receipt = {'date': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'platform': platform.platform(),
               'compiler': compiler.stdout.splitlines()[0], 'sourceSha256': SOURCE_SHA256, 'fullMixSha256': hashlib.sha256(stock).hexdigest(),
               'fullMixBytes': len(stock), 'models': ['MOS6581', 'MOS8580'],
               'fixtures': ['sustained saw', 'triangle ring and sync', 'resonant swept lowpass', 'D418 volume digi', 'noise'],
               'masks': list(range(1, 8)), 'results': results, 'elapsedSeconds': time.monotonic()-started,
               'scope': 'Native SIDLite synthetic fixtures; no CPU emulation, browser, audio device, full-state checkpoint or listening claim.'}
    (output / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2), flush=True)


if __name__ == '__main__':
    main()
