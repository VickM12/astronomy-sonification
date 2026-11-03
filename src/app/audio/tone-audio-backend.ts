import type {
  AmplitudeEnvelope,
  FeedbackDelay,
  Filter,
  Gain,
  Limiter,
  Oscillator,
  Reverb,
  Sampler,
  ToneAudioBuffer,
  ToneAudioBuffers,
} from 'tone';
import {
  addAudioWorkletModule,
  AudioWorkletNode as StandardizedAudioWorkletNode,
  IAudioContext,
  IAudioWorkletNode,
} from 'standardized-audio-context';
import { DroneInstruction, PulseInstruction } from '../sonification/plan';
import { InstrumentId } from '../sonification/sound-model';
import { PcmRecording } from '../export/wav';
import { AudioBackend } from './audio-backend';
import {
  SAMPLE_BASE_URL,
  SAMPLED_INSTRUMENTS,
  SampledInstrument,
  sampleUrls,
} from './sample-library';

type ToneModule = typeof import('tone');
type ToneOscillatorType = Oscillator['type'];

/** A sustained synth voice: oscillator → lowpass → gain. */
interface SynthVoice {
  kind: 'synth';
  instrument: InstrumentId;
  oscillator: Oscillator;
  filter: Filter;
  gain: Gain;
  fresh: boolean;
  lastHz: number;
  lastGain: number;
}

/**
 * A sustained recorded voice. Recordings end, so a held note is re-struck a
 * little before the previous stroke fades: a new bow, a new breath.
 */
interface SampledVoice {
  kind: 'sampled';
  instrument: InstrumentId;
  sampler: Sampler;
  gain: Gain;
  nextBow: number;
  lastHz: number;
  lastGain: number;
}

type Voice = SynthVoice | SampledVoice;

interface LivePulse {
  stopAt: number;
  nodes: { dispose(): unknown }[];
}

interface SampleSet {
  buffers: ToneAudioBuffers;
  loaded: boolean;
  failed: boolean;
  pulses: Sampler | null;
  ready: Promise<void>;
}

interface RecorderChunkMessage {
  left: Float32Array;
  right: Float32Array;
}

/**
 * One timbre per synth instrument. `wave` is the oscillator type, `cutoff` is
 * the lowpass corner as a multiple of the sounding pitch (so brightness tracks
 * register), and the envelope is applied to pulses. Drones use wave and filter.
 * Instruments listed in SAMPLED_INSTRUMENTS use recordings once those have
 * loaded; this patch plays until then.
 */
export interface Timbre {
  wave: ToneOscillatorType;
  cutoff: number;
  resonance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export const TIMBRES: Readonly<Record<InstrumentId, Timbre>> = {
  sine: {
    wave: 'sine',
    cutoff: 12,
    resonance: 0,
    attack: 0.01,
    decay: 0.28,
    sustain: 0,
    release: 0.16,
  },
  pad: {
    wave: 'triangle',
    cutoff: 6,
    resonance: 0,
    attack: 0.08,
    decay: 0.35,
    sustain: 0.15,
    release: 0.45,
  },
  bell: {
    wave: 'triangle',
    cutoff: 10,
    resonance: 0,
    attack: 0.005,
    decay: 1.1,
    sustain: 0,
    release: 0.4,
  },
  pluck: {
    wave: 'square',
    cutoff: 5,
    resonance: 0.5,
    attack: 0.004,
    decay: 0.16,
    sustain: 0,
    release: 0.08,
  },
  bass: {
    wave: 'sine',
    cutoff: 8,
    resonance: 0,
    attack: 0.012,
    decay: 0.32,
    sustain: 0,
    release: 0.22,
  },
  strings: {
    wave: 'sawtooth16',
    cutoff: 5,
    resonance: 0.3,
    attack: 0.14,
    decay: 0.2,
    sustain: 0.7,
    release: 0.5,
  },
  cello: {
    wave: 'sawtooth12',
    cutoff: 4,
    resonance: 0.5,
    attack: 0.1,
    decay: 0.2,
    sustain: 0.7,
    release: 0.45,
  },
  flute: {
    wave: 'sine',
    cutoff: 3,
    resonance: 0.2,
    attack: 0.07,
    decay: 0.1,
    sustain: 0.8,
    release: 0.25,
  },
  bassoon: {
    wave: 'sawtooth8',
    cutoff: 5,
    resonance: 1.4,
    attack: 0.05,
    decay: 0.1,
    sustain: 0.75,
    release: 0.2,
  },
  clarinet: {
    wave: 'square8',
    cutoff: 3,
    resonance: 0.6,
    attack: 0.05,
    decay: 0.1,
    sustain: 0.8,
    release: 0.22,
  },
  horn: {
    wave: 'sawtooth6',
    cutoff: 2.5,
    resonance: 0.8,
    attack: 0.06,
    decay: 0.15,
    sustain: 0.75,
    release: 0.35,
  },
  trumpet: {
    wave: 'sawtooth',
    cutoff: 8,
    resonance: 1.2,
    attack: 0.03,
    decay: 0.12,
    sustain: 0.8,
    release: 0.18,
  },
  harp: {
    wave: 'triangle8',
    cutoff: 6,
    resonance: 0.2,
    attack: 0.003,
    decay: 0.9,
    sustain: 0,
    release: 0.3,
  },
  piano: {
    wave: 'triangle6',
    cutoff: 7,
    resonance: 0.2,
    attack: 0.004,
    decay: 1.2,
    sustain: 0,
    release: 0.4,
  },
};

/** Overlap between one stroke of a sustained recording and the next. */
const BOW_OVERLAP_SECONDS = 0.5;

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
  private readonly samples = new Map<InstrumentId, SampleSet>();
  private pulses: LivePulse[] = [];
  private mix = { master: Number.NaN, reverb: Number.NaN, delay: Number.NaN };
  private recorder: IAudioWorkletNode<IAudioContext> | null = null;
  private recorderError: string | null = null;
  private recordedLeft: Float32Array[] = [];
  private recordedRight: Float32Array[] = [];

  async start(): Promise<void> {
    if (this.running || this.disposed) {
      return;
    }
    const tone = await import('tone');
    await tone.start();
    this.tone = tone;
    this.limiter = new tone.Limiter(-2);
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
    await this.connectOutput(tone);
    void this.reverb.ready.catch(() => undefined);
    this.running = true;
  }

  currentTime(): number {
    return this.tone?.now() ?? 0;
  }

  /** Instruments whose recordings are still downloading. */
  loadingInstruments(): InstrumentId[] {
    return [...this.samples.entries()]
      .filter(([, set]) => !set.loaded && !set.failed)
      .map(([id]) => id);
  }

  async prepareInstruments(instruments: readonly InstrumentId[]): Promise<void> {
    const pending = [...new Set(instruments)]
      .map((instrument) => this.sampleSet(instrument))
      .filter((set): set is SampleSet => set !== null)
      .map((set) => set.ready);
    await Promise.all(pending);
  }

  startRecording(): void {
    if (!this.recorder) {
      throw new Error(this.recorderError ?? 'This browser cannot record audio.');
    }
    this.recordedLeft = [];
    this.recordedRight = [];
    this.recorder.port.postMessage('start');
  }

  async stopRecording(): Promise<PcmRecording> {
    if (!this.recorder || !this.tone) {
      throw new Error(this.recorderError ?? 'This browser cannot record audio.');
    }
    const recorder = this.recorder;
    const tone = this.tone;
    await new Promise<void>((resolve) => {
      const listener = (event: MessageEvent<unknown>): void => {
        if (event.data !== 'stopped') {
          return;
        }
        recorder.port.removeEventListener('message', listener);
        resolve();
      };
      recorder.port.addEventListener('message', listener);
      recorder.port.postMessage('stop');
    });
    return {
      sampleRate: tone.getContext().sampleRate,
      channels: [this.recordedLeft, this.recordedRight],
    };
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
      if (!keep.has(id) && voice.lastGain !== 0) {
        voice.lastGain = 0;
        voice.gain.gain.rampTo(0, 0.05);
      }
    }
    this.sweepPulses();
  }

  silenceDrones(): void {
    for (const voice of this.voices.values()) {
      if (voice.lastGain === 0) {
        continue;
      }
      voice.lastGain = 0;
      voice.gain.gain.rampTo(0, 0.04);
    }
    this.sweepPulses();
  }

  schedulePulse(pulse: PulseInstruction): void {
    if (!this.tone || !this.bus || !this.running) {
      return;
    }
    this.sweepPulses();
    if (this.pulses.length >= 16) {
      return;
    }
    const tone = this.tone;
    const when = Math.max(pulse.when, tone.now());
    const frequency = safeHz(pulse.frequencyHz);
    const duration = Math.max(0.05, pulse.durationSeconds);
    const level = Math.max(0, pulse.gain);

    const recorded = this.recordedSampler(pulse.instrument);
    if (recorded) {
      const release = SAMPLED_INSTRUMENTS[pulse.instrument]?.release ?? 0.3;
      recorded.triggerAttackRelease(frequency, duration, when, clampUnit(level));
      this.pulses.push({ stopAt: when + duration + release, nodes: [] });
      return;
    }

    const timbre = TIMBRES[pulse.instrument];
    const oscillator = new tone.Oscillator(frequency, timbre.wave);
    const filter = new tone.Filter(cutoffHz(frequency, timbre), 'lowpass');
    filter.Q.value = timbre.resonance;
    const envelope = new tone.AmplitudeEnvelope({
      attack: timbre.attack,
      decay: timbre.decay,
      sustain: timbre.sustain,
      release: timbre.release,
    });
    const gain = new tone.Gain(level * loudnessTrim(timbre));
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(gain);
    gain.connect(this.bus);
    oscillator.start(when);
    envelope.triggerAttackRelease(duration, when);
    const stopAt = when + duration + Math.max(0.45, timbre.release + 0.1);
    oscillator.stop(stopAt);
    this.pulses.push({ stopAt, nodes: [oscillator, filter, envelope, gain] });
  }

  cutPulses(): void {
    for (const pulse of this.pulses) {
      for (const node of pulse.nodes) {
        node.dispose();
      }
    }
    this.pulses = [];
    for (const set of this.samples.values()) {
      set.pulses?.releaseAll();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cutPulses();
    for (const voice of this.voices.values()) {
      disposeVoice(voice);
    }
    this.voices.clear();
    for (const set of this.samples.values()) {
      set.pulses?.dispose();
      set.buffers.dispose();
    }
    this.samples.clear();
    this.reverb?.dispose();
    this.delay?.dispose();
    this.reverbSend?.dispose();
    this.delaySend?.dispose();
    this.bus?.dispose();
    this.limiter?.dispose();
    this.recorder?.disconnect();
    this.recorder = null;
    this.running = false;
  }

  private writeDrone(drone: DroneInstruction): void {
    if (!this.tone || !this.bus) {
      return;
    }
    const wantSampled = this.sampleSet(drone.instrument)?.loaded === true;
    let voice = this.voices.get(drone.planetId);
    if (
      voice &&
      (voice.instrument !== drone.instrument || (voice.kind === 'sampled') !== wantSampled)
    ) {
      // Instrument changed, or its recordings just finished loading: rebuild
      // the voice so the new sound takes over at the current level.
      disposeVoice(voice);
      this.voices.delete(drone.planetId);
      voice = undefined;
    }
    const frequency = safeHz(drone.frequencyHz);
    if (!voice) {
      const created = wantSampled
        ? this.createSampledVoice(drone.instrument)
        : this.createSynthVoice(drone.instrument, frequency);
      if (!created) {
        return;
      }
      voice = created;
      this.voices.set(drone.planetId, voice);
    }
    const level = Math.max(0, drone.gain);
    if (voice.kind === 'synth') {
      this.tuneSynth(voice, frequency);
      const trimmed = level * loudnessTrim(TIMBRES[voice.instrument]);
      if (trimmed !== voice.lastGain) {
        voice.lastGain = trimmed;
        voice.gain.gain.rampTo(trimmed, 0.05);
      }
      return;
    }
    this.bow(voice, frequency, level);
  }

  private createSynthVoice(instrument: InstrumentId, frequency: number): SynthVoice | null {
    if (!this.tone || !this.bus) {
      return null;
    }
    const timbre = TIMBRES[instrument];
    const oscillator = new this.tone.Oscillator(frequency, timbre.wave);
    const filter = new this.tone.Filter(cutoffHz(frequency, timbre), 'lowpass');
    filter.Q.value = timbre.resonance;
    const gain = new this.tone.Gain(0);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus);
    oscillator.start(this.tone.now());
    return {
      kind: 'synth',
      instrument,
      oscillator,
      filter,
      gain,
      fresh: true,
      lastHz: 0,
      lastGain: Number.NaN,
    };
  }

  private createSampledVoice(instrument: InstrumentId): SampledVoice | null {
    const set = this.sampleSet(instrument);
    const spec = SAMPLED_INSTRUMENTS[instrument];
    if (!this.tone || !this.bus || !set?.loaded || !spec) {
      return null;
    }
    const sampler = this.samplerFrom(set.buffers, spec);
    const gain = new this.tone.Gain(0);
    sampler.connect(gain);
    gain.connect(this.bus);
    return {
      kind: 'sampled',
      instrument,
      sampler,
      gain,
      nextBow: 0,
      lastHz: 0,
      lastGain: Number.NaN,
    };
  }

  private tuneSynth(voice: SynthVoice, frequency: number): void {
    const timbre = TIMBRES[voice.instrument];
    const cents = voice.lastHz > 0 ? Math.abs(1200 * Math.log2(frequency / voice.lastHz)) : 1200;
    // Assign the frequency directly. A glide scheduled on every simulation
    // tick never finishes, and the piled-up fades drive the pitch down to silence.
    if (voice.fresh || cents >= 1) {
      voice.oscillator.frequency.value = frequency;
      voice.filter.frequency.value = cutoffHz(frequency, timbre);
      voice.fresh = false;
      voice.lastHz = frequency;
    }
  }

  /** Keep a recorded note sounding: re-strike before the last stroke fades. */
  private bow(voice: SampledVoice, frequency: number, level: number): void {
    if (!this.tone) {
      return;
    }
    const spec = SAMPLED_INSTRUMENTS[voice.instrument];
    const bowSeconds = spec?.bowSeconds ?? 2.5;
    if (level !== voice.lastGain) {
      voice.lastGain = level;
      voice.gain.gain.rampTo(level, 0.05);
    }
    if (level <= 0) {
      return;
    }
    const now = this.tone.now();
    const cents = voice.lastHz > 0 ? Math.abs(1200 * Math.log2(frequency / voice.lastHz)) : 1200;
    const retune = cents >= 50;
    if (retune && voice.lastHz > 0) {
      voice.sampler.releaseAll(now);
      voice.nextBow = now;
    }
    if (now >= voice.nextBow - 0.1) {
      const when = Math.max(now, voice.nextBow);
      voice.sampler.triggerAttackRelease(frequency, bowSeconds, when, 0.8);
      voice.nextBow = when + bowSeconds - BOW_OVERLAP_SECONDS;
      voice.lastHz = frequency;
    }
  }

  /** The shared polyphonic sampler for pulses, or null while recordings load. */
  private recordedSampler(instrument: InstrumentId): Sampler | null {
    const set = this.sampleSet(instrument);
    const spec = SAMPLED_INSTRUMENTS[instrument];
    if (!set?.loaded || !spec || !this.bus) {
      return null;
    }
    if (!set.pulses) {
      set.pulses = this.samplerFrom(set.buffers, spec);
      set.pulses.connect(this.bus);
    }
    return set.pulses;
  }

  /** Begin loading an instrument's recordings on first request. */
  private sampleSet(instrument: InstrumentId): SampleSet | null {
    const spec = SAMPLED_INSTRUMENTS[instrument];
    if (!spec || !this.tone) {
      return null;
    }
    const existing = this.samples.get(instrument);
    if (existing) {
      return existing;
    }
    // Each file is added on its own so one missing recording costs one note,
    // and the rest of the instrument still arrives.
    const buffers = new this.tone.ToneAudioBuffers();
    let settleReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      settleReady = resolve;
    });
    const set: SampleSet = { buffers, loaded: false, failed: false, pulses: null, ready };
    const urls = sampleUrls(spec);
    let pending = Object.keys(urls).length;
    let arrived = 0;
    const settle = (): void => {
      pending -= 1;
      if (pending > 0) {
        return;
      }
      if (arrived > 0) {
        set.loaded = true;
      } else {
        set.failed = true;
      }
      settleReady();
    };
    for (const [note, file] of Object.entries(urls)) {
      buffers.add(
        note,
        `${SAMPLE_BASE_URL}${spec.folder}/${file}`,
        () => {
          arrived += 1;
          settle();
        },
        () => settle(),
      );
    }
    this.samples.set(instrument, set);
    return set;
  }

  private samplerFrom(buffers: ToneAudioBuffers, spec: SampledInstrument): Sampler {
    if (!this.tone) {
      throw new Error('Audio has not started.');
    }
    const samples: Record<string, ToneAudioBuffer> = {};
    for (const note of spec.notes) {
      if (buffers.has(note)) {
        samples[note] = buffers.get(note);
      }
    }
    return new this.tone.Sampler(samples, { release: spec.release, volume: -3 });
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

  private async connectOutput(tone: ToneModule): Promise<void> {
    if (!this.limiter) {
      return;
    }
    const raw = tone.getContext().rawContext;
    if (!addAudioWorkletModule || !StandardizedAudioWorkletNode) {
      this.limiter.toDestination();
      this.recorderError = 'AudioWorklet recording is not supported by this browser.';
      return;
    }
    const context = raw as unknown as IAudioContext;
    try {
      await addAudioWorkletModule(context, 'harmonia-recorder.worklet.js');
      const recorder = new StandardizedAudioWorkletNode(context, 'harmonia-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      recorder.port.onmessage = (event: MessageEvent<RecorderChunkMessage | string>): void => {
        if (typeof event.data === 'string') {
          return;
        }
        this.recordedLeft.push(event.data.left);
        this.recordedRight.push(event.data.right);
      };
      this.limiter.connect(recorder as unknown as AudioNode);
      recorder.connect(context.destination);
      this.recorder = recorder;
    } catch (error) {
      this.limiter.toDestination();
      this.recorderError =
        error instanceof Error ? error.message : 'The audio recorder could not start.';
    }
  }
}

function disposeVoice(voice: Voice): void {
  if (voice.kind === 'synth') {
    voice.oscillator.dispose();
    voice.filter.dispose();
  } else {
    voice.sampler.releaseAll();
    voice.sampler.dispose();
  }
  voice.gain.dispose();
}

/** Lowpass corner that follows the pitch, kept under the oscillator cap. */
export function cutoffHz(frequencyHz: number, timbre: Timbre): number {
  return Math.min(12000, Math.max(80, frequencyHz * timbre.cutoff));
}

/** Sawtooth and square waves carry more energy than a sine at the same gain. */
export function loudnessTrim(timbre: Timbre): number {
  const wave = String(timbre.wave);
  if (wave.startsWith('sawtooth')) {
    return 0.45;
  }
  if (wave.startsWith('square')) {
    return 0.4;
  }
  if (wave.startsWith('triangle')) {
    return 0.75;
  }
  return 1;
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
