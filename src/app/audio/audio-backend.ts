import { DroneInstruction, PulseInstruction } from '../sonification/plan';
import { InstrumentId } from '../sonification/sound-model';
import { PcmRecording } from '../export/wav';

/**
 * The synthesis graph behind the audio service.
 * Tests supply an in-memory implementation. The browser uses Tone.js.
 */
export interface AudioBackend {
  readonly running: boolean;
  start(): Promise<void>;
  currentTime(): number;
  setMix(masterGain: number, reverb: number, delay: number): void;
  syncDrones(drones: readonly DroneInstruction[]): void;
  silenceDrones(): void;
  schedulePulse(pulse: PulseInstruction): void;
  cutPulses(): void;
  dispose(): void;
  /** Instruments whose recordings are still downloading. Absent when none are sampled. */
  loadingInstruments?(): readonly string[];
  /** Load selected recorded instruments before a take begins. */
  prepareInstruments?(instruments: readonly InstrumentId[]): Promise<void>;
  startRecording?(): void;
  stopRecording?(): Promise<PcmRecording>;
}
