import { PREFERENCE_KEY, loadPreferences, savePreferences } from './preferences';

describe('preferences', () => {
  afterEach(() => {
    localStorage.removeItem(PREFERENCE_KEY);
  });

  it('round-trips studio settings through local storage', () => {
    savePreferences({
      epochIso: '2000-01-01T12:00:00.000Z',
      speedDaysPerSecond: -20,
      hiddenPlanetIds: ['venus'],
      showOrbits: false,
      showTrails: true,
    });

    expect(loadPreferences()).toEqual({
      epochIso: '2000-01-01T12:00:00.000Z',
      speedDaysPerSecond: -20,
      hiddenPlanetIds: ['venus'],
      showOrbits: false,
      showTrails: true,
    });
  });

  it('ignores a stored value that does not match the preference shape', () => {
    localStorage.setItem(PREFERENCE_KEY, '{"epochIso":"nope"}');
    expect(loadPreferences()).toBeNull();
  });
});
