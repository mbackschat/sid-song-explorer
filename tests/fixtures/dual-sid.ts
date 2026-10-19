export function dualSid(model: 'MOS6581' | 'MOS8580', activeChip?: number): Uint8Array {
  const bytes = new Uint8Array(124 + 256);
  bytes.set([80, 83, 73, 68]);
  const header = new DataView(bytes.buffer);
  for (const [offset, value] of [[4, 3], [6, 124], [8, 0x1000], [10, 0x1000], [12, 0x10e0], [14, 1], [16, 1]]) header.setUint16(offset, value);
  const modelBits = model === 'MOS6581' ? 1 : 2;
  header.setUint16(118, 4 | modelBits << 4 | modelBits << 6);
  bytes[122] = 0x42;
  const init: number[] = [];
  const play: number[] = [];
  for (let chip = 0; chip < 2; chip++) {
    if (activeChip !== undefined && chip !== activeChip) continue;
    const base = 0xd400 + chip * 32;
    for (let voice = 0; voice < 3; voice++) {
      for (const [register, value] of [[0, 0x34 + voice * 10], [1, 0x12 + chip * 7 + voice], [5, 0], [6, 0xf0], [4, 0x21]]) {
        const address = base + voice * 7 + register;
        init.push(0xa9, value, 0x8d, address & 255, address >> 8);
      }
    }
    init.push(0xa9, 15, 0x8d, (base + 24) & 255, base >> 8);
    play.push(0xee, base & 255, base >> 8);
  }
  init.push(0x60);
  play.push(0x60);
  bytes.set(init, 124);
  bytes.set(play, 124 + 0xe0);
  return bytes;
}

export function monoSid(model: 'MOS6581' | 'MOS8580', activeChip: number, idle = false): Uint8Array {
  const bytes = dualSid(model, activeChip);
  new DataView(bytes.buffer).setUint16(4, 2);
  bytes[122] = 0;
  // Relocating SID operands preserves the diagnostic program's instruction timing.
  for (let offset = 124; offset < bytes.length - 2; offset++) {
    if ((bytes[offset] === 0x8d || bytes[offset] === 0xee) && bytes[offset + 2] === 0xd4) bytes[offset + 1] -= activeChip * 32;
  }
  if (idle) {
    // The native routing gate establishes SIDLite's idle DC; zero PCM is not its silence oracle.
    for (let offset = 124; offset < bytes.length - 4; offset++) {
      if (bytes[offset] === 0xa9 && bytes[offset + 2] === 0x8d && bytes[offset + 4] === 0xd4 &&
        [4, 11, 18].includes(bytes[offset + 3])) bytes[offset + 1] = 0;
    }
  }
  return bytes;
}
