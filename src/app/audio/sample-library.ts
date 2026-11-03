import { InstrumentId } from '../sonification/sound-model';

/**
 * Recorded instrument samples. Source: the tonejs-instruments sample set by
 * N. P. Brosowsky (https://github.com/nbrosowsky/tonejs-instruments), samples
 * licensed CC BY 3.0, served from the jsDelivr CDN with open CORS headers.
 * Each entry lists the recorded notes we fetch; the sampler pitch-shifts the
 * nearest recording to the planet's frequency.
 */
export const SAMPLE_BASE_URL =
  'https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments@master/samples/';

export const SAMPLE_ATTRIBUTION =
  'Instrument recordings: tonejs-instruments by N. P. Brosowsky, CC BY 3.0.';

export interface SampledInstrument {
  folder: string;
  notes: readonly string[];
  /** Seconds for the tail after a note is released. */
  release: number;
  /** Seconds one bow or breath lasts before a sustained note is re-struck. */
  bowSeconds: number;
}

export const SAMPLED_INSTRUMENTS: Partial<Record<InstrumentId, SampledInstrument>> = {
  strings: {
    folder: 'violin',
    notes: ['A3', 'C4', 'E4', 'G4', 'C5', 'E5', 'A5', 'C6', 'E6', 'A6'],
    release: 0.5,
    bowSeconds: 3.2,
  },
  cello: {
    folder: 'cello',
    notes: ['C2', 'F2', 'A2', 'D3', 'G3', 'C4', 'F4', 'A4', 'C5'],
    release: 0.5,
    bowSeconds: 3.2,
  },
  flute: {
    folder: 'flute',
    notes: ['C4', 'E4', 'C5', 'E5', 'A5', 'C6', 'E6', 'A6', 'C7'],
    release: 0.3,
    bowSeconds: 2.6,
  },
  bassoon: {
    folder: 'bassoon',
    notes: ['A2', 'C3', 'G3', 'A3', 'C4', 'E4', 'G4', 'A4', 'C5'],
    release: 0.3,
    bowSeconds: 2.8,
  },
  clarinet: {
    folder: 'clarinet',
    notes: ['D3', 'F3', 'A#3', 'D4', 'F4', 'A#4', 'D5', 'F5', 'A#5', 'D6'],
    release: 0.3,
    bowSeconds: 2.8,
  },
  horn: {
    folder: 'french-horn',
    notes: ['A1', 'C2', 'D#2', 'D3', 'F3', 'A3', 'C4', 'D5', 'F5'],
    release: 0.4,
    bowSeconds: 2.8,
  },
  trumpet: {
    folder: 'trumpet',
    notes: ['F3', 'A3', 'C4', 'D#4', 'F4', 'G4', 'A#4', 'D5', 'F5', 'A5', 'C6'],
    release: 0.3,
    bowSeconds: 2.4,
  },
  harp: {
    folder: 'harp',
    notes: ['G1', 'D2', 'A2', 'G3', 'B3', 'F4', 'C5', 'G5', 'D6', 'A6', 'F7'],
    release: 1.6,
    bowSeconds: 2.2,
  },
  piano: {
    folder: 'piano',
    notes: [
      'A1',
      'C2',
      'E2',
      'A2',
      'C3',
      'E3',
      'A3',
      'C4',
      'E4',
      'A4',
      'C5',
      'E5',
      'A5',
      'C6',
      'E6',
      'A6',
      'C7',
    ],
    release: 0.9,
    bowSeconds: 2.6,
  },
};

export function isSampledInstrument(instrument: InstrumentId): boolean {
  return instrument in SAMPLED_INSTRUMENTS;
}

/** Map of note name → file name in the sample folder ("D#4" is stored as "Ds4.mp3"). */
export function sampleUrls(instrument: SampledInstrument): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const note of instrument.notes) {
    urls[note] = `${note.replace('#', 's')}.mp3`;
  }
  return urls;
}
