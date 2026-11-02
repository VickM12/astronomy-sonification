import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { AstronomyService } from '../astronomy/astronomy.service';
import { parseUtcInstant } from '../astronomy/time';
import { AudioEngineService } from '../audio/audio-engine.service';
import { SonificationSession } from '../audio/sonification-session';
import { SoundSettingsService } from '../audio/sound-settings.service';
import { describeOrbitalEvent } from '../domain/orbital-event';
import { PLANETS, planetName } from '../domain/planets';
import { OrbitalSimulationService } from '../simulation/orbital-simulation.service';
import { formatHz } from '../sonification/frequency';
import { heardFrequency } from '../sonification/plan';
import { readPitches } from '../sonification/pitch';
import { BEATS, INSTRUMENTS, REGISTERS, ROOTS, SCALES } from '../sonification/sound-model';
import { SolarSystemView } from '../visualization/solar-system-view';
import { loadPreferences, savePreferences } from './preferences';

@Component({
  selector: 'app-studio',
  imports: [SolarSystemView],
  templateUrl: './studio.html',
})
export class Studio implements OnDestroy {
  protected readonly planets = PLANETS;
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

  protected readonly hidden = signal<string[]>([]);
  protected readonly showOrbits = signal(true);
  protected readonly showTrails = signal(true);
  protected readonly epochText = signal('');
  protected readonly pulsed = signal<ReadonlySet<string>>(new Set());

  protected readonly visiblePlanetIds = computed(() =>
    PLANETS.filter((planet) => !this.hidden().includes(planet.id)).map((planet) => planet.id),
  );

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

  protected readonly clockText = computed(() => {
    const time = this.simulation.simulationTime();
    return time ? time.toISOString().replace('.000Z', 'Z') : '—';
  });

  protected readonly pitches = computed(() =>
    readPitches(this.simulation.states(), this.sound.pitchSettings()),
  );

  private pulseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const stored = loadPreferences();
    this.hidden.set(stored?.hiddenPlanetIds ?? []);
    this.showOrbits.set(stored?.showOrbits ?? true);
    this.showTrails.set(stored?.showTrails ?? true);
    this.simulation.setSpeed(stored?.speedDaysPerSecond ?? 20);
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
      const events = this.simulation.latestEvents();
      const ids = new Set(
        events.flatMap((event) =>
          event.otherPlanetId ? [event.planetId, event.otherPlanetId] : [event.planetId],
        ),
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

  protected formatAu(value: number): string {
    return value.toFixed(4);
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
    this.simulation.pause();
    this.audio.stop();
  }

  protected reset(): void {
    this.simulation.reset();
  }

  protected jumpToToday(): void {
    this.applyEpoch(new Date().toISOString(), true);
  }

  ngOnDestroy(): void {
    if (this.pulseTimer !== null) {
      clearTimeout(this.pulseTimer);
    }
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
