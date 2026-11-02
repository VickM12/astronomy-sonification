import { PlanetaryState } from '../domain/planetary-state';
import {
  angularSpeedRadPerDay,
  foldIntoRegister,
  formatHz,
  meanMotionRadPerDay,
  orbitalFrequencyHz,
  uniformScale,
  velocityModulatedFrequency,
} from './frequency';
import { frequencyToMidi, midiToFrequency, noteName, quantizeFrequency, separateOctaves } from './scales';
import { PitchSettings, rootLabel, scaleLabel } from './sound-model';

/**
 * Musical voicing. The pitch class still comes from the orbit.
 * The octave is fixed so outer planets sit lower and inner planets sit higher,
 * instead of all eight notes crowding one register.
 */
export const MUSICAL_VOICE_OCTAVE: Readonly<Record<string, number>> = {
  neptune: 2,
  uranus: 3,
  saturn: 3,
  jupiter: 4,
  mars: 4,
  earth: 5,
  venus: 5,
  mercury: 6,
};

export interface PitchReading {
  planetId: string;
  orbitalFrequencyHz: number;
  audibleFrequencyHz: number;
  octavesFolded: number | null;
  angularSpeedRadPerDay: number;
  meanMotionRadPerDay: number;
  formula: string;
  noteName: string | null;
}

/**
 * Shared pitch path for both listening modes.
 * Scientific mode stops after scaling and optional velocity modulation.
 * Musical mode may then quantize and spread octaves. Neither path changes the ephemeris.
 */
export function readPitches(
  states: readonly PlanetaryState[],
  settings: PitchSettings,
): PitchReading[] {
  const prepared = states.flatMap((state) => {
    if (!(state.orbitalPeriodDays > 0)) {
      return [];
    }
    const orbital = orbitalFrequencyHz(state.orbitalPeriodDays);
    const folded =
      settings.mapping === 'octave-fold'
        ? foldIntoRegister(orbital, settings.registerLowHz, settings.registerHighHz)
        : null;
    const scaled = folded ? folded.frequencyHz : uniformScale(orbital, settings.uniformK);
    const angular = angularSpeedRadPerDay(state.positionAU, state.velocityAUPerDay);
    const mean = meanMotionRadPerDay(state.orbitalPeriodDays);
    const depth = settings.motion === 'velocity' ? settings.modulationDepth : 0;
    const modulated = velocityModulatedFrequency(scaled, angular, mean, depth);
    const voiced =
      settings.mode === 'musical' ? placeInVoiceOctave(modulated, state.id) : modulated;
    const quantized =
      settings.mode === 'musical' && settings.quantize
        ? quantizeFrequency(voiced, settings.scale, settings.rootPitchClass)
        : null;
    return [
      {
        state,
        orbital,
        octaves: folded ? folded.octaves : null,
        angular,
        mean,
        depth,
        candidate: quantized ? quantized.frequencyHz : voiced,
      },
    ];
  });

  const spread =
    settings.mode === 'musical'
      ? separateOctaves(
          prepared.map((item) => item.candidate),
          settings.harmony,
        )
      : prepared.map((item) => item.candidate);

  return prepared.map((item, index) => {
    const audible = spread[index] ?? item.candidate;
    const named =
      settings.mode === 'musical' && settings.quantize ? noteName(frequencyToMidi(audible)) : null;
    return {
      planetId: item.state.id,
      orbitalFrequencyHz: item.orbital,
      audibleFrequencyHz: audible,
      octavesFolded: item.octaves,
      angularSpeedRadPerDay: item.angular,
      meanMotionRadPerDay: item.mean,
      formula: formulaFor(item.orbital, item.octaves, settings, item.depth, named, item.state.id),
      noteName: named,
    };
  });
}

function placeInVoiceOctave(frequencyHz: number, planetId: string): number {
  const octave = MUSICAL_VOICE_OCTAVE[planetId];
  if (octave === undefined || !(frequencyHz > 0)) {
    return frequencyHz;
  }
  const lowHz = midiToFrequency((octave + 1) * 12);
  return foldIntoRegister(frequencyHz, lowHz, lowHz * 2).frequencyHz;
}

function formulaFor(
  orbitalHz: number,
  octaves: number | null,
  settings: PitchSettings,
  depth: number,
  named: string | null,
  planetId: string,
): string {
  const measured = `f_orbit ${formatHz(orbitalHz)}`;
  const mapped =
    octaves === null
      ? `${measured} × ${settings.uniformK.toExponential(4)}`
      : `${measured} × 2^${octaves}`;
  const motion = depth === 0 ? mapped : `${mapped} × (1 + ${depth.toFixed(2)} × (ω/ω̄ − 1))`;
  if (settings.mode !== 'musical') {
    return motion;
  }
  const voice = MUSICAL_VOICE_OCTAVE[planetId];
  const placed = voice === undefined ? motion : `${motion}; voice octave ${voice}`;
  if (named) {
    return `${placed} → ${named} in ${rootLabel(settings.rootPitchClass)} ${scaleLabel(settings.scale).toLowerCase()}`;
  }
  return `${placed}; quantization off`;
}
