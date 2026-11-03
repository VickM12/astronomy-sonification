import { uniformScaleFactor } from './frequency';

export type ListenMode = 'scientific' | 'musical';
export type PlaybackTexture = 'event' | 'continuous' | 'hybrid';
export type MappingMode = 'uniform' | 'octave-fold';
export type PitchMotion = 'fixed' | 'velocity';
export type ScaleId = 'chromatic' | 'major' | 'natural-minor' | 'pentatonic';
export type InstrumentId =
  | 'sine'
  | 'pad'
  | 'bell'
  | 'pluck'
  | 'bass'
  | 'strings'
  | 'cello'
  | 'flute'
  | 'bassoon'
  | 'clarinet'
  | 'horn'
  | 'trumpet'
  | 'harp'
  | 'piano';
export type RegisterId = 'low' | 'middle' | 'high';

export interface PitchSettings {
  mode: ListenMode;
  mapping: MappingMode;
  uniformK: number;
  registerLowHz: number;
  registerHighHz: number;
  motion: PitchMotion;
  modulationDepth: number;
  scale: ScaleId;
  rootPitchClass: number;
  quantize: boolean;
  harmony: number;
}

export interface PlanetMix {
  gain: number;
  muted: boolean;
  solo: boolean;
  instrument: InstrumentId;
}

export const REGISTERS = [
  { id: 'low', low: 55, high: 110, label: '55–110 Hz' },
  { id: 'middle', low: 110, high: 220, label: '110–220 Hz' },
  { id: 'high', low: 220, high: 440, label: '220–440 Hz' },
] as const;

export const SCALES = [
  { id: 'chromatic', label: 'Chromatic' },
  { id: 'major', label: 'Major' },
  { id: 'natural-minor', label: 'Natural minor' },
  { id: 'pentatonic', label: 'Pentatonic' },
] as const;

export const INSTRUMENTS = [
  { id: 'sine', label: 'Sine' },
  { id: 'pad', label: 'Warm pad' },
  { id: 'bell', label: 'Bell' },
  { id: 'pluck', label: 'Pluck' },
  { id: 'bass', label: 'Deep bass' },
  { id: 'strings', label: 'Strings' },
  { id: 'cello', label: 'Cello' },
  { id: 'flute', label: 'Flute' },
  { id: 'bassoon', label: 'Bassoon' },
  { id: 'clarinet', label: 'Clarinet' },
  { id: 'horn', label: 'French horn' },
  { id: 'trumpet', label: 'Trumpet' },
  { id: 'harp', label: 'Harp' },
  { id: 'piano', label: 'Piano' },
] as const;

export const ROOTS = [
  { pitchClass: 0, label: 'C' },
  { pitchClass: 1, label: 'C#' },
  { pitchClass: 2, label: 'D' },
  { pitchClass: 3, label: 'D#' },
  { pitchClass: 4, label: 'E' },
  { pitchClass: 5, label: 'F' },
  { pitchClass: 6, label: 'F#' },
  { pitchClass: 7, label: 'G' },
  { pitchClass: 8, label: 'G#' },
  { pitchClass: 9, label: 'A' },
  { pitchClass: 10, label: 'A#' },
  { pitchClass: 11, label: 'B' },
] as const;

export const BEATS = [
  { value: 1, label: '1 beat' },
  { value: 0.5, label: '1/2 beat' },
  { value: 0.25, label: '1/4 beat' },
] as const;

export const PLAYBACK_TEXTURES = [
  { id: 'event', label: 'Event' },
  { id: 'continuous', label: 'Continuous' },
  { id: 'hybrid', label: 'Hybrid' },
] as const;

const INSTRUMENT_IDS: readonly InstrumentId[] = INSTRUMENTS.map((item) => item.id);
const SCALE_IDS: readonly ScaleId[] = SCALES.map((item) => item.id);

export function defaultPitchSettings(): PitchSettings {
  const register = registerBounds('middle');
  return {
    mode: 'scientific',
    mapping: 'octave-fold',
    uniformK: uniformScaleFactor(),
    registerLowHz: register.low,
    registerHighHz: register.high,
    motion: 'fixed',
    modulationDepth: 0.65,
    scale: 'major',
    rootPitchClass: 0,
    quantize: true,
    harmony: 0.35,
  };
}

export function registerBounds(id: RegisterId): { low: number; high: number } {
  const found = REGISTERS.find((item) => item.id === id);
  return found ? { low: found.low, high: found.high } : { low: 110, high: 220 };
}

export function isRegisterId(value: string): value is RegisterId {
  return REGISTERS.some((item) => item.id === value);
}

export function isScaleId(value: string): value is ScaleId {
  return SCALE_IDS.includes(value as ScaleId);
}

export function isInstrumentId(value: string): value is InstrumentId {
  return INSTRUMENT_IDS.includes(value as InstrumentId);
}

export function isPlaybackTexture(value: string): value is PlaybackTexture {
  return value === 'event' || value === 'continuous' || value === 'hybrid';
}

export function instrumentLabel(instrument: InstrumentId): string {
  return INSTRUMENTS.find((item) => item.id === instrument)?.label ?? instrument;
}

export function scaleLabel(scale: ScaleId): string {
  return SCALES.find((item) => item.id === scale)?.label ?? scale;
}

export function rootLabel(pitchClass: number): string {
  return ROOTS.find((item) => item.pitchClass === pitchClass)?.label ?? 'C';
}

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
