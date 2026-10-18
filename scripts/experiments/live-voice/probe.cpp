#include "SID.h"
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <new>
#include <stdexcept>
#include <string>

using SIDLite::SID;
constexpr int rate = 44100;
constexpr int ramp = 256;

void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}

void mask(SID& sid, unsigned bits) {
#ifdef OUTPUT_GAINS
  sid.setOutputMask(bits);
#else
  (void)sid;
  (void)bits;
#endif
}

short sample(SID& sid) {
  short output = 0;
  int guard = 0;
  while (!sid.clock(1, &output)) require(++guard < 64, "sample clock stopped");
  return output;
}

void configure(SID& sid, bool model8580, int fixture) {
  sid.setChipModel(model8580 ? SID::model_t::MOS8580 : SID::model_t::MOS6581);
  require(sid.setSamplingParameters(985248, rate), "sample configuration failed");
  sid.setRealSIDmode(fixture == 3);
  for (int voice = 0; voice < 3; voice++) {
    const int base = voice * 7;
    const int frequency = 3000 + voice * 1700;
    sid.write(base, frequency & 255);
    sid.write(base + 1, frequency >> 8);
    sid.write(base + 2, 0x00);
    sid.write(base + 3, 0x08);
    sid.write(base + 5, 0x08);
    sid.write(base + 6, 0xf8);
    sid.write(base + 4, fixture == 1 ? 0x17 : fixture == 4 ? 0x81 : 0x21);
  }
  sid.write(0x15, 7);
  sid.write(0x16, 0x60);
  sid.write(0x17, fixture == 2 ? 0xa7 : 0);
  sid.write(0x18, fixture == 2 ? 0x1f : 0x0f);
}

void events(SID& sid, int frame, int fixture) {
  if (fixture == 2 && frame % 997 == 0) sid.write(0x16, 40 + (frame / 997) % 160);
  if (fixture == 3 && frame % 127 == 0) sid.write(0x18, 7 + (frame / 127) % 9);
}

int main(int argc, char** argv) {
  try {
    require(argc == 3, "usage: probe output.pcm baseline|verify");
    const bool verify = std::string(argv[2]) == "verify";
    std::ofstream pcm(argv[1], std::ios::binary);
    require(bool(pcm), "cannot open output");
    const auto started = std::chrono::steady_clock::now();
    std::size_t checkedSamples = 0;
    std::size_t stateChecks = 0;
    std::size_t changed = 0;
    std::size_t sustainedZeroSamples = 0;
    std::size_t selectionChecks = 0;
    for (bool model8580 : {false, true}) {
      for (int fixture = 0; fixture < 5; fixture++) {
        for (unsigned targetMask : {7u, 1u, 2u, 3u, 4u, 5u, 6u}) {
          // Upstream WavGen::reset omits scalar wave state; zero-filled storage controls this native fixture, not WASM allocation reuse.
          alignas(SID) unsigned char referenceStorage[sizeof(SID)] = {};
          alignas(SID) unsigned char auditionStorage[sizeof(SID)] = {};
          alignas(SID) unsigned char expectedStorage[sizeof(SID)] = {};
          SID& reference = *new (referenceStorage) SID();
          SID& audition = *new (auditionStorage) SID();
          SID& expected = *new (expectedStorage) SID();
          configure(reference, model8580, fixture);
          configure(audition, model8580, fixture);
          configure(expected, model8580, fixture);
          for (int voice = 0; voice < 3; voice++) {
            if (targetMask & (1u << voice)) expected.write(voice * 7 + 4, 0x20);
          }
          std::size_t fixtureChanged = 0;
          for (int frame = 0; frame < rate * 2; frame++) {
            events(reference, frame, fixture);
            events(audition, frame, fixture);
            if (verify && frame == rate) mask(audition, targetMask);
            if (verify && frame == rate + rate / 4) mask(audition, 0);
            const short full = sample(reference);
            const short selected = sample(audition);
            const short independentlySelected = fixture == 0 ? sample(expected) : 0;
            pcm.write(reinterpret_cast<const char*>(&full), sizeof(full));
            require(reference.read(0x1b) == audition.read(0x1b), "OSC3 diverged during audition");
            require(reference.read(0x1c) == audition.read(0x1c), "ENV3 diverged during audition");
            stateChecks += 2;
            if (frame < rate || !verify) require(full == selected, "unity gains changed PCM");
            if (verify && frame >= rate && frame < rate + rate / 4 && selected != full) fixtureChanged++;
            if (verify && fixture == 0 && frame >= rate + ramp && frame < rate + rate / 4) {
              require(selected == independentlySelected, "selected voices differ from independent gate-off oracle");
              selectionChecks++;
            }
            if (verify && fixture == 0 && targetMask == 7 && frame >= rate + ramp && frame < rate + rate / 4) {
              require(selected == 0, "sustained voices did not mute without register writes");
              sustainedZeroSamples++;
            }
            if (verify && fixture != 2 && fixture != 3 && frame >= rate + rate / 4 + ramp) {
              require(full == selected, "unfiltered restoration lost oscillator/envelope history");
            }
            checkedSamples++;
          }
          if (verify) require(fixtureChanged > 1000, "voice selection did not change audible output");
          changed += fixtureChanged;
          reference.~SID();
          audition.~SID();
          expected.~SID();
        }
      }
    }
    pcm.close();
    require(bool(pcm), "PCM output stream failed");
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now()-started).count();
    std::cout << "{\"verified\":" << (verify ? "true" : "false")
      << ",\"frames\":" << checkedSamples << ",\"oscEnvChecks\":" << stateChecks
      << ",\"changedSamples\":" << changed << ",\"sustainedZeroSamples\":" << sustainedZeroSamples
      << ",\"selectionChecks\":" << selectionChecks
      << ",\"gainRampSamples\":" << ramp << ",\"gainRampMs\":" << ramp * 1000.0 / rate
      << ",\"elapsedMs\":" << ms << "}\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
