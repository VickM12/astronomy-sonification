import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { AstronomyService } from '../astronomy/astronomy.service';
import { parseUtcInstant } from '../astronomy/time';
import { describeOrbitalEvent } from '../domain/orbital-event';
import { PLANETS } from '../domain/planets';
import { OrbitalSimulationService } from '../simulation/orbital-simulation.service';
import { SolarSystemView } from '../visualization/solar-system-view';
import { loadPreferences, savePreferences } from './preferences';

@Component({
  selector: 'app-studio',
  imports: [SolarSystemView],
  templateUrl: './studio.html',
})
export class Studio implements OnDestroy {
  protected readonly planets = PLANETS;
  protected readonly simulation = inject(OrbitalSimulationService);
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

  private pulseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const stored = loadPreferences();
    this.hidden.set(stored?.hiddenPlanetIds ?? []);
    this.showOrbits.set(stored?.showOrbits ?? true);
    this.showTrails.set(stored?.showTrails ?? true);
    this.simulation.setSpeed(stored?.speedDaysPerSecond ?? 20);

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

  protected play(): void {
    this.simulation.play();
  }

  protected pause(): void {
    this.simulation.pause();
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

  protected step(days: number): void {
    this.simulation.advanceDays(days);
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
    });
  }
}
