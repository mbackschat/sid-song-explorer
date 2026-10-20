#ifndef EXPLORER_VOICE_REPLAY_H
#define EXPLORER_VOICE_REPLAY_H

#include "Filter.h"
#include "sl_settings.h"
#include <array>
#include <cstdint>
#include <stdexcept>

namespace SIDLite
{
class VoiceReplayChip
{
public:
    explicit VoiceReplayChip(const int32_t* state) : filter(&configuration, registers.data())
    {
        restore(state);
    }

    void restore(const int32_t* state)
    {
        if (state[0] != 1 || state[5] < 0 || state[5] > 255 ||
            state[6] < 0 || state[6] > 3 || state[7] < 8000 || state[7] > 48000)
            throw std::invalid_argument("Invalid replay checkpoint");
        configuration.sid8580 = (state[6] & 1) != 0;
        configuration.RealSIDmode = (state[6] & 2) != 0;
        sampleRate = state[7];
        filter.rebuildCutoffTables(sampleRate);
        filter.restoreReplayState(state + 1);
    }

    void checkpoint(int32_t* state) const
    {
        state[0] = 1;
        filter.exportReplayState(state + 1);
        state[6] = (configuration.is8580() ? 1 : 0) | (configuration.getRealSIDmode() ? 2 : 0);
        state[7] = sampleRate;
    }

    short render(const uint8_t* record, unsigned int mask)
    {
        for (unsigned int reg = 0; reg < 4; ++reg)
            registers[0x15 + reg] = record[6 + reg];
        int filtered = 0;
        int direct = 0;
        for (unsigned int voice = 0; voice < 3; ++voice)
        {
            const int word = record[voice * 2] | (record[voice * 2 + 1] << 8);
            const int contribution = (mask & (1u << voice)) ? (word < 32768 ? word : word - 65536) : 0;
            if (registers[0x17] & (1u << voice))
                filtered += contribution;
            else if (voice != 2 || !(registers[0x18] & 0x80))
                direct += contribution;
        }
        // SID::generateSample in the pinned source owns the saturation boundary.
        const int sample = filter.clock(filtered, direct);
        return sample > INT16_MAX ? INT16_MAX : sample < INT16_MIN ? INT16_MIN : sample;
    }

private:
    std::array<unsigned char, 32> registers{};
    settings configuration;
    Filter filter;
    int sampleRate;
};
}
#endif
