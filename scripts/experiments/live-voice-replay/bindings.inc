class VoiceReplay
{
public:
    explicit VoiceReplay(const emscripten::val &state) { restore(state); }

    void restore(const emscripten::val &state)
    {
        const unsigned int length = state["length"].as<unsigned int>();
        if (length != 8 && length != 16)
            throw std::invalid_argument("Replay requires one or two chip checkpoints");
        checkpointBuffer.resize(length);
        emscripten::val(emscripten::typed_memory_view(length, checkpointBuffer.data())).call<void>("set", state);
        chips.clear();
        for (unsigned int chip = 0; chip < length / 8; ++chip)
            chips.emplace_back(new SIDLite::VoiceReplayChip(checkpointBuffer.data() + chip * 8));
    }

    emscripten::val checkpoint()
    {
        for (size_t chip = 0; chip < chips.size(); ++chip)
            chips[chip]->checkpoint(checkpointBuffer.data() + chip * 8);
        return emscripten::val(emscripten::typed_memory_view(checkpointBuffer.size(), checkpointBuffer.data()));
    }

    emscripten::val render(const emscripten::val &records, unsigned int voiceMask)
    {
        const size_t length = records["length"].as<unsigned int>();
        const size_t frameBytes = chips.size() * 10;
        if (length % frameBytes || length > 4096 * frameBytes)
            throw std::invalid_argument("Replay records must contain at most 4096 complete frames");
        inputBuffer.resize(length);
        emscripten::val(emscripten::typed_memory_view(length, inputBuffer.data())).call<void>("set", records);
        outputBuffer.resize(length / 10);
        for (size_t frame = 0; frame < length / frameBytes; ++frame)
            for (size_t chip = 0; chip < chips.size(); ++chip)
                outputBuffer[frame * chips.size() + chip] = chips[chip]->render(
                    inputBuffer.data() + frame * frameBytes + chip * 10, voiceMask >> (chip * 3));
        return emscripten::val(emscripten::typed_memory_view(outputBuffer.size(), outputBuffer.data()));
    }

private:
    std::vector<std::unique_ptr<SIDLite::VoiceReplayChip>> chips;
    std::vector<int32_t> checkpointBuffer;
    std::vector<uint8_t> inputBuffer;
    std::vector<short> outputBuffer;
};
