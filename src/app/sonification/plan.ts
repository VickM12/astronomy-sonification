import { OrbitalEvent } from '../domain/orbital-event';
import { PlanetaryState } from '../domain/planetary-state';
import { isMoonId } from '../domain/moons';
import { PlanetId, isPlanetId } from '../domain/planets';
import { readPitches } from './pitch';
import { InstrumentId, ListenMode, PitchSettings, PlanetMix } from './sound-model';
import { continuousParameters } from './continuous-mapping';

export interface DroneInstruction {
  planetId: string;
  frequencyHz: number;
  gain: number;
  instrument: InstrumentId;
  filterHz: number;
  resonance: number;
  pan: number;
  angularRatio: number;
  detuneCents: number;
}

export interface PulseInstruction {
  planetId: string;
  frequencyHz: number;
  gain: number;
  durationSeconds: number;
  when: number;
  instrument: InstrumentId;
  eventType?: OrbitalEvent['type'];
  eventTimeIso?: string;
  eventBodyIds?: readonly string[];
}

export interface AudioPlan {
  masterGain: number;
  reverb: number;
  delay: number;
  drones: DroneInstruction[];
  pulses: PulseInstruction[];
}

export interface PlanInput {
  states: readonly PlanetaryState[];
  pitch: PitchSettings;
  mixes: Readonly<Record<PlanetId, PlanetMix> & Record<string, PlanetMix | undefined>>;
  events: readonly OrbitalEvent[];
  /** Bodies left out of the picture. They are silent, and so are alignments with them. */
  hiddenIds?: readonly string[];
  previousTime: Date | null;
  time: Date;
  simulatedDays: number;
  compressionSecondsPerDay: number;
  audioNow: number;
  playing: boolean;
  dronesEnabled: boolean;
  pulsesEnabled: boolean;
  alignmentsEnabled: boolean;
  eventEnabled?: boolean;
  relationshipAmount?: number;
  tempoBpm: number;
  beats: number;
  masterGain: number;
  reverb: number;
  delay: number;
}

const DRONE_LEVEL = 0.16;
const PULSE_LEVEL = 0.34;
const MAX_PULSES = 24;
const BEAT_LENGTHS = [1, 0.5, 0.25];

/** How long a crossing rings. This is the musical tempo, not the simulation speed. */
export function noteDurationSeconds(tempoBpm: number, beats: number): number {
  const bpm = Math.min(240, Math.max(24, tempoBpm));
  const length = BEAT_LENGTHS.includes(beats) ? beats : 1;
  return (60 / bpm) * length;
}

/**
 * Place a crossing on the audio clock.
 * `fraction` is where the longitude crossed inside the simulation step.
 * The span is `|simulated days| × audio seconds per day`.
 * Simulation speed is not an input.
 */
export function eventAudioTime(
  eventMs: number,
  previousMs: number | null,
  nextMs: number,
  simulatedDays: number,
  compressionSecondsPerDay: number,
  audioNow: number,
): number {
  if (previousMs === null || !(compressionSecondsPerDay > 0) || simulatedDays === 0) {
    return audioNow;
  }
  const span = nextMs - previousMs;
  const fraction = span === 0 ? 0 : (eventMs - previousMs) / span;
  const clamped = Math.min(1, Math.max(0, fraction));
  return audioNow + clamped * Math.abs(simulatedDays) * compressionSecondsPerDay;
}

export function heardFrequency(
  frequencyHz: number,
  mode: ListenMode,
  instrument: InstrumentId,
): number {
  if (mode !== 'musical') {
    return frequencyHz;
  }
  if (instrument === 'bass' || instrument === 'cello') {
    return frequencyHz / 2;
  }
  if (instrument === 'bell') {
    return frequencyHz * 2;
  }
  return frequencyHz;
}

export function buildAudioPlan(input: PlanInput): AudioPlan {
  const readings = readPitches(input.states, input.pitch);
  const continuousReadings = readPitches(input.states, { ...input.pitch, motion: 'fixed' });
  const hidden = new Set(input.hiddenIds ?? []);
  const anySolo = Object.values(input.mixes).some((mix) => mix?.solo);
  const duration = noteDurationSeconds(input.tempoBpm, input.beats);
  const drones: DroneInstruction[] = [];

  if (input.playing && input.dronesEnabled) {
    const soundingIds = new Set(
      continuousReadings
        .filter((reading) => {
          const mix = input.mixes[reading.planetId];
          return !hidden.has(reading.planetId) && !!mix && mixGain(mix, anySolo) > 0;
        })
        .map((reading) => reading.planetId),
    );
    const parameters = new Map(
      continuousParameters(
        input.states,
        soundingIds,
        input.pitch.modulationDepth,
        input.relationshipAmount ?? 0.35,
      ).map((item) => [item.id, item]),
    );
    for (const reading of continuousReadings) {
      if (!isPlanetId(reading.planetId) && !isMoonId(reading.planetId)) {
        continue;
      }
      if (hidden.has(reading.planetId)) {
        continue;
      }
      const mix = input.mixes[reading.planetId];
      if (!mix) {
        continue;
      }
      const instrument = input.pitch.mode === 'musical' ? mix.instrument : 'sine';
      const evolving = parameters.get(reading.planetId) ?? {
        frequencyMultiplier: 1,
        gainMultiplier: 1,
        filterHz: 7000,
        resonance: 0.7,
        pan: 0,
        angularRatio: 1,
        detuneCents: 0,
      };
      drones.push({
        planetId: reading.planetId,
        frequencyHz:
          heardFrequency(reading.audibleFrequencyHz, input.pitch.mode, instrument) *
          evolving.frequencyMultiplier,
        gain: mixGain(mix, anySolo) * DRONE_LEVEL * evolving.gainMultiplier,
        instrument,
        filterHz: evolving.filterHz,
        resonance: evolving.resonance,
        pan: evolving.pan,
        angularRatio: evolving.angularRatio,
        detuneCents: evolving.detuneCents,
      });
    }
  }

  const pulses: PulseInstruction[] = [];
  const ordered = input.eventEnabled === false ? [] : [...input.events].sort(compareEvents);
  for (const event of ordered) {
    if (pulses.length >= MAX_PULSES) {
      break;
    }
    const alignment = event.type === 'conjunction' || event.type === 'opposition';
    // A Galilean moon completes an orbit in a couple of days. At playback speed
    // those crossings would schedule hundreds of notes a second and exhaust the
    // audio graph. The moons stay in the drone chord; only planets are pulsed.
    if (isMoonId(event.planetId)) {
      continue;
    }
    if (alignment && !input.alignmentsEnabled) {
      continue;
    }
    if (!alignment && !input.pulsesEnabled) {
      continue;
    }
    const ids = [event.planetId, event.otherPlanetId].filter((id): id is string => !!id);
    if (ids.some((id) => hidden.has(id))) {
      continue;
    }
    for (const id of ids) {
      if (pulses.length >= MAX_PULSES || (!isPlanetId(id) && !isMoonId(id))) {
        continue;
      }
      const reading = readings.find((item) => item.planetId === id);
      const mix = input.mixes[id];
      if (!reading || !mix) {
        continue;
      }
      const gain = mixGain(mix, anySolo);
      if (gain <= 0) {
        continue;
      }
      const instrument = input.pitch.mode === 'musical' ? mix.instrument : 'sine';
      pulses.push({
        planetId: id,
        frequencyHz: heardFrequency(reading.audibleFrequencyHz, input.pitch.mode, instrument),
        gain: gain * (alignment ? PULSE_LEVEL * 1.25 : PULSE_LEVEL),
        durationSeconds: alignment ? duration * 1.6 : duration,
        when: eventAudioTime(
          event.simulationTime.getTime(),
          input.previousTime?.getTime() ?? null,
          input.time.getTime(),
          input.simulatedDays,
          input.compressionSecondsPerDay,
          input.audioNow,
        ),
        instrument,
        eventType: event.type,
        eventTimeIso: event.simulationTime.toISOString(),
        eventBodyIds: ids,
      });
    }
  }

  return {
    masterGain: input.masterGain,
    reverb: input.reverb,
    delay: input.delay,
    drones,
    pulses,
  };
}

function mixGain(mix: PlanetMix, anySolo: boolean): number {
  if (mix.muted || (anySolo && !mix.solo)) {
    return 0;
  }
  return Math.min(1, Math.max(0, mix.gain));
}

function compareEvents(left: OrbitalEvent, right: OrbitalEvent): number {
  const time = left.simulationTime.getTime() - right.simulationTime.getTime();
  if (time !== 0) {
    return time;
  }
  if (left.type !== right.type) {
    return left.type < right.type ? -1 : 1;
  }
  if (left.planetId !== right.planetId) {
    return left.planetId < right.planetId ? -1 : 1;
  }
  return (left.otherPlanetId ?? '').localeCompare(right.otherPlanetId ?? '');
}
