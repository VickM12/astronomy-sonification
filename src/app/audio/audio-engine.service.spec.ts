import { AudioEngineService } from './audio-engine.service';
import { AudioBackend } from './audio-backend';
import { DroneInstruction, PulseInstruction } from '../sonification/plan';

class MemoryBackend implements AudioBackend {
  running = false;
  starts = 0;
  disposed = 0;
  silenced = 0;
  cuts = 0;
  drones: DroneInstruction[] = [];
  pulses: PulseInstruction[] = [];
  mix = { master: -1, reverb: -1, delay: -1 };
  time = 5;

  async start(): Promise<void> {
    this.starts += 1;
    this.running = true;
  }

  currentTime(): number {
    return this.time;
  }

  setMix(masterGain: number, reverb: number, delay: number): void {
    this.mix = { master: masterGain, reverb, delay };
  }

  syncDrones(drones: readonly DroneInstruction[]): void {
    this.drones = [...drones];
  }

  silenceDrones(): void {
    this.silenced += 1;
  }

  schedulePulse(pulse: PulseInstruction): void {
    this.pulses.push(pulse);
  }

  cutPulses(): void {
    this.cuts += 1;
    this.pulses = [];
  }

  dispose(): void {
    this.disposed += 1;
    this.running = false;
  }
}

describe('AudioEngineService', () => {
  const pulse: PulseInstruction = {
    planetId: 'earth',
    frequencyHz: 110,
    gain: 0.2,
    durationSeconds: 0.5,
    when: 5.25,
    instrument: 'sine',
  };

  it('starts once, ignores work before start, and stops on the supplied clock time', async () => {
    const backend = new MemoryBackend();
    const engine = new AudioEngineService(backend);

    engine.schedulePulses([pulse]);
    engine.stop();
    expect(backend.pulses).toEqual([]);
    expect(backend.silenced).toBe(0);

    await expect(engine.start()).resolves.toBe(true);
    await engine.start();
    expect(backend.starts).toBe(1);
    expect(engine.currentTime()).toBe(5);

    engine.schedulePulses([pulse]);
    expect(backend.pulses).toEqual([pulse]);
    expect(backend.pulses[0]?.when).toBe(5.25);

    engine.stop();
    expect(backend.silenced).toBe(1);
    expect(backend.cuts).toBe(1);
    expect(backend.pulses).toEqual([]);

    engine.dispose();
    engine.dispose();
    expect(backend.disposed).toBe(1);
    await expect(engine.start()).resolves.toBe(false);
  });
});
