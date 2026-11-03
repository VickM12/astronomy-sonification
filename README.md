# Harmonia Mundi

A browser observatory that places Mercury through Neptune from calculated orbits and turns those orbits into sound.

## Requirements

- Node.js 22.12 or newer, or Node.js 24. The machine used for this project is Node 24.14, which is why the app is Angular 21. Angular 22 requires Node 24.15 or newer.
- npm 11

## Run

```bash
npm install
npm start
```

The observatory opens at `http://localhost:4200/`.

```bash
npm test -- --watch=false
npm run build
```

## What you can do

- Read heliocentric positions, speeds, and ecliptic longitudes for a UTC date.
- Press Play. Scientific mode sounds each planet from its sidereal frequency. Musical mode snaps those pitches to a scale.
- Play, pause, step, and change the simulation speed in days per real-time second. Tempo and audio-seconds-per-day are separate controls.
- Jump to today, type another UTC instant, or reset to the date you last entered. A seek does not replay the crossings it skipped.
- Hide planets, orbit samples, and trails. Mute, solo, and gain change what you hear.
- Turn on Jupiter's moons. Io, Europa, Ganymede, and Callisto are placed from Jupiter and pitched so their period ratios stay intact.
- Jump to the next planetary conjunction or opposition.
- Give each planet an instrument. Strings, cello, flute, bassoon, clarinet, French horn, trumpet, harp, and piano play recordings from [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) (CC BY 3.0), fetched from a CDN on first use. Sine, pad, bell, pluck, and deep bass are synthesized.
- Download a spectral image or a PDF score of the span you choose.
- Drag the view to orbit the Sun, and scroll to zoom. Distances are square-root compressed and planet sizes are exaggerated. The view says so.

Settings are stored in the browser under `harmonia-mundi.preferences.v1`. Older saves without a sound block still load.

## Time

The date field and the clock are UTC. Enter an instant such as `2000-01-01T12:00:00Z`. Astronomy Engine converts that UTC instant to Terrestrial Time before it evaluates the ephemeris.

## Documentation

- [Architecture](docs/architecture.md)
- [Sonification mathematics](docs/sonification.md)
- [Roadmap](docs/roadmap.md)
