import type { AmplitudeEnvelope, FeedbackDelay, Gain, Limiter, Oscillator, Reverb } from 'tone';
import { DroneInstruction, PulseInstruction } from '../sonification/plan';
import { InstrumentId } from '../sonification/sound-model';
import { AudioBackend } from './audio-backend';

type ToneModule = typeof import('tone');
type Wave = 'sine' | 'triangle' | 'square';

interface Voice {
  instrument: InstrumentId;
  oscillator: Oscillator;
  gain: Gain;
  fresh: boolean;
  lastHz: number;
  lastGain: number;
}

interface LivePulse {
  stopAt: number;
  nodes: { dispose(): unknown }[];
}

/**
 * Tone.js graph. Pulses are scheduled with Tone.now(), which reads the audio clock.
 * The simulation interval only submits those times. It does not wait them out.
 */
export class ToneAudioBackend implements AudioBackend {
  running = false;

  private disposed = false;
  private tone: ToneModule | null = null;
  private limiter: Limiter | null = null;
  private bus: Gain | null = null;
  private reverb: Reverb | null = null;
  private delay: FeedbackDelay | null = null;
  private reverbSend: Gain | null = null;
  private delaySend: Gain | null = null;
  private readonly voices = new Map<string, Voice>();
  private pulses: LivePulse[] = [];
  private mix = { master: Number.NaN, reverb: Number.NaN, delay: Number.NaN };

  async start(): Promise<void> {
    if (this.running || this.disposed) {
      return;
    }
    const tone = await import('tone');
    await tone.start();
    this.tone = tone;
    this.limiter = new tone.Limiter(-2).toDestination();
    this.bus = new tone.Gain(0.6);
    this.reverb = new tone.Reverb({ decay: 2.4, preDelay: 0.02, wet: 1 });
    this.delay = new tone.FeedbackDelay({ delayTime: 0.22, feedback: 0.28, wet: 1 });
    this.reverbSend = new tone.Gain(0.18);
    this.delaySend = new tone.Gain(0.12);

    this.bus.connect(this.limiter);
    this.bus.connect(this.reverb);
    this.reverb.connect(this.reverbSend);
    this.reverbSend.connect(this.limiter);
    this.bus.connect(this.delay);
    this.delay.connect(this.delaySend);
    this.delaySend.connect(this.limiter);
    void this.reverb.ready.catch(() => undefined);
    this.running = true;
  }

  currentTime(): number {
    return this.tone?.now() ?? 0;
  }

  setMix(masterGain: number, reverb: number, delay: number): void {
    if (!this.bus || !this.reverbSend || !this.delaySend) {
      return;
    }
    const next = {
      master: clampUnit(masterGain),
      reverb: clampUnit(reverb),
      delay: clampUnit(delay),
    };
    if (
      next.master === this.mix.master &&
      next.reverb === this.mix.reverb &&
      next.delay === this.mix.delay
    ) {
      return;
    }
    this.mix = next;
    this.bus.gain.rampTo(next.master, 0.05);
    this.reverbSend.gain.rampTo(next.reverb, 0.05);
    this.delaySend.gain.rampTo(next.delay, 0.05);
  }

  syncDrones(drones: readonly DroneInstruction[]): void {
    if (!this.running) {
      return;
    }
    const keep = new Set<string>();
    for (const drone of drones) {
      keep.add(drone.planetId);
      this.writeDrone(drone);
    }
    for (const [id, voice] of this.voices) {
      if (!keep.has(id)) {
        voice.gain.gain.rampTo(0, 0.05);
      }
    }
    this.sweepPulses();
  }

  silenceDrones(): void {
    for (const voice of this.voices.values()) {
      voice.gain.gain.rampTo(0, 0.04);
    }
  }

  schedulePulse(pulse: PulseInstruction): void {
    if (!this.tone || !this.bus || !this.running || this.pulses.length >= 16) {
      return;
    }
    const tone = this.tone;
    const when = Math.max(pulse.when, tone.now());
    const oscillator = new tone.Oscillator(safeHz(pulse.frequencyHz), waveform(pulse.instrument));
    const envelope = new tone.AmplitudeEnvelope(envelopeFor(pulse.instrument));
    const gain = new tone.Gain(Math.max(0, pulse.gain));
    oscillator.connect(envelope);
    envelope.connect(gain);
    gain.connect(this.bus);
    const duration = Math.max(0.05, pulse.durationSeconds);
    oscillator.start(when);
    envelope.triggerAttackRelease(duration, when);
    const stopAt = when + duration + 0.45;
    oscillator.stop(stopAt);
    this.pulses.push({ stopAt, nodes: [oscillator, envelope, gain] });
    this.sweepPulses();
  }

  cutPulses(): void {
    for (const pulse of this.pulses) {
      for (const node of pulse.nodes) {
        node.dispose();
      }
    }
    this.pulses = [];
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cutPulses();
    for (const voice of this.voices.values()) {
      voice.oscillator.dispose();
      voice.gain.dispose();
    }
    this.voices.clear();
    this.reverb?.dispose();
    this.delay?.dispose();
    this.reverbSend?.dispose();
    this.delaySend?.dispose();
    this.bus?.dispose();
    this.limiter?.dispose();
    this.running = false;
  }

  private writeDrone(drone: DroneInstruction): void {
    if (!this.tone || !this.bus) {
      return;
    }
    let voice = this.voices.get(drone.planetId);
    if (!voice) {
      const oscillator = new this.tone.Oscillator(
        safeHz(drone.frequencyHz),
        waveform(drone.instrument),
      );
      const gain = new this.tone.Gain(0);
      oscillator.connect(gain);
      gain.connect(this.bus);
      oscillator.start(this.tone.now());
      voice = {
        instrument: drone.instrument,
        oscillator,
        gain,
        fresh: true,
        lastHz: 0,
        lastGain: Number.NaN,
      };
      this.voices.set(drone.planetId, voice);
    }
    if (voice.instrument !== drone.instrument) {
      voice.oscillator.type = waveform(drone.instrument);
      voice.instrument = drone.instrument;
    }
    const frequency = safeHz(drone.frequencyHz);
    const cents =
      voice.lastHz > 0 ? Math.abs(1200 * Math.log2(frequency / voice.lastHz)) : 1200;
    // A scale or mapping change is a jump. Setting the value skips the glide
    // that the simulation tick would otherwise keep restarting.
    if (voice.fresh || cents >= 40) {
      voice.oscillator.frequency.value = frequency;
      voice.fresh = false;
    } else {
      voice.oscillator.frequency.rampTo(frequency, 0.12);
    }
    voice.lastHz = frequency;
    const level = Math.max(0, drone.gain);
    if (level !== voice.lastGain) {
      voice.lastGain = level;
      voice.gain.gain.rampTo(level, 0.05);
    }
  }

  private sweepPulses(): void {
    const now = this.tone?.now() ?? 0;
    this.pulses = this.pulses.filter((pulse) => {
      if (now <= pulse.stopAt + 0.05) {
        return true;
      }
      for (const node of pulse.nodes) {
        node.dispose();
      }
      return false;
    });
  }
}

function waveform(instrument: InstrumentId): Wave {
  if (instrument === 'pad' || instrument === 'bell') {
    return 'triangle';
  }
  if (instrument === 'pluck') {
    return 'square';
  }
  return 'sine';
}

function envelopeFor(instrument: InstrumentId): {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
} {
  switch (instrument) {
    case 'bell':
      return { attack: 0.005, decay: 1.1, sustain: 0, release: 0.4 };
    case 'pluck':
      return { attack: 0.004, decay: 0.16, sustain: 0, release: 0.08 };
    case 'pad':
      return { attack: 0.08, decay: 0.35, sustain: 0.15, release: 0.45 };
    case 'bass':
      return { attack: 0.012, decay: 0.32, sustain: 0, release: 0.22 };
    case 'sine':
      return { attack: 0.01, decay: 0.28, sustain: 0, release: 0.16 };
  }
}

function safeHz(frequencyHz: number): number {
  if (!Number.isFinite(frequencyHz) || frequencyHz < 0.05) {
    return 0.05;
  }
  return Math.min(8000, frequencyHz);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
