# Sonification

The music has to be traceable to the ephemeris. This note separates measurements from the mappings that will turn them into sound.

## In this milestone

These quantities are calculated and shown. They are not yet heard.

### State vector

Astronomy Engine `HelioState` provides heliocentric equatorial J2000 position `(x, y, z)` in AU and velocity `(vx, vy, vz)` in AU/day.

The ecliptic state is that vector rotated by `Rotation_EQJ_ECL`. Position and velocity are rotated together.

```text
distance = sqrt(x² + y² + z²)
speed    = sqrt(vx² + vy² + vz²)
longitude = atan2(y, x)     wrapped to [0, 2π)
```

Longitude 0 is the J2000 mean equinox. It is the reference meridian used for crossing events.

### Sidereal period

`P` is the NASA NSSDCA sidereal orbital period in days. See `src/app/astronomy/orbital-periods.ts` for the values and the retrieval date.

The summary fact sheet's "Orbital Period" is the tropical period. A revolution against the inertial ecliptic uses the sidereal period, so that is the constant stored here.

### Crossings

Between samples at `t0` and `t1`, with wrapped longitudes `λ0` and `λ1`:

```text
δ_short = wrap to (−π, π] of (λ1 − λ0)
δ       = δ_short + 2π × round((2π Δt / P − δ_short) / 2π)
```

`Δt` is `t1 − t0` in UT days. A reference-meridian event is each multiple of `2π` in the half-open unwrapped interval. A revolution uses the longitude captured at the last seek instead of 0. Conjunction and opposition use the difference of two planets' unwrapped longitudes.

```text
t_event = t0 + Δt × (λ_boundary − λ_unwrapped(t0)) / δ
```

That time is linear between samples. It is the time a later scheduler will use. It is not a claim that the planet's angular speed was constant, except in the tests that deliberately use uniform motion.

## Planned for scientific playback

Not implemented. No frequency in the app is an audible pitch yet.

Orbital frequency, in hertz:

```text
f_orbit = 1 / (P × 86400)
```

`P × 86400` is the sidereal period in seconds. These frequencies are far below hearing.

Uniform scaling, one constant `K` for every planet:

```text
f_audio = f_orbit × K
```

This keeps the exact period ratios. It does not promise that every planet falls inside the audible band.

Octave folding, an integer `n` chosen per planet:

```text
f_audio = f_orbit × 2^n
```

`n` will be chosen so `f_audio` lands in a register the listener selects. Folding each planet by its own `n` keeps octave equivalence and changes the absolute frequency ratios. The panel will say that explicitly.

Instantaneous angular speed, for velocity-modulated pitch, will be taken from the state vector:

```text
ω = |r × v| / |r|²
```

with `r` and `v` the ecliptic position and velocity. A constant-speed circular orbit will not be used. The modulation will be a documented function of `ω / ω_mean` and a depth control, with the source value and the resulting hertz both visible.

Continuous drones, meridian pulses, and alignment accents will be independent toggles. They will consume `PlanetaryState` and `OrbitalEvent`. They will not advance the simulation clock.

## Planned for musical playback

Not implemented.

Candidate pitch will start from `f_orbit` or from the scaled scientific frequency, then optionally quantize to a chromatic scale, a major scale, a natural minor scale, a pentatonic scale, or no scale at all. The root note will be selectable. Random chord progressions will not be used.

Rhythm will come from the crossing events above. A separate compression control will map simulation time onto audio time. That control is not the simulation speed, and it is not a BPM.

Harmony will be the set of planetary pitches that are active together, with optional octave moves and scale quantization for voice leading.

MIDI cannot store every scientific frequency. When MIDI export exists, the documentation will state the note-number or pitch-bend approximation. Scientific drones will remain available as audio even when MIDI is a poor fit.

## Clocks

Simulation time and audio time will stay separate. `requestAnimationFrame` draws the orrery. It does not schedule sound and it does not integrate the orbits. Precise musical timing, once there is sound, will use the Web Audio clock rather than `setTimeout`.
