# Harmonia Mundi

A browser observatory that places Mercury through Neptune from calculated orbits and, in later milestones, turns those orbits into sound.

This repository is Milestone 1. The shared astronomical simulation is running. Scientific and musical audio are not.

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
- Play, pause, step, and change the simulation speed in days per real-time second.
- Jump to today, type another UTC instant, or reset to the date you last entered.
- Hide planets, orbit samples, and trails. Those controls change the picture only.
- Drag the view to orbit the Sun, and scroll to zoom. Distances are square-root compressed and planet sizes are exaggerated. The view says so.

Settings are stored in the browser under `harmonia-mundi.preferences.v1`.

## Time

The date field and the clock are UTC. Enter an instant such as `2000-01-01T12:00:00Z`. Astronomy Engine converts that UTC instant to Terrestrial Time before it evaluates the ephemeris.

## Documentation

- [Architecture](docs/architecture.md)
- [Sonification mathematics](docs/sonification.md)
- [Roadmap](docs/roadmap.md)
