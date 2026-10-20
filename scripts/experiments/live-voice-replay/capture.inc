    emscripten::val renderCapture(unsigned int cycles)
    {
        if (!tune || !configured)
            return emscripten::val::null();
        const unsigned int chipCount = player.installedSIDs();
        if (chipCount < 1 || chipCount > 2)
            throw std::invalid_argument("Capture requires one or two SIDLite chips");
        std::vector<short*> buffers(chipCount, nullptr);
        player.buffers(buffers.data());
        std::vector<SIDLite::SID*> captureChips;
        for (short* buffer : buffers)
        {
            SIDLite::SID* chip = builder->replayChip(buffer);
            if (!chip)
                throw std::runtime_error("Cannot identify capture chip");
            chip->beginReplayCapture();
            captureChips.push_back(chip);
        }
        const int frames = player.play(cycles);
        for (auto* chip : captureChips)
            chip->endReplayCapture();
        if (frames < 0)
        {
            lastError = player.error();
            return emscripten::val::null();
        }
        player.buffers(buffers.data());
        mixBuffer.resize(static_cast<size_t>(frames) * chipCount);
        replayRecords.resize(static_cast<size_t>(frames) * chipCount * 10);
        replayCheckpoint.resize(chipCount * 8);
        for (unsigned int chip = 0; chip < chipCount; ++chip)
        {
            const auto& captured = captureChips[chip]->replayCaptureRecords();
            if (captured.size() != static_cast<size_t>(frames) * 10)
                throw std::runtime_error("Capture does not align with returned native buffer");
            const auto& state = captureChips[chip]->replayCaptureCheckpoint();
            std::copy(state.begin(), state.end(), replayCheckpoint.begin() + chip * 8);
            for (int frame = 0; frame < frames; ++frame)
            {
                const size_t index = static_cast<size_t>(frame) * chipCount + chip;
                mixBuffer[index] = buffers[chip][frame];
                std::copy_n(captured.data() + frame * 10, 10, replayRecords.data() + index * 10);
            }
        }
        emscripten::val result = emscripten::val::object();
        result.set("frames", frames);
        result.set("chips", chipCount);
        result.set("pcm", emscripten::val(emscripten::typed_memory_view(mixBuffer.size(), mixBuffer.data())));
        result.set("records", emscripten::val(emscripten::typed_memory_view(replayRecords.size(), replayRecords.data())));
        result.set("checkpoint", emscripten::val(emscripten::typed_memory_view(replayCheckpoint.size(), replayCheckpoint.data())));
        return result;
    }
