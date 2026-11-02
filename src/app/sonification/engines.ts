import { PlanetaryState } from '../domain/planetary-state';
import { SonificationEngine, SonificationEvent } from '../domain/sonification';
import { readPitches } from './pitch';
import { PitchSettings } from './sound-model';

/** Continuous scientific pitches. Pulses are scheduled separately from orbital events. */
export class ScientificSonificationEngine implements SonificationEngine {
  constructor(private readonly settings: PitchSettings) {}

  process(states: PlanetaryState[], simulationTime: Date): SonificationEvent[] {
    return voices(states, { ...this.settings, mode: 'scientific' }, simulationTime);
  }
}

/** Continuous musical pitches. Quantization and octave spacing stay inside the pitch math. */
export class MusicalSonificationEngine implements SonificationEngine {
  constructor(private readonly settings: PitchSettings) {}

  process(states: PlanetaryState[], simulationTime: Date): SonificationEvent[] {
    return voices(states, { ...this.settings, mode: 'musical' }, simulationTime);
  }
}

function voices(
  states: readonly PlanetaryState[],
  settings: PitchSettings,
  simulationTime: Date,
): SonificationEvent[] {
  return readPitches(states, settings).map((reading) => ({
    planetId: reading.planetId,
    simulationTime,
    frequencyHz: reading.audibleFrequencyHz,
    velocity: reading.angularSpeedRadPerDay,
    durationSeconds: 0,
    eventType: 'continuous',
  }));
}
