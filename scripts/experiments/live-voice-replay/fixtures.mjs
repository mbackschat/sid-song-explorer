export function syntheticSid({model, clock, kind, chips = 1, voiceMask = (1 << (chips * 3)) - 1}) {
  const load = 0x1000;
  const play = 0x1300;
  const bytes = new Uint8Array(124 + 1024);
  bytes.set([0x50, 0x53, 0x49, 0x44]);
  const header = new DataView(bytes.buffer);
  for (const [offset, value] of [[4, chips === 2 ? 3 : 2], [6, 124], [8, load], [10, load], [12, play], [14, 1], [16, 1]]) {
    header.setUint16(offset, value);
  }
  const modelBits = model === 'MOS6581' ? 1 : 2;
  header.setUint16(118, (clock === 'PAL' ? 4 : 8) | modelBits << 4 | (chips === 2 ? modelBits << 6 : 0));
  bytes[122] = chips === 2 ? 0x42 : 0;
  const init = [0xa9, 0, 0x85, 2];
  const tick = [0xe6, 2];
  const write = (program, address, value) => program.push(0xa9, value, 0x8d, address & 255, address >> 8);
  const storeCounter = (address, mask = 255, bits = 0) => {
    tick.push(0xa5, 2, 0x29, mask, 0x09, bits, 0x8d, address & 255, address >> 8);
  };
  for (let chip = 0; chip < chips; chip++) {
    const base = 0xd400 + chip * 0x20;
    for (let voice = 0; voice < 3; voice++) {
      const address = base + voice * 7;
      const frequency = 3000 + voice * 1700 + chip * 2333;
      const waveform = (kind === 'ring-sync' ? 0x17 : kind === 'noise' ? 0x81 : 0x21) &
        (voiceMask & (1 << (chip * 3 + voice)) ? 255 : 254);
      for (const [offset, value] of [[0, frequency & 255], [1, frequency >> 8], [2, 0], [3, 8], [5, 8], [6, 0xf8], [4, waveform]]) {
        write(init, address + offset, value);
      }
    }
    write(init, base + 0x15, 7);
    write(init, base + 0x16, 0x60 + chip * 16);
    write(init, base + 0x17, kind === 'filter' ? 0xa7 : 0);
    write(init, base + 0x18, kind === 'filter' ? 0x1f : 0x0f);
    if (kind === 'filter') storeCounter(base + 0x16, 127, 32);
    if (kind === 'd418') storeCounter(base + 0x18, 15);
  }
  init.push(0x60);
  tick.push(0x60);
  if (init.length >= play - load) throw new Error('Synthetic init overlaps its play routine');
  bytes.set(init, 124);
  bytes.set(tick, 124 + play - load);
  return bytes;
}
