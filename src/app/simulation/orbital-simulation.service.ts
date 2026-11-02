import { Injectable, signal } from '@angular/core';
import { AstronomyService } from '../astronomy/astronomy.service';
import { addUtcDays } from '../astronomy/time';
import { OrbitalEvent } from '../domain/orbital-event';
import { PlanetaryState } from '../domain/planetary-state';
import { DetectionResult, LongitudeTrack, createTracks, detectOrbitalEvents } from './orbital-events';

/** Simulated days advanced by one clock tick, so a stalled tab cannot emit millions of events. */
export const MAX_SIMULATED_DAYS_PER_TICK = 2000;
/** Real seconds acknowledged by one tick. Longer gaps are not fast-forwarded. */
export const MAX_REAL_SECONDS_PER_TICK = 5;
const CLOCK_INTERVAL_MS = 32;

/** One committed change of simulation time, including a seek. */
export interface SimulationStep {
  time: Date;
  previousTime: Date | null;
  states: PlanetaryState[];
  events: OrbitalEvent[];
  /** Wall-clock seconds the clock actually consumed. Seeks and manual steps use 0. */
  realSeconds: number;
  /** Simulated days advanced. Seeks use 0 so they do not replay skipped crossings. */
  simulatedDays: number;
}

export interface PlanetaryStateSource {
  getStates(time: Date): PlanetaryState[];
}

/**
 * Authoritative simulation clock. Playback multiplies real elapsed time by
 * a speed in days per real second. Rendering frames do not advance this clock.
 */
@Injectable({ providedIn: 'root' })
export class OrbitalSimulationService {
  readonly simulationTime = signal<Date | null>(null);
  readonly epoch = signal<Date | null>(null);
  readonly states = signal<PlanetaryState[]>([]);
  readonly playing = signal(false);
  readonly speedDaysPerSecond = signal(20);
  readonly latestEvents = signal<OrbitalEvent[]>([]);
  readonly eventLog = signal<OrbitalEvent[]>([]);
  readonly omittedEventCount = signal(0);
  readonly error = signal<string | null>(null);
  readonly trailGeneration = signal(0);

  private tracks: LongitudeTrack[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWallMs: number | null = null;
  private readonly stepListeners = new Set<(step: SimulationStep) => void>();

  constructor(private readonly astronomy: AstronomyService) {}

  /**
   * Fired after every successful seek or step. The audio session schedules from
   * these callbacks. Rendering frames do not.
   */
  onStep(listener: (step: SimulationStep) => void): () => void {
    this.stepListeners.add(listener);
    return () => {
      this.stepListeners.delete(listener);
    };
  }

  setSpeed(daysPerSecond: number): void {
    if (!Number.isFinite(daysPerSecond)) {
      return;
    }
    const clamped = Math.min(5000, Math.max(-5000, daysPerSecond));
    this.speedDaysPerSecond.set(clamped);
  }

  /** Seek and remember this instant as the time Reset returns to. */
  setEpoch(date: Date): boolean {
    const accepted = this.seek(date);
    if (accepted) {
      this.epoch.set(date);
    }
    return accepted;
  }

  reset(): boolean {
    const epoch = this.epoch();
    if (!epoch) {
      return false;
    }
    return this.seek(epoch);
  }

  /**
   * Move the simulation to `date` without emitting the crossings that were skipped.
   * Event anchors are rebuilt from the longitudes at the destination.
   */
  seek(date: Date): boolean {
    const previousTime = this.simulationTime();
    try {
      const states = this.astronomy.getStates(date);
      this.simulationTime.set(date);
      this.states.set(states);
      this.tracks = createTracks(states);
      this.latestEvents.set([]);
      this.eventLog.set([]);
      this.omittedEventCount.set(0);
      this.trailGeneration.update((generation) => generation + 1);
      this.error.set(null);
      this.emit({
        time: date,
        previousTime,
        states,
        events: [],
        realSeconds: 0,
        simulatedDays: 0,
      });
      return true;
    } catch (error) {
      this.error.set(messageFrom(error));
      return false;
    }
  }

  advanceDays(days: number, realSeconds = 0): OrbitalEvent[] {
    const current = this.simulationTime();
    if (current === null || !Number.isFinite(days) || days === 0) {
      return [];
    }

    try {
      const nextTime = addUtcDays(current, days);
      const states = this.astronomy.getStates(nextTime);
      const detected = detectOrbitalEvents(this.tracks, states, current, nextTime);
      this.commitStep(nextTime, states, detected, days, realSeconds);
      return detected.events;
    } catch (error) {
      this.error.set(messageFrom(error));
      return [];
    }
  }

  advanceRealSeconds(seconds: number): OrbitalEvent[] {
    if (!Number.isFinite(seconds) || seconds === 0) {
      return [];
    }
    return this.advanceDays(seconds * this.speedDaysPerSecond());
  }

  play(): void {
    if (this.timer !== null) {
      return;
    }
    this.playing.set(true);
    this.lastWallMs = performance.now();
    this.timer = setInterval(() => {
      this.tick(performance.now());
    }, CLOCK_INTERVAL_MS);
  }

  pause(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastWallMs = null;
    this.playing.set(false);
  }

  /**
   * Called by the simulation interval. `nowMs` is wall-clock time.
   * A tick never runs from the animation frame.
   */
  tick(nowMs: number): void {
    if (!this.playing() || this.lastWallMs === null || !Number.isFinite(nowMs)) {
      return;
    }
    const deltaSeconds = Math.min((nowMs - this.lastWallMs) / 1000, MAX_REAL_SECONDS_PER_TICK);
    this.lastWallMs = nowMs;
    if (deltaSeconds <= 0) {
      return;
    }
    const requestedDays = deltaSeconds * this.speedDaysPerSecond();
    const days =
      Math.sign(requestedDays) * Math.min(Math.abs(requestedDays), MAX_SIMULATED_DAYS_PER_TICK);
    if (days !== 0) {
      this.advanceDays(days, deltaSeconds);
    }
  }

  private commitStep(
    nextTime: Date,
    states: PlanetaryState[],
    detected: DetectionResult,
    simulatedDays: number,
    realSeconds: number,
  ): void {
    const previousTime = this.simulationTime();
    this.tracks = detected.tracks;
    this.simulationTime.set(nextTime);
    this.states.set(states);
    this.omittedEventCount.set(detected.omittedCount);
    this.error.set(null);
    if (detected.events.length > 0) {
      this.latestEvents.set(detected.events);
      this.eventLog.set([...detected.events, ...this.eventLog()].slice(0, 12));
    }
    this.emit({
      time: nextTime,
      previousTime,
      states,
      events: detected.events,
      realSeconds,
      simulatedDays,
    });
  }

  private emit(step: SimulationStep): void {
    for (const listener of this.stepListeners) {
      listener(step);
    }
  }
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return 'The simulation could not move to that time.';
}
