import { AuVector } from '../astronomy/vectors';

/**
 * Display scale. Directions are preserved. Radius is square-root compressed
 * so Mercury and Neptune can share one view. This is not a distance in AU.
 */
export const VISUAL_AU_SCALE = 8;

export function compressDistance(distanceAU: number): number {
  if (!Number.isFinite(distanceAU) || distanceAU <= 0) {
    return 0;
  }
  return Math.sqrt(distanceAU) * VISUAL_AU_SCALE;
}

export function toVisualPosition(positionAU: AuVector): AuVector {
  const distance = Math.hypot(positionAU.x, positionAU.y, positionAU.z);
  if (distance === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  const scale = compressDistance(distance) / distance;
  return {
    x: positionAU.x * scale,
    y: positionAU.y * scale,
    z: positionAU.z * scale,
  };
}

/**
 * Ecliptic coordinates use z as the north pole. Three.js uses y as up,
 * so the ecliptic plane becomes the horizontal plane of the scene.
 */
export function toScenePosition(positionAU: AuVector): AuVector {
  const visual = toVisualPosition(positionAU);
  return { x: visual.x, y: visual.z, z: visual.y };
}
