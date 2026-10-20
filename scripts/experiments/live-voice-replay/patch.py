"""Apply the isolated, fail-closed SIDLite capture/replay experiment."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
SID = 'libsidplayfp/src/builders/sidlite-builder/sidlite/'
BINDING = 'libsidplayfp-wasm/src/bindings/bindings.cpp'


def apply(source: Path) -> list[str]:
    changed = []

    def replace(relative, old, new):
        path = source / relative
        text = path.read_text()
        if text.count(old) != 1:
            raise RuntimeError(f'Pinned source mismatch: {relative}: {old!r}')
        path.write_text(text.replace(old, new))
        if relative not in changed:
            changed.append(relative)

    replace(SID + 'Filter.h', '#define SIDLITE_FILTER_H', '#define SIDLITE_FILTER_H\n#include <cstdint>')
    replace(SID + 'Filter.h', '    void reset();', '''    void reset();
    void exportReplayState(int32_t* state) const
    {
        state[0] = PrevVolume;
        state[1] = PrevLowPass;
        state[2] = PrevBandPass;
        state[3] = Level;
        state[4] = VUmeterUpdateCounter;
    }
    void restoreReplayState(const int32_t* state)
    {
        PrevVolume = state[0];
        PrevLowPass = state[1];
        PrevBandPass = state[2];
        Level = state[3];
        VUmeterUpdateCounter = state[4];
    }''')
    replace(SID + 'sl_settings.h', '    friend class SID;', '    friend class SID;\n    friend class VoiceReplayChip;')
    replace(SID + 'WavGen.h', '    wg_output_t clock(const ADSR *adsr);',
            '    wg_output_t clock(const ADSR *adsr, short* contributions = nullptr);')
    replace(SID + 'WavGen.cpp', 'wg_output_t WavGen::clock(const ADSR *adsr)',
            'wg_output_t WavGen::clock(const ADSR *adsr, short* contributions)')
    replace(SID + 'WavGen.cpp', '        int swave = static_cast<int>(WavGenOut) - CRSID_WAVE_MID;', '''        int swave = static_cast<int>(WavGenOut) - CRSID_WAVE_MID;
        if (contributions)
            contributions[Channel] = (swave * Envelope) / ENVELOPE_MAGNITUDE_DIV;''')
    replace(SID + 'SID.h', '#include <array>', '#include <array>\n#include <vector>\n#include <cstdint>\n#include <stdexcept>')
    replace(SID + 'SID.h', '    int getLevel() const { return filter.getLevel(); }', '''    int getLevel() const { return filter.getLevel(); }

    void beginReplayCapture()
    {
        replayRecords.clear();
        captureEnabled = true;
        exportReplayCheckpoint();
    }
    void endReplayCapture() { captureEnabled = false; }
    const std::vector<uint8_t>& replayCaptureRecords() const { return replayRecords; }
    const std::array<int32_t, 8>& replayCaptureCheckpoint() const { return replayCheckpoint; }''')
    replace(SID + 'SID.h', '    short             SampleCycleCnt;', '''    short             SampleCycleCnt;
    bool captureEnabled = false;
    unsigned short replaySampleRate = 44100;
    std::vector<uint8_t> replayRecords;
    std::array<int32_t, 8> replayCheckpoint{};

    void exportReplayCheckpoint()
    {
        replayCheckpoint[0] = 1;
        filter.exportReplayState(replayCheckpoint.data() + 1);
        replayCheckpoint[6] = (s.is8580() ? 1 : 0) | (s.getRealSIDmode() ? 2 : 0);
        replayCheckpoint[7] = replaySampleRate;
    }''')
    replace(SID + 'SID.cpp', '    wg_output_t wg_out = wavgen.clock(&adsr);', '''    short contributions[3];
    wg_output_t wg_out = wavgen.clock(&adsr, captureEnabled ? contributions : nullptr);
    if (captureEnabled)
    {
        if (replayRecords.empty())
            exportReplayCheckpoint();
        if (replayRecords.size() >= 4096 * 10)
            throw std::runtime_error("Capture exceeded bounded native render size");
        for (unsigned int voice = 0; voice < 3; ++voice)
        {
            const uint16_t value = static_cast<uint16_t>(contributions[voice]);
            replayRecords.push_back(value & 255);
            replayRecords.push_back(value >> 8);
        }
        for (unsigned int reg = 0x15; reg <= 0x18; ++reg)
            replayRecords.push_back(regs[reg]);
    }''')
    replace(SID + 'SID.cpp', '    filter.rebuildCutoffTables(samplingFrequency);',
            '    filter.rebuildCutoffTables(samplingFrequency);\n    replaySampleRate = samplingFrequency;')
    replace('libsidplayfp/src/builders/sidlite-builder/sidlite-emu.h', '    int getLevel() const;',
            '    int getLevel() const;\n    SIDLite::SID& replaySID() { return m_sid; }')
    target = SID + 'VoiceReplay.h'
    if (source / target).exists():
        raise RuntimeError('Replay header already exists')
    (source / target).write_bytes((HERE / 'replay.h').read_bytes())
    changed.append(target)
    replace(BINDING, '#include <sidemu.h>', '''#include <sidemu.h>
#include <builders/sidlite-builder/sidlite-emu.h>
#include <builders/sidlite-builder/sidlite/VoiceReplay.h>''')
    replace(BINDING, '    void resetTraceState() {}', '''    void resetTraceState() {}

    SIDLite::SID* replayChip(short* buffer)
    {
        for (auto* emu : sidobjs)
            if (emu->buffer() == buffer)
                return &static_cast<libsidplayfp::SIDLiteEmu*>(emu)->replaySID();
        return nullptr;
    }''')
    replace(BINDING, 'class SidPlayerContext\n', (HERE / 'bindings.inc').read_text() + '\nclass SidPlayerContext\n')
    replace(BINDING, '    bool reset()\n', (HERE / 'capture.inc').read_text() + '\n    bool reset()\n')
    replace(BINDING, '    bool configured;', '''    bool configured;
    std::vector<uint8_t> replayRecords;
    std::vector<int32_t> replayCheckpoint;''')
    replace(BINDING, '.function("renderRaw", &SidPlayerContext::renderRaw)',
            '.function("renderRaw", &SidPlayerContext::renderRaw)\n        .function("renderCapture", &SidPlayerContext::renderCapture)')
    replace(BINDING, '    emscripten::class_<SidPlayerContext>("SidPlayerContext")', '''    emscripten::class_<VoiceReplay>("VoiceReplay")
        .constructor<const emscripten::val&>()
        .function("render", &VoiceReplay::render)
        .function("checkpoint", &VoiceReplay::checkpoint)
        .function("restore", &VoiceReplay::restore);
    emscripten::class_<SidPlayerContext>("SidPlayerContext")''')
    return changed
