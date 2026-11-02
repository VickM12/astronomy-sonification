import { AstronomyService } from '../astronomy/astronomy.service';
import { isPlanetId } from '../domain/planets';
import { findNextAlignment } from './find-alignment';

const START = new Date('2000-01-01T12:00:00.000Z');

describe('findNextAlignment', () => {
  const astronomy = new AstronomyService();

  it('returns the next planet-planet conjunction or opposition', () => {
    const event = findNextAlignment(astronomy, START);
    expect(event).not.toBeNull();
    expect(event?.type === 'conjunction' || event?.type === 'opposition').toBe(true);
    expect(isPlanetId(event?.planetId ?? '')).toBe(true);
    expect(isPlanetId(event?.otherPlanetId ?? '')).toBe(true);
    expect(event?.simulationTime.getTime()).toBeGreaterThan(START.getTime());
    expect(event?.simulationTime.getTime()).toBeLessThanOrEqual(
      START.getTime() + 800 * 86400000,
    );
  });
});
