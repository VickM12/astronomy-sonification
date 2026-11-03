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

Also in this build: Jupiter's Galilean moons, from `JupiterMoons`, drawn around Jupiter and pitched with one shared factor so their period ratios stay intact. Next alignment seeks to the next planet–planet conjunction or opposition.

## Milestone 2 — Scientific audio

Status: implemented for live playback.

- Uniform scaling and octave folding of `1 / (P × 86400)`.
- Velocity-modulated pitch from `r × v`.
- Independent drone, meridian-pulse, and alignment voices.
- A panel that shows the measurement, the formula, and the hertz.
- Tone.js voices, a master limiter, and start/stop cleanup.
- Tests for the frequency mappings and the audio lifecycle.

## Milestone 3 — Musical interpretation

Status: implemented for live playback.

- Scale quantization that can be turned off.
- Crossing events as rhythm, with an audio-seconds-per-day control that is neither the simulation speed nor the BPM.
- Harmony from the pitches that are sounding together.
- Per-planet instrument, mute, solo, and gain.

The astronomical simulation stays the one built in Milestone 1.

## Milestone 4 — Visualization and interaction

Status: not started.

- Tighter coupling of highlights to sounding notes.
- Mixer polish and a pass over small screens.
- Playback, seek, and speed changes stay visually aligned with the simulation clock.

## Milestone 5 — Export

Status: live WAV, MIDI, spectral image, and PDF score exports are implemented. JSON presets are
not started.

- A Start/Stop recorder captures the post-limiter stereo mix for up to five minutes. All four
  exports use that same take, including live pitch, mix, visibility, instrument, and tempo changes.
- Spectral SVG of the recorded sounding hertz, with ticks for pulses that actually played.
- Sheet music as a PDF written by `src/app/export/score-engraving.ts` with no PDF library: a 4/4 score, one part per sounding planet, quarters and eighths at meridian crossings and alignments, rests elsewhere, Times for words and vector paths for every musical glyph. The first page states the tempo and how many simulated days one quarter note spans. The written pitch is the nearest equal-tempered note, and the page says so.
- Stereo 16-bit PCM WAV from the browser audio graph.
- Format-1 MIDI with body tracks, tempo changes, drones, pulses, gains, and documented General MIDI
  instrument approximations.
- JSON preset import and export.

The render must use the simulation clock, not the animation frame.
