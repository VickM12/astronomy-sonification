import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  LineLoop,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrajectorySample } from '../astronomy/astronomy.service';
import { OrbitalEvent } from '../domain/orbital-event';
import { MOONS, moonProfile } from '../domain/moons';
import { PLANETS, planetProfile } from '../domain/planets';
import { PlanetaryState } from '../domain/planetary-state';
import { OrbitalSimulationService } from '../simulation/orbital-simulation.service';
import { moonSceneOffset, toScenePosition } from './visual-scale';

interface PlanetBody {
  mesh: Mesh;
  material: MeshStandardMaterial;
  color: number;
}

const TRAIL_LIMIT = 280;
const PULSE_MS = 700;

/**
 * Renders simulation states. It does not advance time and does not
 * calculate planetary positions.
 */
@Component({
  selector: 'app-solar-system-view',
  templateUrl: './solar-system-view.html',
  host: { class: 'solar-view' },
})
export class SolarSystemView implements AfterViewInit, OnDestroy {
  readonly trajectories = input<readonly TrajectorySample[]>([]);
  readonly moonTrajectories = input<readonly TrajectorySample[]>([]);
  readonly visiblePlanetIds = input<readonly string[]>([]);
  readonly showOrbits = input(true);
  readonly showTrails = input(true);

  protected readonly webglError = signal<string | null>(null);

  private readonly simulation = inject(OrbitalSimulationService);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly frameRef = viewChild.required<ElementRef<HTMLElement>>('frame');

  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private observer: ResizeObserver | null = null;
  private readonly bodies = new Map<string, PlanetBody>();
  private moonRig: Group | null = null;
  private readonly orbitByPlanet = new Map<string, LineLoop>();
  private readonly moonOrbitById = new Map<string, LineLoop>();
  private readonly trailByPlanet = new Map<string, { line: Line; points: number[] }>();
  private appliedTrajectories: readonly TrajectorySample[] | null = null;
  private appliedMoonTrajectories: readonly TrajectorySample[] | null = null;
  private appliedShowOrbits = true;
  private appliedMoonShowOrbits = true;
  private trailsCleared = false;
  private appliedGeneration = -1;
  private seenEvents: readonly OrbitalEvent[] | null = null;
  private readonly pulseUntil = new Map<string, number>();
  private lastTrailTime = Number.NaN;

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    try {
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) {
        this.webglError.set(
          'WebGL is not available here. Planet positions are still listed beside the view.',
        );
        return;
      }
      this.createScene(canvas);
    } catch (error) {
      this.webglError.set(
        error instanceof Error ? error.message : 'The orbital view could not start.',
      );
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.renderer?.setAnimationLoop(null);
    this.controls?.dispose();
    this.disposeOrbits();
    this.disposeMoonOrbits();
    this.disposeTrails();
    for (const body of this.bodies.values()) {
      body.mesh.geometry.dispose();
      body.material.dispose();
    }
    this.renderer?.dispose();
  }

  private createScene(canvas: HTMLCanvasElement): void {
    const scene = new Scene();
    scene.background = null;
    const camera = new PerspectiveCamera(42, 1, 0.1, 500);
    camera.position.set(18, 28, 26);

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 160;
    controls.target.set(0, 0, 0);

    scene.add(new AmbientLight(0x8ea0c0, 0.55));
    const sunLight = new PointLight(0xfff1cf, 40, 0, 1.4);
    sunLight.position.set(0, 0, 0);
    scene.add(sunLight);

    const sun = new Mesh(
      new SphereGeometry(1.15, 32, 24),
      new MeshBasicMaterial({ color: 0xffd27a }),
    );
    scene.add(sun);

    for (const planet of PLANETS) {
      const geometry = new SphereGeometry(planet.sceneRadius, 28, 20);
      const material = new MeshStandardMaterial({
        color: planet.sceneColor,
        roughness: 0.72,
        metalness: 0.05,
        emissive: 0x000000,
      });
      const mesh = new Mesh(geometry, material);
      scene.add(mesh);
      this.bodies.set(planet.id, { mesh, material, color: planet.sceneColor });
    }

    const moonRig = new Group();
    scene.add(moonRig);
    this.moonRig = moonRig;
    for (const moon of MOONS) {
      const geometry = new SphereGeometry(moon.sceneRadius, 16, 12);
      const material = new MeshStandardMaterial({
        color: moon.sceneColor,
        roughness: 0.62,
        metalness: 0.04,
        emissive: 0x000000,
      });
      const mesh = new Mesh(geometry, material);
      moonRig.add(mesh);
      this.bodies.set(moon.id, { mesh, material, color: moon.sceneColor });
    }

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.frameRef().nativeElement);
    this.resize();
    renderer.setAnimationLoop(() => this.renderFrame());
  }

  private renderFrame(): void {
    if (!this.renderer || !this.scene || !this.camera || !this.controls) {
      return;
    }
    this.notePulses();
    this.syncOrbits();
    this.syncMoonOrbits();
    const states = this.simulation.states();
    this.syncBodies(states);
    this.syncTrails(states);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private notePulses(): void {
    const generation = this.simulation.trailGeneration();
    if (generation !== this.appliedGeneration) {
      this.appliedGeneration = generation;
      this.pulseUntil.clear();
      this.clearTrailPoints();
      this.lastTrailTime = Number.NaN;
    }

    const events = this.simulation.latestEvents();
    if (events === this.seenEvents) {
      return;
    }
    this.seenEvents = events;
    const until = performance.now() + PULSE_MS;
    const visible = new Set(this.visiblePlanetIds());
    for (const event of events) {
      const participants = event.otherPlanetId
        ? [event.planetId, event.otherPlanetId]
        : [event.planetId];
      if (participants.some((id) => !visible.has(id))) {
        continue;
      }
      for (const id of participants) {
        this.pulseUntil.set(id, until);
      }
    }
  }

  private syncBodies(states: readonly PlanetaryState[]): void {
    const visible = new Set(this.visiblePlanetIds());
    const present = new Set(states.map((state) => state.id));
    const now = performance.now();
    const jupiter = states.find((state) => state.id === 'jupiter');
    const jupiterScene = jupiter ? toScenePosition(jupiter.positionAU) : null;
    if (this.moonRig && jupiterScene) {
      this.moonRig.position.set(jupiterScene.x, jupiterScene.y, jupiterScene.z);
    }
    for (const [id, body] of this.bodies) {
      if (!present.has(id)) {
        body.mesh.visible = false;
        const orbit = this.orbitByPlanet.get(id) ?? this.moonOrbitById.get(id);
        if (orbit) {
          orbit.visible = false;
        }
      }
    }
    for (const state of states) {
      const body = this.bodies.get(state.id);
      const orbit = this.orbitByPlanet.get(state.id) ?? this.moonOrbitById.get(state.id);
      if (!body) {
        continue;
      }
      const show = visible.has(state.id);
      body.mesh.visible = show;
      if (orbit) {
        orbit.visible = show && this.showOrbits();
      }
      if (state.frame === 'jovicentric') {
        const offset = moonSceneOffset(state.positionAU);
        body.mesh.position.set(offset.x, offset.y, offset.z);
      } else {
        const scenePoint = toScenePosition(state.positionAU);
        body.mesh.position.set(scenePoint.x, scenePoint.y, scenePoint.z);
      }
      const pulsing = (this.pulseUntil.get(state.id) ?? 0) > now;
      body.material.emissive.setHex(pulsing ? 0xffe7b8 : 0x000000);
      body.material.emissiveIntensity = pulsing ? 0.9 : 0;
      if (orbit) {
        const material = orbit.material;
        if (material instanceof LineBasicMaterial) {
          material.color.setHex(pulsing ? 0xffe7b8 : body.color);
          material.opacity = pulsing ? 0.95 : 0.45;
        }
      }
    }
  }

  private syncOrbits(): void {
    const trajectories = this.trajectories();
    const showOrbits = this.showOrbits();
    if (trajectories === this.appliedTrajectories && showOrbits === this.appliedShowOrbits) {
      return;
    }
    this.appliedTrajectories = trajectories;
    this.appliedShowOrbits = showOrbits;
    this.disposeOrbits();
    if (!this.scene || !showOrbits) {
      return;
    }
    for (const trajectory of trajectories) {
      const profile = planetProfile(trajectory.planetId);
      const positions = new Float32Array(trajectory.positionsAU.length * 3);
      trajectory.positionsAU.forEach((point, index) => {
        const scenePoint = toScenePosition(point);
        positions[index * 3] = scenePoint.x;
        positions[index * 3 + 1] = scenePoint.y;
        positions[index * 3 + 2] = scenePoint.z;
      });
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      const material = new LineBasicMaterial({
        color: profile?.sceneColor ?? 0x9eb0c4,
        transparent: true,
        opacity: 0.45,
      });
      const line = new LineLoop(geometry, material);
      this.scene.add(line);
      this.orbitByPlanet.set(trajectory.planetId, line);
    }
  }

  private syncMoonOrbits(): void {
    const trajectories = this.moonTrajectories();
    const showOrbits = this.showOrbits();
    if (trajectories === this.appliedMoonTrajectories && showOrbits === this.appliedMoonShowOrbits) {
      return;
    }
    this.appliedMoonTrajectories = trajectories;
    this.appliedMoonShowOrbits = showOrbits;
    this.disposeMoonOrbits();
    if (!this.moonRig || !showOrbits) {
      return;
    }
    for (const trajectory of trajectories) {
      const profile = moonProfile(trajectory.planetId);
      const positions = new Float32Array(trajectory.positionsAU.length * 3);
      trajectory.positionsAU.forEach((point, index) => {
        const scenePoint = moonSceneOffset(point);
        positions[index * 3] = scenePoint.x;
        positions[index * 3 + 1] = scenePoint.y;
        positions[index * 3 + 2] = scenePoint.z;
      });
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      const material = new LineBasicMaterial({
        color: profile?.sceneColor ?? 0x9eb0c4,
        transparent: true,
        opacity: 0.55,
      });
      const line = new LineLoop(geometry, material);
      this.moonRig.add(line);
      this.moonOrbitById.set(trajectory.planetId, line);
    }
  }

  private syncTrails(states: readonly PlanetaryState[]): void {
    if (!this.showTrails() || !this.scene) {
      if (!this.trailsCleared) {
        this.clearTrailPoints();
        this.trailsCleared = true;
      }
      return;
    }
    this.trailsCleared = false;
    const stamp = states[0]?.timestamp.getTime();
    if (stamp === undefined || stamp === this.lastTrailTime) {
      return;
    }
    if (Number.isFinite(this.lastTrailTime) && stamp < this.lastTrailTime) {
      this.clearTrailPoints();
    }
    this.lastTrailTime = stamp;
    const visible = new Set(this.visiblePlanetIds());
    const jupiter = states.find((state) => state.id === 'jupiter');
    const jupiterScene = jupiter ? toScenePosition(jupiter.positionAU) : null;
    for (const state of states) {
      if (!visible.has(state.id)) {
        continue;
      }
      const scenePoint =
        state.frame === 'jovicentric' && jupiterScene
          ? addOffset(jupiterScene, moonSceneOffset(state.positionAU))
          : toScenePosition(state.positionAU);
      const trail = this.trailFor(state.id);
      trail.points.push(scenePoint.x, scenePoint.y, scenePoint.z);
      const extra = trail.points.length / 3 - TRAIL_LIMIT;
      if (extra > 0) {
        trail.points.splice(0, extra * 3);
      }
      this.writeTrail(trail);
    }
  }

  private trailFor(planetId: string): { line: Line; points: number[] } {
    const existing = this.trailByPlanet.get(planetId);
    if (existing) {
      return existing;
    }
    const geometry = new BufferGeometry();
    const profile = planetProfile(planetId) ?? moonProfile(planetId);
    const material = new LineBasicMaterial({
      color: profile?.sceneColor ?? 0xffffff,
      transparent: true,
      opacity: 0.8,
    });
    const line = new Line(geometry, material);
    this.scene?.add(line);
    const trail = { line, points: [] as number[] };
    this.trailByPlanet.set(planetId, trail);
    return trail;
  }

  private writeTrail(trail: { line: Line; points: number[] }): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(trail.points), 3));
    trail.line.geometry.dispose();
    trail.line.geometry = geometry;
  }

  private clearTrailPoints(): void {
    for (const trail of this.trailByPlanet.values()) {
      trail.points = [];
      this.writeTrail(trail);
    }
  }

  private disposeOrbits(): void {
    if (!this.scene) {
      this.orbitByPlanet.clear();
      return;
    }
    for (const line of this.orbitByPlanet.values()) {
      this.scene.remove(line);
      line.geometry.dispose();
      if (line.material instanceof LineBasicMaterial) {
        line.material.dispose();
      }
    }
    this.orbitByPlanet.clear();
  }

  private disposeMoonOrbits(): void {
    for (const line of this.moonOrbitById.values()) {
      line.parent?.remove(line);
      line.geometry.dispose();
      if (line.material instanceof LineBasicMaterial) {
        line.material.dispose();
      }
    }
    this.moonOrbitById.clear();
  }

  private disposeTrails(): void {
    if (!this.scene) {
      this.trailByPlanet.clear();
      return;
    }
    for (const trail of this.trailByPlanet.values()) {
      this.scene.remove(trail.line);
      trail.line.geometry.dispose();
      if (trail.line.material instanceof LineBasicMaterial) {
        trail.line.material.dispose();
      }
    }
    this.trailByPlanet.clear();
  }

  private resize(): void {
    if (!this.renderer || !this.camera) {
      return;
    }
    const frame = this.frameRef().nativeElement;
    const width = Math.max(1, frame.clientWidth);
    const height = Math.max(1, frame.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}

function addOffset(
  origin: { x: number; y: number; z: number },
  offset: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z };
}
