export interface VoiceMix {
  readonly muted: readonly boolean[];
  readonly enabledChips: readonly boolean[];
}

export type VoiceMixAction =
  | {type: 'mute' | 'solo'; voice: number}
  | {type: 'chip'; chip: number}
  | {type: 'restore'};

function requireIndex(index: number, count: number, kind: 'voice' | 'chip'): void {
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new RangeError(`Invalid ${kind} index: ${index}.`);
}

export function createVoiceMix(chips: 1 | 2): VoiceMix {
  if (chips !== 1 && chips !== 2) throw new RangeError('A voice mix requires one or two SID chips.');
  return {muted: Array<boolean>(chips * 3).fill(false), enabledChips: Array<boolean>(chips).fill(true)};
}

export function voiceMixMask(mix: VoiceMix): boolean[] {
  return mix.muted.map((muted, voice) => muted || !mix.enabledChips[Math.floor(voice / 3)]);
}

export function voiceIsSolo(mix: VoiceMix, voice: number): boolean {
  requireIndex(voice, mix.muted.length, 'voice');
  return mix.enabledChips[Math.floor(voice / 3)] && mix.muted.every((muted, index) => muted === (index !== voice));
}

export function updateVoiceMix(mix: VoiceMix, action: VoiceMixAction): VoiceMix {
  let muted = [...mix.muted];
  const enabledChips = [...mix.enabledChips];
  switch (action.type) {
    case 'mute':
      requireIndex(action.voice, muted.length, 'voice');
      muted[action.voice] = !muted[action.voice];
      break;
    case 'solo': {
      const active = voiceIsSolo(mix, action.voice);
      muted = muted.map((_, voice) => !active && voice !== action.voice);
      enabledChips[Math.floor(action.voice / 3)] = true;
      break;
    }
    case 'chip':
      requireIndex(action.chip, enabledChips.length, 'chip');
      enabledChips[action.chip] = !enabledChips[action.chip];
      break;
    case 'restore':
      muted.fill(false);
      enabledChips.fill(true);
      break;
  }
  return {muted, enabledChips};
}
