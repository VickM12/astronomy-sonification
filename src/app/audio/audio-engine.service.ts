import { Inject, Injectable, Optional, signal } from '@angular/core';
import { InjectionToken } from '@angular/core';
import { AudioBackend } from './audio-backend';
import { ToneAudioBackend } from './tone-audio-backend';
import { DroneInstruction, PulseInstruction } from '../sonification/plan';

/** Tests provide an in-memory backend. The browser graph is the default. */
export const AUDIO_BACKEND = new InjectionToken<AudioBackend>('AUDIO_BACKEND');

/** Notes sounding at once. More than this exhausts the audio thread and can freeze the tab. */
const MAX_LIVE_PULSES = 16;

/**
 * Starts on a user gesture and keeps the Tone graph behind a small interface.
 * Precise notes are handed to the backend with an audio-clock time.
 */
@Injectable({ providedIn: 'root' })
export class AudioEngineService {
  readonly error = signal<string | null>(null);
  readonly running = signal(false);
  /** Instrument ids whose recordings are downloading; a synth patch plays meanwhile. */
  readonly loading = signal<readonly string[]>([]);

  private readonly backend: AudioBackend;
  private disposed = false;
  private pulseEnds: number[] = [];

  constructor(@Optional() @Inject(AUDIO_BACKEND) backend?: AudioBackend | null) {
    this.backend = backend ?? new ToneAudioBackend();
  }

  async start(): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    if (this.running()) {
      return true;
    }
    try {
      await this.backend.start();
      const started = this.backend.running;
      this.running.set(started);
      this.error.set(started ? null : 'Audio did not start.');
      return started;
    } catch (error) {
      this.running.set(false);
      this.error.set(error instanceof Error ? error.message : 'Audio could not start.');
      return false;
    }
  }

  currentTime(): number {
    return this.backend.currentTime();
  }

  setMix(masterGain: number, reverb: number, delay: number): void {
    if (!this.backend.running || this.disposed) {
      return;
    }
    this.guard(() => this.backend.setMix(masterGain, reverb, delay));
  }

  syncDrones(drones: readonly DroneInstruction[]): void {
    if (!this.backend.running || this.disposed) {
      return;
    }
    this.guard(() => this.backend.syncDrones(drones));
    const loading = this.backend.loadingInstruments?.() ?? [];
    const key = loading.join(',');
    if (key !== this.loading().join(',')) {
      this.loading.set([...loading]);
    }
  }

  silenceDrones(): void {
    if (!this.backend.running || this.disposed) {
      return;
    }
    this.guard(() => this.backend.silenceDrones());
  }

  schedulePulses(pulses: readonly PulseInstruction[]): void {
    if (!this.backend.running || this.disposed) {
      return;
    }
    this.guard(() => {
      const now = this.backend.currentTime();
      this.pulseEnds = this.pulseEnds.filter((end) => end > now);
      for (const pulse of pulses) {
        if (this.pulseEnds.length >= MAX_LIVE_PULSES) {
          break;
        }
        this.backend.schedulePulse(pulse);
        this.pulseEnds.push(pulse.when + pulse.durationSeconds + 0.45);
      }
    });
  }

  stop(): void {
    if (!this.backend.running || this.disposed) {
      return;
    }
    this.pulseEnds = [];
    this.guard(() => {
      this.backend.silenceDrones();
      this.backend.cutPulses();
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.backend.dispose();
    this.running.set(false);
  }

  private guard(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Audio stopped.');
    }
  }
}
