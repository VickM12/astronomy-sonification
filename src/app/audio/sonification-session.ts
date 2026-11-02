import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { AudioEngineService } from './audio-engine.service';
import { SoundSettingsService } from './sound-settings.service';
import { OrbitalSimulationService, SimulationStep } from '../simulation/orbital-simulation.service';
import { buildAudioPlan } from '../sonification/plan';

/**
 * Listens to simulation steps and keeps the drones matched to the current states.
 * Crossing pulses are submitted with an audio-clock timestamp from the step.
 */
@Injectable({ providedIn: 'root' })
export class SonificationSession {
  private readonly simulation = inject(OrbitalSimulationService);
  private readonly audio = inject(AudioEngineService);
  private readonly sound = inject(SoundSettingsService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const unsubscribe = this.simulation.onStep((step) => this.onStep(step));
    this.destroyRef.onDestroy(() => {
      unsubscribe();
      this.audio.stop();
    });
    effect(() => this.follow());
  }

  private follow(): void {
    if (!this.audio.running()) {
      return;
    }
    try {
      this.followRunning();
    } catch (error) {
      this.audio.error.set(error instanceof Error ? error.message : 'Audio stopped.');
    }
  }

  private followRunning(): void {
    const snapshot = this.sound.snapshot();
    const playing = this.simulation.playing();
    this.audio.setMix(snapshot.masterGain, snapshot.reverb, snapshot.delay);
    if (!playing || !snapshot.drones) {
      this.audio.silenceDrones();
      return;
    }
    const states = this.simulation.states();
    const time = this.simulation.simulationTime() ?? new Date(0);
    const plan = buildAudioPlan({
      states,
      pitch: this.sound.pitchSettings(),
      mixes: snapshot.planets,
      events: [],
      previousTime: time,
      time,
      simulatedDays: 0,
      compressionSecondsPerDay: snapshot.compressionSecondsPerDay,
      audioNow: this.audio.currentTime(),
      playing: true,
      dronesEnabled: true,
      pulsesEnabled: false,
      alignmentsEnabled: false,
      tempoBpm: snapshot.tempoBpm,
      beats: snapshot.beats,
      masterGain: snapshot.masterGain,
      reverb: snapshot.reverb,
      delay: snapshot.delay,
    });
    this.audio.syncDrones(plan.drones);
  }

  private onStep(step: SimulationStep): void {
    if (!this.audio.running() || step.events.length === 0) {
      return;
    }
    try {
      this.scheduleStep(step);
    } catch (error) {
      this.audio.error.set(error instanceof Error ? error.message : 'Audio stopped.');
    }
  }

  private scheduleStep(step: SimulationStep): void {
    const snapshot = this.sound.snapshot();
    const plan = buildAudioPlan({
      states: step.states,
      pitch: this.sound.pitchSettings(),
      mixes: snapshot.planets,
      events: step.events,
      previousTime: step.previousTime,
      time: step.time,
      simulatedDays: step.simulatedDays,
      compressionSecondsPerDay: snapshot.compressionSecondsPerDay,
      audioNow: this.audio.currentTime(),
      playing: false,
      dronesEnabled: false,
      pulsesEnabled: snapshot.pulses,
      alignmentsEnabled: snapshot.alignments,
      tempoBpm: snapshot.tempoBpm,
      beats: snapshot.beats,
      masterGain: snapshot.masterGain,
      reverb: snapshot.reverb,
      delay: snapshot.delay,
    });
    this.audio.schedulePulses(plan.pulses);
  }
}
