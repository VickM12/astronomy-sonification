import { Injectable, computed, signal } from '@angular/core';
import { PLANET_IDS, PlanetId, isPlanetId } from '../domain/planets';
import { uniformScaleFactor } from '../sonification/frequency';
import {
  InstrumentId,
  ListenMode,
  MappingMode,
  PitchMotion,
  PitchSettings,
  PlanetMix,
  RegisterId,
  ScaleId,
  clampUnit,
  isInstrumentId,
  isRegisterId,
  isScaleId,
  registerBounds,
} from '../sonification/sound-model';

export interface SoundSnapshot {
  mode: ListenMode;
  mapping: MappingMode;
  register: RegisterId;
  motion: PitchMotion;
  modulationDepth: number;
  drones: boolean;
  pulses: boolean;
  alignments: boolean;
  masterGain: number;
  reverb: number;
  delay: number;
  scale: ScaleId;
  rootPitchClass: number;
  quantize: boolean;
  tempoBpm: number;
  beats: number;
  compressionSecondsPerDay: number;
  harmony: number;
  planets: Record<PlanetId, PlanetMix>;
}

@Injectable({ providedIn: 'root' })
export class SoundSettingsService {
  readonly mode = signal<ListenMode>('scientific');
  readonly mapping = signal<MappingMode>('octave-fold');
  readonly register = signal<RegisterId>('middle');
  readonly motion = signal<PitchMotion>('fixed');
  readonly modulationDepth = signal(0.65);
  readonly drones = signal(true);
  readonly pulses = signal(true);
  readonly alignments = signal(true);
  readonly masterGain = signal(0.6);
  readonly reverb = signal(0.18);
  readonly delay = signal(0.12);
  readonly scale = signal<ScaleId>('major');
  readonly rootPitchClass = signal(0);
  readonly quantize = signal(true);
  readonly tempoBpm = signal(72);
  readonly beats = signal(1);
  readonly compressionSecondsPerDay = signal(0.05);
  readonly harmony = signal(0.35);
  readonly planets = signal<Record<PlanetId, PlanetMix>>(defaultMixes());

  readonly snapshot = computed<SoundSnapshot>(() => ({
    mode: this.mode(),
    mapping: this.mapping(),
    register: this.register(),
    motion: this.motion(),
    modulationDepth: this.modulationDepth(),
    drones: this.drones(),
    pulses: this.pulses(),
    alignments: this.alignments(),
    masterGain: this.masterGain(),
    reverb: this.reverb(),
    delay: this.delay(),
    scale: this.scale(),
    rootPitchClass: this.rootPitchClass(),
    quantize: this.quantize(),
    tempoBpm: this.tempoBpm(),
    beats: this.beats(),
    compressionSecondsPerDay: this.compressionSecondsPerDay(),
    harmony: this.harmony(),
    planets: this.planets(),
  }));

  readonly pitchSettings = computed<PitchSettings>(() => {
    const bounds = registerBounds(this.register());
    return {
      mode: this.mode(),
      mapping: this.mapping(),
      uniformK: uniformScaleFactor(),
      registerLowHz: bounds.low,
      registerHighHz: bounds.high,
      motion: this.motion(),
      modulationDepth: this.modulationDepth(),
      scale: this.scale(),
      rootPitchClass: this.rootPitchClass(),
      quantize: this.quantize(),
      harmony: this.harmony(),
    };
  });

  readonly mappingSummary = computed(() => {
    if (this.mapping() === 'uniform') {
      return 'One factor K places Earth at 110 Hz and keeps every orbital ratio. Outer planets can sit below hearing.';
    }
    const bounds = registerBounds(this.register());
    return `Each planet is moved by whole octaves into ${bounds.low}–${bounds.high} Hz. That changes the ratios between planets.`;
  });

  mixFor(id: string): PlanetMix {
    if (!isPlanetId(id)) {
      return { gain: 0, muted: true, solo: false, instrument: 'sine' };
    }
    return this.planets()[id];
  }

  setMode(value: string): void {
    if (value === 'scientific' || value === 'musical') {
      this.mode.set(value);
    }
  }

  setMapping(value: string): void {
    if (value === 'uniform' || value === 'octave-fold') {
      this.mapping.set(value);
    }
  }

  setRegister(value: string): void {
    if (isRegisterId(value)) {
      this.register.set(value);
    }
  }

  setMotion(enabled: boolean): void {
    this.motion.set(enabled ? 'velocity' : 'fixed');
  }

  setDepth(value: number): void {
    this.modulationDepth.set(clampUnit(value));
  }

  setMaster(value: number): void {
    this.masterGain.set(clampUnit(value));
  }

  setReverb(value: number): void {
    this.reverb.set(clampUnit(value));
  }

  setDelay(value: number): void {
    this.delay.set(clampUnit(value));
  }

  setScale(value: string): void {
    if (isScaleId(value)) {
      this.scale.set(value);
    }
  }

  setRoot(value: number): void {
    if (Number.isInteger(value) && value >= 0 && value <= 11) {
      this.rootPitchClass.set(value);
    }
  }

  setTempo(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.tempoBpm.set(Math.min(240, Math.max(24, value)));
  }

  setBeats(value: number): void {
    if (value === 1 || value === 0.5 || value === 0.25) {
      this.beats.set(value);
    }
  }

  setCompression(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.compressionSecondsPerDay.set(Math.min(1, Math.max(0.01, value)));
  }

  setHarmony(value: number): void {
    this.harmony.set(clampUnit(value));
  }

  setGain(id: string, value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.patchMix(id, { gain: clampUnit(value) });
  }

  setMuted(id: string, muted: boolean): void {
    this.patchMix(id, { muted });
  }

  setSolo(id: string, solo: boolean): void {
    this.patchMix(id, { solo });
  }

  setInstrument(id: string, value: string): void {
    if (isInstrumentId(value)) {
      this.patchMix(id, { instrument: value });
    }
  }

  /** Restore a previously saved block. Unknown fields keep the current defaults. */
  apply(value: unknown): void {
    if (typeof value !== 'object' || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record['mode'] === 'string') {
      this.setMode(record['mode']);
    }
    if (typeof record['mapping'] === 'string') {
      this.setMapping(record['mapping']);
    }
    if (typeof record['register'] === 'string') {
      this.setRegister(record['register']);
    }
    if (record['motion'] === 'velocity' || record['motion'] === 'fixed') {
      this.motion.set(record['motion']);
    }
    this.assignNumber(record['modulationDepth'], (depth) => this.setDepth(depth));
    this.assignBoolean(record['drones'], this.drones);
    this.assignBoolean(record['pulses'], this.pulses);
    this.assignBoolean(record['alignments'], this.alignments);
    this.assignNumber(record['masterGain'], (gain) => this.setMaster(gain));
    this.assignNumber(record['reverb'], (amount) => this.setReverb(amount));
    this.assignNumber(record['delay'], (amount) => this.setDelay(amount));
    if (typeof record['scale'] === 'string') {
      this.setScale(record['scale']);
    }
    this.assignNumber(record['rootPitchClass'], (pitch) => this.setRoot(pitch));
    this.assignBoolean(record['quantize'], this.quantize);
    this.assignNumber(record['tempoBpm'], (tempo) => this.setTempo(tempo));
    this.assignNumber(record['beats'], (beats) => this.setBeats(beats));
    this.assignNumber(record['compressionSecondsPerDay'], (compression) =>
      this.setCompression(compression),
    );
    this.assignNumber(record['harmony'], (amount) => this.setHarmony(amount));
    if (typeof record['planets'] === 'object' && record['planets'] !== null) {
      const stored = record['planets'] as Record<string, unknown>;
      const next = defaultMixes();
      for (const id of PLANET_IDS) {
        next[id] = mixFrom(stored[id], next[id]);
      }
      this.planets.set(next);
    }
  }

  private patchMix(id: string, patch: Partial<PlanetMix>): void {
    if (!isPlanetId(id)) {
      return;
    }
    this.planets.update((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }

  private assignNumber(value: unknown, apply: (value: number) => void): void {
    if (typeof value === 'number' && Number.isFinite(value)) {
      apply(value);
    }
  }

  private assignBoolean(
    value: unknown,
    target: { set(value: boolean): void },
  ): void {
    if (typeof value === 'boolean') {
      target.set(value);
    }
  }
}

export function defaultMixes(): Record<PlanetId, PlanetMix> {
  const mixes = {} as Record<PlanetId, PlanetMix>;
  for (const id of PLANET_IDS) {
    mixes[id] = { gain: 0.8, muted: false, solo: false, instrument: 'sine' };
  }
  return mixes;
}

function mixFrom(value: unknown, fallback: PlanetMix): PlanetMix {
  if (typeof value !== 'object' || value === null) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  return {
    gain:
      typeof record['gain'] === 'number' && Number.isFinite(record['gain'])
        ? clampUnit(record['gain'])
        : fallback.gain,
    muted: typeof record['muted'] === 'boolean' ? record['muted'] : fallback.muted,
    solo: typeof record['solo'] === 'boolean' ? record['solo'] : fallback.solo,
    instrument:
      typeof record['instrument'] === 'string' && isInstrumentId(record['instrument'])
        ? record['instrument']
        : fallback.instrument,
  };
}
