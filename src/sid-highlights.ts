import {fetchHvscSong, hvscSongUrl} from './hvsc-download.ts';

export interface SidHighlight {
  id: string;
  title: string;
  author: string;
  path: string;
  model: 'MOS6581' | 'MOS8580';
  chips: 1 | 2;
  subtune: number;
  durationSeconds: number;
}

export const SID_HIGHLIGHTS: readonly SidHighlight[] = [
  {id: 'wizball', title: 'Wizball', author: 'Martin Galway', path: 'MUSICIANS/G/Galway_Martin/Wizball.sid', model: 'MOS6581', chips: 1, subtune: 4, durationSeconds: 214.895},
  {id: 'last-ninja', title: 'The Last Ninja', author: 'Ben Daglish & Anthony Lees', path: 'MUSICIANS/D/Daglish_Ben/Last_Ninja.sid', model: 'MOS6581', chips: 1, subtune: 3, durationSeconds: 261},
  {id: 'sanxion', title: 'Sanxion', author: 'Rob Hubbard', path: 'MUSICIANS/H/Hubbard_Rob/Sanxion.sid', model: 'MOS6581', chips: 1, subtune: 1, durationSeconds: 334},
  {id: 'UpU3jayw', title: 'Commando', author: 'Rob Hubbard', path: 'MUSICIANS/H/Hubbard_Rob/Commando.sid', model: 'MOS6581', chips: 1, subtune: 1, durationSeconds: 235.594},
  {id: 'QfM49EtP', title: 'Cybernoid II', author: 'Jeroen Tel', path: 'MUSICIANS/T/Tel_Jeroen/Cybernoid_II.sid', model: 'MOS6581', chips: 1, subtune: 1, durationSeconds: 346},
  {id: 'UopzMIF-', title: 'Monty on the Run', author: 'Rob Hubbard', path: 'MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid', model: 'MOS6581', chips: 1, subtune: 1, durationSeconds: 350},
  {id: 'cybernoid', title: 'Cybernoid', author: 'Jeroen Tel', path: 'MUSICIANS/T/Tel_Jeroen/Cybernoid.sid', model: 'MOS6581', chips: 1, subtune: 1, durationSeconds: 400},
  {id: 'last-ninja-3', title: 'Last Ninja 3', author: 'Reyn Ouwehand', path: 'MUSICIANS/O/Ouwehand_Reyn/Last_Ninja_3.sid', model: 'MOS6581', chips: 1, subtune: 3, durationSeconds: 287},
  {id: 'last-ninja-2', title: 'Last Ninja 2', author: 'Matt Gray', path: 'MUSICIANS/G/Gray_Matt/Last_Ninja_2.sid', model: 'MOS6581', chips: 1, subtune: 1, durationSeconds: 267},
  {id: 'mutants', title: 'Mutants', author: 'Fred Gray', path: 'MUSICIANS/G/Gray_Fred/Mutants.sid', model: 'MOS6581', chips: 1, subtune: 1, durationSeconds: 250},
  {id: 'knucklebusters', title: 'Knucklebusters', author: 'Rob Hubbard', path: 'MUSICIANS/H/Hubbard_Rob/Knucklebusters.sid', model: 'MOS6581', chips: 1, subtune: 2, durationSeconds: 202},
  {id: 'crazy-comets', title: 'Crazy Comets', author: 'Rob Hubbard', path: 'MUSICIANS/H/Hubbard_Rob/Crazy_Comets.sid', model: 'MOS6581', chips: 1, subtune: 1, durationSeconds: 276},
  {id: 'ultimate-axel-f', title: 'Ultimate Axel F.', author: 'Benjamin Dibbert (Nordischsound)', path: 'MUSICIANS/N/Nordischsound/Ultimate_Axel_F.sid', model: 'MOS8580', chips: 1, subtune: 1, durationSeconds: 133.468},
  {id: 'XGpHOfuE', title: 'Ghostbusters', author: 'Benjamin Dibbert (Nordischsound)', path: 'MUSICIANS/N/Nordischsound/Ghostbusters.sid', model: 'MOS8580', chips: 1, subtune: 1, durationSeconds: 157.169},
  {id: 'GBRDw0sq', title: 'Sleepwalk', author: 'Lasse Öörni (Cadaver)', path: 'MUSICIANS/C/Cadaver/Sleepwalk_2SID.sid', model: 'MOS6581', chips: 2, subtune: 1, durationSeconds: 292},
  {id: 'LOKaOUbV', title: 'R-Type: Amiga to 2SID', author: 'Jason Page', path: 'MUSICIANS/P/Page_Jason/R-Type_Amiga_to_2SID_2SID.sid', model: 'MOS8580', chips: 2, subtune: 1, durationSeconds: 291.5},
  {id: '4D2HfMg6', title: 'Zoids 2SID-Remake', author: 'Sami Louko (Proton)', path: 'MUSICIANS/P/Proton/Zoids_2SID-Remake_2SID.sid', model: 'MOS8580', chips: 2, subtune: 1, durationSeconds: 283.455},
  {id: 'raindropsies-2sid', title: 'Raindropsies', author: 'Wojciech Radziejewski (Shogoon)', path: 'MUSICIANS/S/Shogoon/Raindropsies_2SID.sid', model: 'MOS8580', chips: 2, subtune: 1, durationSeconds: 179},
  {id: 'get-lucky-2sid', title: 'Get Lucky', author: 'Benjamin Dibbert (Nordischsound)', path: 'MUSICIANS/N/Nordischsound/Get_Lucky_2SID.sid', model: 'MOS8580', chips: 2, subtune: 1, durationSeconds: 199.184},
  {id: 'monty-on-the-run-d-n-b-edit-2sid', title: "Monty on the Run (D'n'B edit)", author: 'mch', path: 'MUSICIANS/M/MCH/Monty_on_the_Run_D_n_B_edit_2SID.sid', model: 'MOS8580', chips: 2, subtune: 1, durationSeconds: 254.128},
];

export function highlightUrl(entry: SidHighlight): string {
  return hvscSongUrl(entry);
}

function checkProfile(bytes: Uint8Array, entry: SidHighlight): void {
  if (bytes.byteLength < 124 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'PSID') {
    throw new Error('The highlight download is not a complete PSID header.');
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = header.getUint16(4);
  if (version < 2 || version > 4) throw new Error('The highlight requires a PSID version 2–4 header with explicit clock and model declarations.');
  if (header.getUint16(16) !== entry.subtune || header.getUint16(14) < entry.subtune) {
    throw new Error(`The highlight download does not declare the expected default subtune ${entry.subtune}.`);
  }
  const chips = version >= 3 && bytes[122] ? 2 : 1;
  if (bytes[123] || chips !== entry.chips) throw new Error(`The highlight download does not declare the expected ${entry.chips} SID chip${entry.chips === 1 ? '' : 's'}.`);
  const flags = header.getUint16(118);
  if (((flags >> 2) & 3) !== 1) throw new Error('The highlight download does not declare the expected PAL clock.');
  const modelBits = entry.model === 'MOS6581' ? 1 : 2;
  if (((flags >> 4) & 3) !== modelBits || entry.chips === 2 && ((flags >> 6) & 3) !== modelBits) {
    throw new Error(`The highlight download does not declare the expected ${entry.model} model for every chip.`);
  }
}

export async function fetchHighlight(entry: SidHighlight, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Uint8Array> {
  const bytes = await fetchHvscSong(entry, fetcher);
  checkProfile(bytes, entry);
  return bytes;
}
