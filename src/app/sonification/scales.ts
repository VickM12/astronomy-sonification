import { ScaleId } from './sound-model';

const SCALE_DEGREES: Record<Exclude<ScaleId, 'chromatic'>, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  'natural-minor': [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export interface QuantizedPitch {
  frequencyHz: number;
  midi: number;
}

export function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function noteName(midi: number): string {
  const rounded = Math.round(midi);
  const pitchClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[pitchClass]}${octave}`;
}

/**
 * Snap to the nearest scale tone. An equal distance resolves to the lower note.
 * Chromatic rounding uses the nearest integer MIDI note.
 */
export function quantizeFrequency(
  frequencyHz: number,
  scale: ScaleId,
  rootPitchClass: number,
): QuantizedPitch {
  const midi = nearestScaleMidi(frequencyToMidi(frequencyHz), scale, rootPitchClass);
  return { frequencyHz: midiToFrequency(midi), midi };
}

export function nearestScaleMidi(midi: number, scale: ScaleId, rootPitchClass: number): number {
  if (scale === 'chromatic') {
    return Math.round(midi);
  }
  const degrees = SCALE_DEGREES[scale];
  const root = ((rootPitchClass % 12) + 12) % 12;
  let best = Math.round(midi);
  let bestDistance = Number.POSITIVE_INFINITY;
  const start = Math.floor(midi) - 12;
  const end = Math.ceil(midi) + 12;
  for (let candidate = start; candidate <= end; candidate += 1) {
    const pitchClass = ((candidate % 12) + 12) % 12;
    const degree = (pitchClass - root + 12) % 12;
    if (!degrees.includes(degree)) {
      continue;
    }
    const distance = Math.abs(candidate - midi);
    if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Move later voices up by octaves until neighboring pitches are at least
 * `1 + round(intensity × 4)` semitones apart. Intensity 0 leaves the list unchanged.
 * The same inputs always produce the same octaves.
 */
export function separateOctaves(frequencies: readonly number[], intensity: number): number[] {
  const result = frequencies.slice();
  if (!(intensity > 0)) {
    return result;
  }
  const minSemitones = 1 + Math.round(Math.min(1, intensity) * 4);
  for (let index = 1; index < result.length; index += 1) {
    for (let guard = 0; guard < 4; guard += 1) {
      let clash = false;
      for (let earlier = 0; earlier < index; earlier += 1) {
        if (semitoneGap(result[index] ?? 0, result[earlier] ?? 0) < minSemitones) {
          clash = true;
          break;
        }
      }
      if (!clash) {
        break;
      }
      result[index] = (result[index] ?? 0) * 2;
    }
  }
  return result;
}

function semitoneGap(left: number, right: number): number {
  if (!(left > 0) || !(right > 0)) {
    return 0;
  }
  return Math.abs(12 * Math.log2(left / right));
}
