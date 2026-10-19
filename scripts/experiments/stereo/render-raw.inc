    /**
     * Render unmixed chip buses from one C64 execution pass.
     *
     * libsidplayfp 3.1.1's buffers() exposes each complete chip output;
     * SimpleMixer's two-chip crossfeed cannot preserve the declared A/B routing.
     * Like render(), this returns a borrowed heap view. Its channels are
     * installedSIDs(), independently of the configured stock mixer mode.
     */
    emscripten::val renderRaw(unsigned int cycles)
    {
        if (!tune || !configured)
        {
            return emscripten::val::null();
        }

        const int produced = player.play(cycles);
        if (produced < 0)
        {
            lastError = player.error();
            return emscripten::val::null();
        }
        if (produced == 0)
        {
            return makeEmptyInt16Array();
        }

        const unsigned int chips = player.installedSIDs();
        std::vector<short*> chipBuffers(chips, nullptr);
        player.buffers(chipBuffers.data());
        for (const short* buffer : chipBuffers)
        {
            if (buffer == nullptr)
            {
                lastError = "Missing raw SID chip buffer";
                return emscripten::val::null();
            }
        }
        const size_t requiredSamples = static_cast<size_t>(produced) * chips;
        mixBuffer.resize(requiredSamples);
        for (int frame = 0; frame < produced; ++frame)
        {
            for (unsigned int chip = 0; chip < chips; ++chip)
            {
                mixBuffer[static_cast<size_t>(frame) * chips + chip] = chipBuffers[chip][frame];
            }
        }
        return emscripten::val(emscripten::typed_memory_view(requiredSamples, mixBuffer.data()));
    }
