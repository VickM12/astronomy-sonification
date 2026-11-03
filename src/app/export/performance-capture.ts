import { Injectable, signal } from '@angular/core';
import { OrbitalEventType } from '../domain/orbital-event';
import { DroneInstruction, PulseInstruction } from '../sonification/plan';
import { InstrumentId, PlaybackTexture } from '../sonification/sound-model';
import { frequencyToMidi, noteName } from '../sonification/scales';

export interface PerformancePoint {
  second: number;
  simulatedDay: number;
  hz: number;
  midi: number;
  note: string;
  instrument: InstrumentId;
  gain: number;
  filterHz: number;
  resonance: number;
  pan: number;
  angularRatio: number;
  detuneCents: number;
}

export interface PerformanceNote extends PerformancePoint {
  bodyId: string;
  durationSeconds: number;
  kind: 'drone' | 'pulse';
  eventType?: OrbitalEventType;
}

export interface PerformanceVoice {
  id: string;
  points: PerformancePoint[];
}

export interface TempoChange {
  second: number;
  bpm: number;
}

export interface PerformanceMark {
  second: number;
  simulatedDay: number;
  type: OrbitalEventType;
  bodyIds: string[];
}

export interface RecordedPerformance {
  startIso: string;
  endIso: string;
  durationSeconds: number;
  simulatedSpanDays: number;
  voices: PerformanceVoice[];
  notes: PerformanceNote[];
  marks: PerformanceMark[];
  tempos: TempoChange[];
  wav: Blob;
  texture: PlaybackTexture;
}

interface ActiveDrone {
  note: PerformanceNote;
}

interface WorkingTake {
  audioStart: number;
  simulationStart: Date;
  voices: Map<string, PerformanceVoice>;
  notes: PerformanceNote[];
  marks: Map<string, PerformanceMark>;
  tempos: TempoChange[];
  active: Map<string, ActiveDrone>;
  texture: PlaybackTexture;
}

@Injectable({ providedIn: 'root' })
export class PerformanceCaptureService {
  readonly recording = signal(false);
  readonly latest = signal<RecordedPerformance | null>(null);
  private take: WorkingTake | null = null;

  begin(
    audioNow: number,
    simulationTime: Date,
    tempoBpm: number,
    texture: PlaybackTexture = 'hybrid',
  ): void {
    this.take = {
      audioStart: audioNow,
      simulationStart: simulationTime,
      voices: new Map(),
      notes: [],
      marks: new Map(),
      tempos: [{ second: 0, bpm: tempoBpm }],
      active: new Map(),
      texture,
    };
    this.recording.set(true);
  }

  captureTempo(audioNow: number, tempoBpm: number): void {
    const take = this.take;
    if (!take) {
      return;
    }
    const second = elapsed(take, audioNow);
    const last = take.tempos[take.tempos.length - 1];
    if (!last || last.bpm !== tempoBpm) {
      take.tempos.push({ second, bpm: tempoBpm });
    }
  }

  captureDrones(audioNow: number, simulationTime: Date, drones: readonly DroneInstruction[]): void {
    const take = this.take;
    if (!take) {
      return;
    }
    const second = elapsed(take, audioNow);
    const day = simulatedDay(take, simulationTime);
    const sounding = new Set(
      drones.filter((drone) => drone.gain > 0).map((drone) => drone.planetId),
    );
    for (const [id, active] of take.active) {
      if (!sounding.has(id)) {
        closeNote(active.note, second);
        take.active.delete(id);
      }
    }
    for (const drone of drones) {
      if (drone.gain <= 0) {
        continue;
      }
      const point = performancePoint(second, day, drone);
      this.addPoint(take, drone.planetId, point);
      const active = take.active.get(drone.planetId);
      if (
        active &&
        sameSound(active.note, point) &&
        Math.abs(active.note.gain - point.gain) < 0.02
      ) {
        continue;
      }
      if (active) {
        closeNote(active.note, second);
      }
      const note: PerformanceNote = {
        ...point,
        bodyId: drone.planetId,
        durationSeconds: 0,
        kind: 'drone',
      };
      take.notes.push(note);
      take.active.set(drone.planetId, { note });
    }
  }

  capturePulses(pulses: readonly PulseInstruction[]): void {
    const take = this.take;
    if (!take) {
      return;
    }
    for (const pulse of pulses) {
      const second = elapsed(take, pulse.when);
      const simulationTime = pulse.eventTimeIso
        ? new Date(pulse.eventTimeIso)
        : take.simulationStart;
      const day = simulatedDay(take, simulationTime);
      const point = performancePoint(second, day, pulse);
      this.addPoint(take, pulse.planetId, point);
      take.notes.push({
        ...point,
        bodyId: pulse.planetId,
        durationSeconds: pulse.durationSeconds,
        kind: 'pulse',
        ...(pulse.eventType ? { eventType: pulse.eventType } : {}),
      });
      if (pulse.eventType) {
        const key = `${pulse.eventTimeIso ?? second}:${pulse.eventType}`;
        const existing = take.marks.get(key);
        if (existing) {
          if (!existing.bodyIds.includes(pulse.planetId)) {
            existing.bodyIds.push(pulse.planetId);
          }
        } else {
          take.marks.set(key, {
            second,
            simulatedDay: day,
            type: pulse.eventType,
            bodyIds: [pulse.planetId],
          });
        }
      }
    }
  }

  finish(audioNow: number, simulationTime: Date, wav: Blob): RecordedPerformance | null {
    const take = this.take;
    if (!take) {
      return null;
    }
    const durationSeconds = elapsed(take, audioNow);
    for (const active of take.active.values()) {
      closeNote(active.note, durationSeconds);
    }
    const performance: RecordedPerformance = {
      startIso: take.simulationStart.toISOString(),
      endIso: simulationTime.toISOString(),
      durationSeconds,
      simulatedSpanDays: simulatedDay(take, simulationTime),
      voices: [...take.voices.values()],
      notes: take.notes
        .filter((note) => note.second < durationSeconds && note.durationSeconds > 0)
        .map((note) => ({
          ...note,
          durationSeconds: Math.min(note.durationSeconds, durationSeconds - note.second),
        })),
      marks: [...take.marks.values()].filter((mark) => mark.second < durationSeconds),
      tempos: take.tempos.filter((tempo) => tempo.second <= durationSeconds),
      wav,
      texture: take.texture,
    };
    this.take = null;
    this.recording.set(false);
    this.latest.set(performance);
    return performance;
  }

  cancel(): void {
    this.take = null;
    this.recording.set(false);
  }

  private addPoint(take: WorkingTake, id: string, point: PerformancePoint): void {
    let voice = take.voices.get(id);
    if (!voice) {
      voice = { id, points: [] };
      take.voices.set(id, voice);
    }
    const last = voice.points[voice.points.length - 1];
    if (
      last &&
      point.second - last.second < 0.1 &&
      sameSound(last, point) &&
      Math.abs(last.gain - point.gain) < 0.02
    ) {
      return;
    }
    voice.points.push(point);
  }
}

function performancePoint(
  second: number,
  day: number,
  sound: Pick<DroneInstruction, 'frequencyHz' | 'gain' | 'instrument'> &
    Partial<
      Pick<DroneInstruction, 'filterHz' | 'resonance' | 'pan' | 'angularRatio' | 'detuneCents'>
    >,
): PerformancePoint {
  const midi = Math.round(frequencyToMidi(sound.frequencyHz));
  return {
    second,
    simulatedDay: day,
    hz: sound.frequencyHz,
    midi,
    note: noteName(midi),
    instrument: sound.instrument,
    gain: sound.gain,
    filterHz: sound.filterHz ?? 12000,
    resonance: sound.resonance ?? 0.7,
    pan: sound.pan ?? 0,
    angularRatio: sound.angularRatio ?? 1,
    detuneCents: sound.detuneCents ?? 0,
  };
}

function elapsed(take: WorkingTake, audioNow: number): number {
  return Math.max(0, audioNow - take.audioStart);
}

function simulatedDay(take: WorkingTake, time: Date): number {
  return (time.getTime() - take.simulationStart.getTime()) / 86400000;
}

function closeNote(note: PerformanceNote, second: number): void {
  note.durationSeconds = Math.max(0, second - note.second);
}

function sameSound(
  left: Pick<PerformancePoint, 'hz' | 'instrument'>,
  right: Pick<PerformancePoint, 'hz' | 'instrument'>,
): boolean {
  if (left.instrument !== right.instrument || !(left.hz > 0) || !(right.hz > 0)) {
    return false;
  }
  return Math.abs(1200 * Math.log2(right.hz / left.hz)) < 1;
}
