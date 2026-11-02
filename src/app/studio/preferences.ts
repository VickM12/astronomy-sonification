export const PREFERENCE_KEY = 'harmonia-mundi.preferences.v1';

export interface StudioPreferences {
  epochIso: string;
  speedDaysPerSecond: number;
  hiddenPlanetIds: string[];
  showOrbits: boolean;
  showTrails: boolean;
}

export function loadPreferences(): StudioPreferences | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(PREFERENCE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isPreferences(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function savePreferences(preferences: StudioPreferences): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preferences));
  } catch {
    // A full or blocked store should not stop the simulation.
  }
}

function isPreferences(value: unknown): value is StudioPreferences {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['epochIso'] === 'string' &&
    typeof record['speedDaysPerSecond'] === 'number' &&
    Array.isArray(record['hiddenPlanetIds']) &&
    record['hiddenPlanetIds'].every((id) => typeof id === 'string') &&
    typeof record['showOrbits'] === 'boolean' &&
    typeof record['showTrails'] === 'boolean'
  );
}
