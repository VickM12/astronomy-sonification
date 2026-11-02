import { SIDEREAL_ORBITAL_PERIOD_DAYS } from '../astronomy/orbital-periods';
import { OrbitalEvent } from '../domain/orbital-event';
import { PlanetaryState } from '../domain/planetary-state';
import { PLANET_IDS, PlanetId } from '../domain/planets';
import { defaultMixes } from '../audio/sound-settings.service';
import { MusicalSonificationEngine, ScientificSonificationEngine } from './engines';
import { readPitches } from './pitch';
import { buildAudioPlan, eventAudioTime, noteDurationSeconds } from './plan';
import { defaultPitchSettings, PitchSettings, PlanetMix } from './sound-model';
import { frequencyToMidi, quantizeFrequency } from './scales';

const WHEN = new Date('2000-01-01T12:00:00.000Z');

function state(id: PlanetId, period = SIDEREAL_ORBITAL_PERIOD_DAYS[id]): PlanetaryState {
  const mean = (2 * Math.PI) / period;
  return {
    id,
    name: id,
    timestamp: WHEN,
    positionAU: { x: 1, y: 0, z: 0 },
    velocityAUPerDay: { x: 0, y: mean, z: 0 },
    distanceAU: 1,
    speedAUPerDay: mean,
    orbitalPeriodDays: period,
    heliocentricLongitudeRad: 0,
  };
}

const STATES = PLANET_IDS.map((id) => state(id));

describe('sonification engines', () => {
  const settings: PitchSettings = {
    ...defaultPitchSettings(),
    harmony: 0,
    motion: 'fixed',
    quantize: true,
    scale: 'major',
  };

  it('quantizes musical pitches from the orbital tones and spreads them into separate octaves', () => {
    const scientific = new ScientificSonificationEngine(settings).process(STATES, WHEN);
    const musical = new MusicalSonificationEngine(settings).process(STATES, WHEN);
    expect(scientific).toHaveLength(8);
    for (let index = 0; index < scientific.length; index += 1) {
      const science = scientific[index];
      const music = musical[index];
      expect(science?.frequencyHz).toBeGreaterThanOrEqual(110);
      expect(science?.frequencyHz).toBeLessThan(220);
      expect(science?.eventType).toBe('continuous');
      const scienceClass = pitchClass(
        quantizeFrequency(science?.frequencyHz ?? 0, 'major', 0).frequencyHz,
      );
      expect(pitchClass(music?.frequencyHz ?? 0)).toBe(scienceClass);
    }
    const heard = musical.map((event) => event.frequencyHz);
    expect(Math.max(...heard) / Math.min(...heard)).toBeGreaterThan(8);
  });

  it('keeps the orbital pitch class when musical quantization is off, moved by whole octaves', () => {
    const open = { ...settings, quantize: false, harmony: 0 };
    const scientific = new ScientificSonificationEngine(open).process(STATES, WHEN);
    const musical = new MusicalSonificationEngine(open).process(STATES, WHEN);
    expect(musical.some((event, index) => event.frequencyHz !== scientific[index]?.frequencyHz)).toBe(
      true,
    );
    musical.forEach((event, index) => {
      const scienceHz = scientific[index]?.frequencyHz ?? 1;
      const octaves = Math.round(Math.log2(event.frequencyHz / scienceHz));
      expect(event.frequencyHz).toBeCloseTo(scienceHz * 2 ** octaves, 4);
    });
  });

  it('retunes when the scale changes', () => {
    const major = new MusicalSonificationEngine({ ...settings, scale: 'major', harmony: 0 }).process(
      STATES,
      WHEN,
    );
    const minor = new MusicalSonificationEngine({
      ...settings,
      scale: 'natural-minor',
      harmony: 0,
    }).process(STATES, WHEN);
    const venusMajor = major.find((event) => event.planetId === 'venus')?.frequencyHz ?? 0;
    const venusMinor = minor.find((event) => event.planetId === 'venus')?.frequencyHz ?? 0;
    expect(Math.abs(frequencyToMidi(venusMajor) - frequencyToMidi(venusMinor))).toBeGreaterThan(0.5);
  });

  it('repeats the same frequencies for the same states', () => {
    const engine = new ScientificSonificationEngine(settings);
    const first = engine.process(STATES, WHEN).map((event) => event.frequencyHz);
    const second = engine.process(STATES, WHEN).map((event) => event.frequencyHz);
    expect(second).toEqual(first);
  });

  it('names the octave count and the angular-speed term in the formula', () => {
    const reading = readPitches(STATES, {
      ...settings,
      motion: 'velocity',
      modulationDepth: 0.5,
    })[2];
    expect(reading?.formula).toContain('2^');
    expect(reading?.formula).toContain('ω/ω̄');
  });
});

function pitchClass(frequencyHz: number): number {
  const midi = Math.round(frequencyToMidi(frequencyHz));
  return ((midi % 12) + 12) % 12;
}

describe('audio plan', () => {
  const previous = new Date('2000-01-01T12:00:00.000Z');
  const next = new Date('2000-01-02T12:00:00.000Z');
  const eventTime = new Date(previous.getTime() + 0.25 * (next.getTime() - previous.getTime()));
  const crossing: OrbitalEvent = {
    type: 'reference-meridian',
    planetId: 'mercury',
    simulationTime: eventTime,
    longitudeRad: 0,
  };

  function plan(
    patch: Partial<Parameters<typeof buildAudioPlan>[0]> = {},
    mixes: Record<PlanetId, PlanetMix> = defaultMixes(),
  ) {
    return buildAudioPlan({
      states: STATES,
      pitch: { ...defaultPitchSettings(), harmony: 0, motion: 'fixed' },
      mixes,
      events: [crossing],
      previousTime: previous,
      time: next,
      simulatedDays: 1,
      compressionSecondsPerDay: 2,
      audioNow: 10,
      playing: true,
      dronesEnabled: true,
      pulsesEnabled: true,
      alignmentsEnabled: true,
      tempoBpm: 60,
      beats: 1,
      masterGain: 0.6,
      reverb: 0.2,
      delay: 0.1,
      ...patch,
    });
  }

  it('places a crossing on the audio clock from simulated days, not from tempo', () => {
    expect(eventAudioTime(eventTime.getTime(), previous.getTime(), next.getTime(), 1, 2, 10)).toBeCloseTo(
      10.5,
      6,
    );
    const slow = plan({ tempoBpm: 60 });
    const fast = plan({ tempoBpm: 140 });
    expect(slow.pulses[0]?.when).toBeCloseTo(10.5, 6);
    expect(fast.pulses[0]?.when).toBeCloseTo(slow.pulses[0]?.when ?? 0, 6);
    expect(fast.pulses[0]?.durationSeconds).toBeLessThan(slow.pulses[0]?.durationSeconds ?? 0);
    expect(noteDurationSeconds(60, 1)).toBeCloseTo(1, 6);
    expect(plan({ compressionSecondsPerDay: 4 }).pulses[0]?.when).toBeCloseTo(11, 6);
    expect(plan({ compressionSecondsPerDay: 4 }).pulses[0]?.durationSeconds).toBeCloseTo(1, 6);
  });

  it('keeps drones, pulses, mute, and solo independent', () => {
    expect(plan({ playing: false }).drones).toEqual([]);
    expect(plan({ playing: false }).pulses.length).toBeGreaterThan(0);
    expect(plan({ dronesEnabled: false }).drones).toEqual([]);
    expect(plan({ pulsesEnabled: false }).pulses).toEqual([]);

    const muted = defaultMixes();
    muted.mercury = { ...muted.mercury, muted: true };
    expect(plan({}, muted).pulses).toEqual([]);

    const solo = defaultMixes();
    solo.venus = { ...solo.venus, solo: true };
    expect(plan({}, solo).pulses).toEqual([]);
    expect(plan({}, solo).drones.find((drone) => drone.planetId === 'mercury')?.gain).toBe(0);
    expect(plan({}, solo).drones.find((drone) => drone.planetId === 'venus')?.gain).toBeGreaterThan(
      0,
    );
  });

  it('sounds an alignment only when that toggle is on', () => {
    const alignment: OrbitalEvent = {
      type: 'conjunction',
      planetId: 'mercury',
      otherPlanetId: 'venus',
      simulationTime: eventTime,
      longitudeRad: 0,
    };
    expect(plan({ events: [alignment], alignmentsEnabled: false, pulsesEnabled: true }).pulses).toEqual(
      [],
    );
    const sounded = plan({ events: [alignment], alignmentsEnabled: true, pulsesEnabled: false });
    expect(sounded.pulses.map((pulse) => pulse.planetId).sort()).toEqual(['mercury', 'venus']);
  });

  it('builds the same plan twice', () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });

  it('leaves Galilean moon crossings out of the pulse list', () => {
    const io: PlanetaryState = {
      ...state('earth'),
      id: 'io',
      name: 'Io',
      orbitalPeriodDays: 1.769138,
      frame: 'jovicentric',
    };
    const meridian: OrbitalEvent = {
      type: 'reference-meridian',
      planetId: 'io',
      simulationTime: eventTime,
      longitudeRad: 0,
    };
    const conjunction: OrbitalEvent = {
      type: 'conjunction',
      planetId: 'io',
      otherPlanetId: 'europa',
      simulationTime: eventTime,
      longitudeRad: 0,
    };
    const result = plan({ states: [io], events: [meridian, conjunction] });
    expect(result.pulses).toEqual([]);
    expect(result.drones.map((drone) => drone.planetId)).toEqual(['io']);
  });
});
