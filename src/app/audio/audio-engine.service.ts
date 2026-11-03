import { Inject, Injectable, Optional, signal } from '@angular/core';
import { InjectionToken } from '@angular/core';
import { AudioBackend } from './audio-backend';
import { ToneAudioBackend } from './tone-audio-backend';
import { DroneInstruction, PulseInstruction } from '../sonification/plan';
import { InstrumentId } from '../sonification/sound-model';
import { encodeWav } from '../export/wav';

/** Tests provide an in-memory backend. The browser graph is the default. */
export const AUDIO_BACKEND = new InjectionToken<AudioBackend>('AUDIO_BACKEND');

/** Notes sounding at once. More than this exhausts the audio thread and can freeze the tab. */
const MAX_LIVE_PULSES = 16;
export const MAX_RECORDING_SECONDS = 300;

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
  readonly preparing = signal(false);
  readonly recording = signal(false);
  readonly recordingLimitReached = signal(false);

  private readonly backend: AudioBackend;
  private disposed = false;
  private pulseEnds: number[] = [];
  private recordingTimer: ReturnType<typeof setTimeout> | null = null;

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

  async prepareInstruments(instruments: readonly InstrumentId[]): Promise<void> {
    if (!this.backend.prepareInstruments || this.disposed) {
      return;
    }
    this.preparing.set(true);
    try {
      await this.backend.prepareInstruments(instruments);
    } finally {
      this.preparing.set(false);
    }
  }

  startRecording(): void {
    if (!this.backend.startRecording || !this.running() || this.disposed) {
      throw new Error('Audio recording is unavailable.');
    }
    this.backend.startRecording();
    this.recordingLimitReached.set(false);
    this.recording.set(true);
    this.recordingTimer = setTimeout(() => {
      this.recordingLimitReached.set(true);
    }, MAX_RECORDING_SECONDS * 1000);
  }

  async stopRecording(): Promise<Blob> {
    if (!this.backend.stopRecording || !this.recording()) {
      throw new Error('No audio recording is in progress.');
    }
    this.clearRecordingTimer();
    try {
      return encodeWav(await this.backend.stopRecording());
    } finally {
      this.recording.set(false);
    }
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

  schedulePulses(pulses: readonly PulseInstruction[]): PulseInstruction[] {
    if (!this.backend.running || this.disposed) {
      return [];
    }
    const accepted: PulseInstruction[] = [];
    try {
      const now = this.backend.currentTime();
      this.pulseEnds = this.pulseEnds.filter((end) => end > now);
      for (const pulse of pulses) {
        if (this.pulseEnds.length >= MAX_LIVE_PULSES) {
          break;
        }
        this.backend.schedulePulse(pulse);
        this.pulseEnds.push(pulse.when + pulse.durationSeconds + 0.45);
        accepted.push(pulse);
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Audio stopped.');
    }
    return accepted;
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
    this.clearRecordingTimer();
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

  private clearRecordingTimer(): void {
    if (this.recordingTimer !== null) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
  }
}
