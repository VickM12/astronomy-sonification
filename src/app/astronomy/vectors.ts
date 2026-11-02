export interface AuVector {
  x: number;
  y: number;
  z: number;
}

export function vectorLength(vector: AuVector): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

/** Ecliptic longitude in radians, in the half-open range [0, 2π). */
export function eclipticLongitudeRad(position: AuVector): number {
  const tau = Math.PI * 2;
  const angle = Math.atan2(position.y, position.x);
  return angle < 0 ? angle + tau : angle;
}
