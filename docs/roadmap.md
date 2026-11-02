# Roadmap

## Milestone 1 — Foundation

Status: implemented.

- Angular 21 standalone app, observatory route, and a notes page.
- `PlanetaryState` and the shared `SonificationEngine` contract.
- `AstronomyService` for Mercury through Neptune, in heliocentric J2000 ecliptic coordinates, with NASA sidereal periods and a state cache.
- `OrbitalSimulationService`: play, pause, reset, seek, signed speed, and crossing detection that survives a skipped sample and a reversed step.
- Three.js orrery fed only by those states. Sampled orbit lines, optional trails, and a labeled display scale.
- UTC date entry, Today, and step buttons.
- Preferences in local storage.
- Tests for the J2000 state, trajectory shape, event counts across step sizes, seek, reverse, the simulation clock, and deterministic repeats.

Acceptance: the eight planets are drawn from calculated positions for a chosen UTC date and move when the simulation clock runs.

## Milestone 2 — Scientific audio

Status: not started.

- Uniform scaling and octave folding of `1 / (P × 86400)`.
- Velocity-modulated pitch from `r × v`.
- Independent drone, meridian-pulse, and alignment voices.
- A panel that shows the measurement, the formula, and the hertz.
- Tone.js voices, a master limiter, and start/stop cleanup.
- Tests for the frequency mappings and the audio lifecycle.

## Milestone 3 — Musical interpretation

Status: not started.

- Scale quantization that can be turned off.
- Crossing events as rhythm, with a time-compression control that is not the simulation speed.
- Harmony from the pitches that are sounding together.
- Per-planet instrument, mute, solo, and gain.

The astronomical simulation stays the one built in Milestone 1.

## Milestone 4 — Visualization and interaction

Status: not started.

- Tighter coupling of highlights to sounding notes.
- Mixer polish and a pass over small screens.
- Playback, seek, and speed changes stay visually aligned with the simulation clock.

## Milestone 5 — Export

Status: not started.

- Offline WAV render.
- MIDI, with the pitch approximation written down.
- JSON preset import and export.

The render must use the simulation clock, not the animation frame.
