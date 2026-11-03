import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { AstronomyService } from '../astronomy/astronomy.service';
import { parseUtcInstant } from '../astronomy/time';
import { AudioEngineService } from '../audio/audio-engine.service';
import { SonificationSession } from '../audio/sonification-session';
import { SoundSettingsService } from '../audio/sound-settings.service';
import { describeOrbitalEvent } from '../domain/orbital-event';
import { buildScorePdf } from '../export/score-engraving';
import {
  buildSpectrumSvg,
  captureRecordedPerformance,
  downloadBlob,
  downloadText,
} from '../export/sonification-score';
import { PerformanceCaptureService } from '../export/performance-capture';
import { buildMidi } from '../export/midi';
import { MOONS, isMoonId } from '../domain/moons';
import { PLANETS, planetName } from '../domain/planets';
import { findNextAlignment } from '../simulation/find-alignment';
import { OrbitalSimulationService } from '../simulation/orbital-simulation.service';
import { formatHz } from '../sonification/frequency';
import { heardFrequency } from '../sonification/plan';
import { readPitches } from '../sonification/pitch';
import {
  BEATS,
  INSTRUMENTS,
  REGISTERS,
  ROOTS,
  SCALES,
  instrumentLabel,
  isInstrumentId,
} from '../sonification/sound-model';
import { SolarSystemView } from '../visualization/solar-system-view';
import { loadPreferences, savePreferences } from './preferences';

@Component({
  selector: 'app-studio',
  imports: [SolarSystemView],
  templateUrl: './studio.html',
})
export class Studio implements OnDestroy {
  protected readonly scales = SCALES;
  protected readonly roots = ROOTS;
  protected readonly registers = REGISTERS;
  protected readonly instruments = INSTRUMENTS;
  protected readonly beats = BEATS;
  protected readonly formatHz = formatHz;
  protected readonly planetName = planetName;
  protected readonly heardFrequency = heardFrequency;
  protected readonly simulation = inject(OrbitalSimulationService);
  protected readonly sound = inject(SoundSettingsService);
  protected readonly audio = inject(AudioEngineService);
  private readonly session = inject(SonificationSession);
  private readonly astronomy = inject(AstronomyService);
  protected readonly performance = inject(PerformanceCaptureService);

  protected readonly hidden = signal<string[]>([]);
  protected readonly showOrbits = signal(true);
  protected readonly showTrails = signal(true);
  protected readonly epochText = signal('');
  protected readonly pulsed = signal<ReadonlySet<string>>(new Set());
  protected readonly alignmentText = signal<string | null>(null);
  protected readonly recordingSeconds = signal(0);

  protected readonly bodies = computed(() =>
    this.simulation.moonsEnabled() ? [...PLANETS, ...MOONS] : [...PLANETS],
  );

  /** Comma-separated labels of instruments whose recordings are downloading, or null. */
  protected readonly loadingInstruments = computed(() => {
    const ids = this.audio.loading();
    if (ids.length === 0) {
      return null;
    }
    return ids.map((id) => (isInstrumentId(id) ? instrumentLabel(id) : id)).join(', ');
  });

  protected readonly visiblePlanetIds = computed(() => {
    const planets = PLANETS.filter((planet) => !this.hidden().includes(planet.id)).map(
      (planet) => planet.id,
    );
    if (!this.simulation.moonsEnabled()) {
      return planets;
    }
    const moons = MOONS.filter((moon) => !this.hidden().includes(moon.id)).map((moon) => moon.id);
    return [...planets, ...moons];
  });

  protected readonly trajectories = computed(() => {
    if (!this.showOrbits()) {
      return [];
    }
    const epoch = this.simulation.epoch();
    if (!epoch) {
      return [];
    }
    return this.astronomy.sampleTrajectories(epoch, 128);
  });

  protected readonly moonTrajectories = computed(() => {
    if (!this.showOrbits() || !this.simulation.moonsEnabled()) {
      return [];
    }
    const epoch = this.simulation.epoch();
    if (!epoch) {
      return [];
    }
    return this.astronomy.sampleMoonTrajectories(epoch, 48);
  });

  protected readonly clockText = computed(() => {
    const time = this.simulation.simulationTime();
    return time ? time.toISOString().replace('.000Z', 'Z') : '—';
  });

  protected readonly pitches = computed(() =>
    readPitches(this.simulation.states(), this.sound.pitchSettings()),
  );

  private pulseTimer: ReturnType<typeof setTimeout> | null = null;
  private recordingClock: ReturnType<typeof setInterval> | null = null;
  private recordingWallStart = 0;

  constructor() {
    const stored = loadPreferences();
    this.hidden.set(stored?.hiddenPlanetIds ?? []);
    this.showOrbits.set(stored?.showOrbits ?? true);
    this.showTrails.set(stored?.showTrails ?? true);
    this.simulation.setSpeed(stored?.speedDaysPerSecond ?? 20);
    this.simulation.setMoonsEnabled(stored?.moonsEnabled !== false);
    this.sound.apply(stored?.sound);
    void this.session;

    const fallback = new Date().toISOString();
    const requested = stored?.epochIso ?? fallback;
    try {
      this.applyEpoch(requested, false);
    } catch {
      this.applyEpoch(fallback, true);
    }

    effect(() => {
      this.simulation.hiddenIds.set(this.hidden());
      const hidden = new Set(this.hidden());
      const events = this.simulation.latestEvents();
      const ids = new Set(
        events.flatMap((event) => {
          const participants = event.otherPlanetId
            ? [event.planetId, event.otherPlanetId]
            : [event.planetId];
          if (participants.some((id) => hidden.has(id))) {
            return [];
          }
          return participants;
        }),
      );
      this.pulsed.set(ids);
      if (this.pulseTimer !== null) {
        clearTimeout(this.pulseTimer);
        this.pulseTimer = null;
      }
      if (ids.size > 0) {
        this.pulseTimer = setTimeout(() => {
          this.pulsed.set(new Set());
          this.pulseTimer = null;
        }, 700);
      }
    });
    effect(() => {
      if (this.audio.recordingLimitReached() && this.performance.recording()) {
        void this.stopRecording();
      }
    });
  }

  protected isHidden(id: string): boolean {
    return this.hidden().includes(id);
  }

  protected isPulsed(id: string): boolean {
    return this.pulsed().has(id);
  }

  protected describe(event: Parameters<typeof describeOrbitalEvent>[0]): string {
    return describeOrbitalEvent(event);
  }

  protected formatAu(value: number, id: string): string {
    return value.toFixed(isMoonId(id) ? 5 : 4);
  }

  protected distanceCaption(id: string): string {
    return isMoonId(id) ? 'From Jupiter' : 'Distance';
  }

  protected longitudeCaption(id: string): string {
    return isMoonId(id) ? 'Around Jupiter' : 'Longitude';
  }

  protected formatSpeed(value: number): string {
    return value.toFixed(5);
  }

  protected formatLongitude(radians: number): string {
    return ((radians * 180) / Math.PI).toFixed(2);
  }

  protected stateFor(id: string) {
    return this.simulation.states().find((state) => state.id === id);
  }

  protected togglePlanet(id: string): void {
    const next = new Set(this.hidden());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.hidden.set([...next]);
    this.remember();
  }

  protected toggleOrbits(): void {
    this.showOrbits.update((value) => !value);
    this.remember();
  }

  protected toggleTrails(): void {
    this.showTrails.update((value) => !value);
    this.remember();
  }

  protected async play(): Promise<void> {
    await this.audio.start();
    this.simulation.play();
  }

  protected pause(): void {
    if (this.performance.recording()) {
      void this.stopRecording();
      return;
    }
    this.simulation.pause();
    this.audio.stop();
  }

  protected reset(): void {
    this.alignmentText.set(null);
    this.simulation.reset();
  }

  protected setMoons(event: Event): void {
    const checked = checkedFrom(event);
    if (checked === null) {
      return;
    }
    this.alignmentText.set(null);
    this.simulation.setMoonsEnabled(checked);
    this.remember();
  }

  protected jumpToAlignment(): void {
    const time = this.simulation.simulationTime();
    if (!time) {
      return;
    }
    const event = findNextAlignment(this.astronomy, time);
    if (!event) {
      this.alignmentText.set('No planetary conjunction or opposition in the next 800 days.');
      return;
    }
    if (!this.simulation.seek(event.simulationTime)) {
      return;
    }
    this.epochText.set(event.simulationTime.toISOString().replace('.000Z', 'Z'));
    this.alignmentText.set(describeOrbitalEvent(event));
    this.remember();
  }

  protected jumpToToday(): void {
    this.applyEpoch(new Date().toISOString(), true);
  }

  ngOnDestroy(): void {
    if (this.pulseTimer !== null) {
      clearTimeout(this.pulseTimer);
    }
    this.clearRecordingClock();
    this.performance.cancel();
    this.pause();
  }

  protected commitEpoch(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    try {
      this.applyEpoch(target.value, true);
    } catch (error) {
      this.simulation.error.set(
        error instanceof Error ? error.message : 'That UTC instant is not supported.',
      );
    }
  }

  protected commitSpeed(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    this.simulation.setSpeed(Number(target.value));
    this.remember();
  }

  protected chooseSpeed(daysPerSecond: number): void {
    this.simulation.setSpeed(daysPerSecond);
    this.remember();
  }

  protected async step(days: number): Promise<void> {
    this.alignmentText.set(null);
    await this.audio.start();
    this.simulation.advanceDays(days);
  }

  protected chooseMode(event: Event): void {
    const value = textFrom(event);
    if (value !== null) {
      this.sound.setMode(value);
      this.remember();
    }
  }

  protected chooseMapping(event: Event): void {
    const value = textFrom(event);
    if (value !== null) {
      this.sound.setMapping(value);
      this.remember();
    }
  }

  protected chooseRegister(event: Event): void {
    const value = textFrom(event);
    if (value !== null) {
      this.sound.setRegister(value);
      this.remember();
    }
  }

  protected chooseScale(event: Event): void {
    const value = textFrom(event);
    if (value !== null) {
      this.sound.setScale(value);
      this.remember();
    }
  }

  protected chooseRoot(event: Event): void {
    const value = numberFrom(event);
    if (value !== null) {
      this.sound.setRoot(value);
      this.remember();
    }
  }

  protected chooseBeats(event: Event): void {
    const value = numberFrom(event);
    if (value !== null) {
      this.sound.setBeats(value);
      this.remember();
    }
  }

  protected chooseInstrument(id: string, event: Event): void {
    const value = textFrom(event);
    if (value !== null) {
      this.sound.setInstrument(id, value);
      this.remember();
    }
  }

  protected setVelocity(event: Event): void {
    const checked = checkedFrom(event);
    if (checked !== null) {
      this.sound.setMotion(checked);
      this.remember();
    }
  }

  protected setQuantize(event: Event): void {
    const checked = checkedFrom(event);
    if (checked !== null) {
      this.sound.quantize.set(checked);
      this.remember();
    }
  }

  protected setFlag(flag: 'drones' | 'pulses' | 'alignments', event: Event): void {
    const checked = checkedFrom(event);
    if (checked === null) {
      return;
    }
    this.sound[flag].set(checked);
    this.remember();
  }

  protected setDepth(event: Event): void {
    const value = numberFrom(event);
    if (value !== null) {
      this.sound.setDepth(value);
      this.remember();
    }
  }

  protected setMaster(event: Event): void {
    const value = numberFrom(event);
    if (value !== null) {
      this.sound.setMaster(value);
      this.remember();
    }
  }

  protected setReverb(event: Event): void {
    const value = numberFrom(event);
    if (value !== null) {
      this.sound.setReverb(value);
      this.remember();
    }
  }

  protected setDelay(event: Event): void {
    const value = numberFrom(event);
    if (value !== null) {
      this.sound.setDelay(value);
      this.remember();
    }
  }

  protected setHarmony(event: Event): void {
    const value = numberFrom(event);
    if (value !== null) {
      this.sound.setHarmony(value);
      this.remember();
    }
  }

  protected setTempo(event: Event): void {
    const value = numberFrom(event);
    if (value !== null) {
      this.sound.setTempo(value);
      this.remember();
    }
  }

  protected setCompression(event: Event): void {
    const value = numberFrom(event);
    if (value !== null) {
      this.sound.setCompression(value);
      this.remember();
    }
  }

  protected setPlanetGain(id: string, event: Event): void {
    const value = numberFrom(event);
    if (value !== null) {
      this.sound.setGain(id, value);
      this.remember();
    }
  }

  protected exportSpectrum(): void {
    const capture = this.recordedCapture();
    if (!capture) return;
    downloadText('harmonia-mundi-spectrum.svg', 'image/svg+xml', buildSpectrumSvg(capture));
  }

  protected exportSheet(): void {
    const capture = this.recordedCapture();
    if (!capture) return;
    downloadText('harmonia-mundi-score.pdf', 'application/pdf', buildScorePdf(capture));
  }

  protected exportWav(): void {
    const take = this.performance.latest();
    if (take) downloadBlob('harmonia-mundi-performance.wav', take.wav);
  }

  protected exportMidi(): void {
    const take = this.performance.latest();
    if (take) {
      const midi = buildMidi(take);
      const bytes = new ArrayBuffer(midi.byteLength);
      new Uint8Array(bytes).set(midi);
      downloadBlob('harmonia-mundi-performance.mid', new Blob([bytes], { type: 'audio/midi' }));
    }
  }

  protected async startRecording(): Promise<void> {
    if (this.performance.latest() && !window.confirm('Replace the previous recording?')) {
      return;
    }
    const time = this.simulation.simulationTime();
    if (!time || !(await this.audio.start())) {
      return;
    }
    try {
      const snapshot = this.sound.snapshot();
      await this.audio.prepareInstruments([
        ...new Set(Object.values(snapshot.planets).map((mix) => mix.instrument)),
      ]);
      this.audio.startRecording();
      this.performance.begin(this.audio.currentTime(), time, snapshot.tempoBpm);
      this.recordingWallStart = performance.now();
      this.recordingSeconds.set(0);
      this.recordingClock = setInterval(() => {
        this.recordingSeconds.set((performance.now() - this.recordingWallStart) / 1000);
      }, 200);
      this.simulation.play();
    } catch (error) {
      this.audio.error.set(error instanceof Error ? error.message : 'Recording could not start.');
      this.performance.cancel();
    }
  }

  protected async stopRecording(): Promise<void> {
    if (!this.performance.recording()) {
      return;
    }
    this.simulation.pause();
    this.clearRecordingClock();
    try {
      const stopAudioTime = this.audio.currentTime();
      const wav = await this.audio.stopRecording();
      const time = this.simulation.simulationTime();
      if (time) {
        this.performance.finish(stopAudioTime, time, wav);
      }
    } catch (error) {
      this.performance.cancel();
      this.audio.error.set(error instanceof Error ? error.message : 'Recording could not stop.');
    } finally {
      this.audio.stop();
    }
  }

  protected formatRecordingTime(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  private recordedCapture() {
    const take = this.performance.latest();
    return take ? captureRecordedPerformance(take) : null;
  }

  private clearRecordingClock(): void {
    if (this.recordingClock !== null) {
      clearInterval(this.recordingClock);
      this.recordingClock = null;
    }
  }

  protected setMuted(id: string, event: Event): void {
    const checked = checkedFrom(event);
    if (checked !== null) {
      this.sound.setMuted(id, checked);
      this.remember();
    }
  }

  protected setSolo(id: string, event: Event): void {
    const checked = checkedFrom(event);
    if (checked !== null) {
      this.sound.setSolo(id, checked);
      this.remember();
    }
  }

  private applyEpoch(value: string, persist: boolean): void {
    this.alignmentText.set(null);
    const date = parseUtcInstant(value.trim());
    const accepted = this.simulation.setEpoch(date);
    if (!accepted) {
      return;
    }
    this.epochText.set(date.toISOString().replace('.000Z', 'Z'));
    if (persist) {
      this.remember();
    }
  }

  private remember(): void {
    const epoch = this.simulation.epoch();
    if (!epoch) {
      return;
    }
    savePreferences({
      epochIso: epoch.toISOString(),
      speedDaysPerSecond: this.simulation.speedDaysPerSecond(),
      hiddenPlanetIds: this.hidden(),
      showOrbits: this.showOrbits(),
      showTrails: this.showTrails(),
      moonsEnabled: this.simulation.moonsEnabled(),
      sound: this.sound.snapshot(),
    });
  }
}

function textFrom(event: Event): string | null {
  const target = event.target;
  if (target instanceof HTMLSelectElement || target instanceof HTMLInputElement) {
    return target.value;
  }
  return null;
}

function numberFrom(event: Event): number | null {
  const text = textFrom(event);
  if (text === null) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function checkedFrom(event: Event): boolean | null {
  const target = event.target;
  return target instanceof HTMLInputElement ? target.checked : null;
}
