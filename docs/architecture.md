# Architecture

Harmonia Mundi is an Angular 21 application with standalone components. There is no backend. Five layers stay separate so a later audio engine can subscribe to the simulation without calculating orbits of its own.

```text
UTC date
  → AstronomyService
  → OrbitalSimulationService
  → Studio panels and SolarSystemView
```

Audio will sit beside the view, reading the same states and events. It is not implemented.

## Packages

| Package | Version | Role |
| --- | --- | --- |
| Angular | 21.2 | UI, routing, signals |
| `astronomy-engine` | 2.1.19 | VSOP87 heliocentric state vectors |
| `three` | 0.187.0 | Orrery rendering |
| Vitest | 4, via `@angular/build:unit-test` | Unit tests |

`tone` 15.1.22 is the planned synthesis library. It is not installed yet.

Angular 22.2 is the current stable line, but it requires Node `^22.22.3`, `^24.15.0`, or `^26`. This environment is Node 24.14.1, so the app stays on Angular 21.2, the newest stable line that accepts that runtime.

## Astronomy layer

`AstronomyService` is the only code that calls Astronomy Engine.

`HelioState` returns a heliocentric position and velocity in J2000 mean equatorial coordinates (EQJ), in AU and AU/day. `RotateState(Rotation_EQJ_ECL(), state)` rotates both vectors into the J2000 mean ecliptic (ECL). That rotation is constant because it uses the mean obliquity at J2000. Distance and speed are the Euclidean lengths of the rotated vectors. Ecliptic longitude is `atan2(y, x)`.

Orbital periods are the sidereal periods published on the NASA NSSDCA individual planet fact sheets. They are constants, not circular-orbit fits. The summary fact sheet's single "Orbital Period" column is the tropical period and is not used.

States are cached by planet and millisecond timestamp. The cache is private to this service.

`sampleTrajectory` asks the same service for positions spread across one sidereal period. The view draws those points. It does not fit an ellipse and it does not draw a circle in their place.

## Simulation layer

`OrbitalSimulationService` owns the simulation clock.

- The epoch is the UTC instant Reset returns to.
- Speed is simulated days per real-time second. It can be negative.
- `play` starts a 32 ms interval. Each tick measures wall-clock time with `performance.now` and advances the epoch by `elapsed seconds × speed`.
- One tick accepts at most 5 real seconds and 2000 simulated days. A background tab therefore does not replay the entire hidden interval, and a fast setting cannot ask the detector for millions of crossings in one turn.
- `seek` and `setEpoch` move straight to a date. They do not emit the crossings that were skipped. Longitude anchors are rebuilt from the longitudes at the destination.
- `advanceDays` is the step used by the clock, the step buttons, and the tests. Rendering never calls it.

The animation frame in `SolarSystemView` only reads `states()`, `latestEvents()`, and `trailGeneration()`, then draws. Frame rate does not accumulate simulation time.

### Events

`detectOrbitalEvents` is a pure function.

Planetary longitudes from the ephemeris are wrapped to `[0, 2π)`. Between two samples the unwrapped change is the short angle plus the whole number of turns closest to mean motion `2π Δt / period`. That choice is unique for these planets because the periodic difference between true longitude and mean longitude stays far below half a turn, including over a step of many years.

Crossings use a half-open interval `(previous, next]`:

- reference meridian: ecliptic longitude `0`
- revolution: the longitude stored when the tracks were created
- conjunction: the difference of two unwrapped longitudes crosses a multiple of `2π`
- opposition: that difference crosses `π` plus a multiple of `2π`

The time of a crossing is the linear fraction of longitude between the two samples. A later audio engine can schedule from that timestamp. It is not yet a musical event.

If a step contains more than 5000 crossings, the extras are counted in `omittedEventCount` and the positions at the end of the step are still the calculated states.

## Visualization layer

`SolarSystemView` maps ecliptic `(x, y, z)` to Three.js `(x, z, y)` so the ecliptic lies on the horizontal plane. Radius on screen is `8 √(distance in AU)`. Planet meshes use fixed scene radii. Both distortions are labeled in the observatory.

Orbit lines are rebuilt when the epoch or the orbit toggle changes, not on every frame. Trails store recent rendered positions and are cleared when `trailGeneration` changes, which happens on every seek.

`three` 0.187.0 no longer ships its own `.d.ts` files. `@types/three` 0.187.0 supplies the compiler types, including `OrbitControls`.

## Interface

`Studio` is the observatory route. `About` explains the time base and the boundary of this milestone. Preferences live in `localStorage` under `harmonia-mundi.preferences.v1`.

`SonificationEngine` is declared in `domain/sonification.ts` so the later engines share one event shape. Nothing implements it yet.

## Integration risks

- Astronomy Engine throws strings, not `Error` objects. Call sites normalize both.
- `Date` cannot represent a non-finite instant. Those inputs are rejected and the clock stays where it was.
- VSOP87 is a series centered on the modern era. Dates many millennia from J2000 still evaluate, but they are not a high-accuracy ephemeris. The UI does not relabel them as measured positions.
- Event times inside a long step are linear in longitude. Counts are stable across step size. Times get more accurate as the step gets shorter.
- WebGL is required for the orrery. Without it, the side panels still show the calculated numbers.
- The production bundle includes Three.js, so the Angular size budget is raised to 2 MB.
