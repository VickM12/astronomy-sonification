# Sonification

The music has to be traceable to the ephemeris. This note separates measurements from the mappings that turn them into sound.

## Measurements

These quantities are calculated and shown. The same numbers feed the audio session.

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

That time is linear between samples. It is the fraction the audio session uses. It is not a claim that the planet's angular speed was constant, except in the tests that deliberately use uniform motion.

## Scientific playback

Orbital frequency, in hertz:

```text
f_orbit = 1 / (P × 86400)
```

`P × 86400` is the sidereal period in seconds. These frequencies are far below hearing.

Uniform scaling, one constant `K` for every planet. `K` places Earth at 110 Hz:

```text
f_audio = f_orbit × K
```

This keeps the exact period ratios. Outer planets can fall below the usual hearing range. The panel says so when a pitch is under 20 Hz.

Octave folding, an integer `n` chosen per planet:

```text
f_audio = f_orbit × 2^n
```

`n` is chosen so `f_audio` lands in the selected register (55–110 Hz, 110–220 Hz, or 220–440 Hz). Folding each planet by its own `n` keeps octave equivalence and changes the absolute frequency ratios. The panel states that.

Instantaneous angular speed comes from the state vector:

```text
ω = |r × v| / |r|²
f = f_base × (1 + depth × (ω / ω_mean − 1))
```

`ω_mean` is `2π / P`. Depth 0 leaves the pitch fixed. The panel shows `ω`, the formula, and the audible hertz.

Continuous drones, meridian pulses (reference meridian and revolution), and alignment accents (conjunction and opposition) are independent toggles. They consume `PlanetaryState` and `OrbitalEvent`. They do not advance the simulation clock.

## Musical playback

Candidate pitch starts from the scientific mapping above, then optionally quantizes to a chromatic scale, a major scale, a natural minor scale, or a pentatonic scale. The root note is selectable. Turning quantization off leaves the scientific candidate. Random chord progressions are not used.

Rhythm comes from the crossing events. Each note's length is `60 / BPM × beats`. Its place on the audio clock is:

```text
t_audio = t_now + fraction × |Δdays| × compression
```

`fraction` is where the crossing sits between the two samples. `compression` is audio seconds per simulated day. BPM is not that control, and simulation speed is not that control.

Harmony is the set of planetary pitches sounding together. Musical mode first places each planet in its own octave, Neptune lowest and Mercury highest, keeping the pitch class that came from the orbit. A scale change retunes those pitch classes in place. A harmony amount can still move a later planet up by whole octaves when two pitches sit closer than a deterministic semitone gap.

Bell sounds an octave above the candidate. Bass sounds an octave below. Sine, pad, and pluck keep the candidate and change the waveform and the pulse envelope.

MIDI cannot store every scientific frequency. When MIDI export exists, the documentation will state the note-number or pitch-bend approximation. Scientific drones remain available as audio even when MIDI is a poor fit. WAV and MIDI export are not in this build.

## Clocks

Simulation time and audio time stay separate. `requestAnimationFrame` draws the orrery. It does not schedule sound and it does not integrate the orbits. The simulation interval is when a crossing becomes known. The Web Audio clock is when it sounds. `setTimeout` is used only to clear the on-screen flash.
