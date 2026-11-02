import { compressDistance, moonSceneOffset, toScenePosition, toVisualPosition } from './visual-scale';

describe('visual scale', () => {
  it('compresses distance monotonically and keeps the direction', () => {
    expect(compressDistance(4)).toBeGreaterThan(compressDistance(1));
    expect(compressDistance(0)).toBe(0);

    const visual = toVisualPosition({ x: 3, y: 4, z: 0 });
    expect(Math.hypot(visual.x, visual.y, visual.z)).toBeCloseTo(compressDistance(5), 12);
    expect(visual.x / visual.y).toBeCloseTo(3 / 4, 12);

    const scene = toScenePosition({ x: 1, y: 0, z: 2 });
    expect(scene.y).toBeCloseTo(toVisualPosition({ x: 1, y: 0, z: 2 }).z, 12);
    expect(scene.z).toBeCloseTo(toVisualPosition({ x: 1, y: 0, z: 2 }).y, 12);
  });

  it('offsets a moon from Jupiter without square-root compression', () => {
    const offset = moonSceneOffset({ x: 0.00282, y: 0, z: 0 });
    expect(offset.x).toBeCloseTo(0.00282 * 280, 8);
    expect(offset.y).toBe(0);
    expect(offset.z).toBe(0);
    expect(Math.hypot(offset.x, offset.y, offset.z)).toBeGreaterThan(0.72);
  });
});
