import { AstronomyService } from '../astronomy/astronomy.service';
import { addUtcDays } from '../astronomy/time';
import { MOONS, isMoonId } from '../domain/moons';
import { OrbitalEvent, OrbitalEventType } from '../domain/orbital-event';
import { PLANETS, planetName } from '../domain/planets';
import { createTracks, detectOrbitalEvents } from '../simulation/orbital-events';
import { heardFrequency } from '../sonification/plan';
import { readPitches } from '../sonification/pitch';
import { frequencyToMidi, noteName } from '../sonification/scales';
import { PitchSettings, PlanetMix, instrumentLabel } from '../sonification/sound-model';
import { RecordedPerformance } from './performance-capture';
import { ticksAt } from './midi';

const DISCLAIMER =
  'Written pitches are the nearest equal-tempered notes to the sounding hertz. The lines are those hertz, not a spectrum of a recording.';

export interface ScorePoint {
  day: number;
  second?: number;
  beat?: number;
  hz: number;
  midi: number;
  note: string;
}

export interface ScoreVoice {
  id: string;
  name: string;
  color: string;
  /** Instrument label in musical mode. Scientific mode has none; every part is a sine. */
  instrument?: string;
  points: ScorePoint[];
}

export interface ScoreMark {
  day: number;
  second?: number;
  beat?: number;
  type: OrbitalEventType;
  bodyIds: string[];
}

export interface SonificationCapture {
  startIso: string;
  endIso?: string;
  spanDays: number;
  durationSeconds?: number;
  durationBeats?: number;
  tempoBpm?: number;
  tempoChanges?: { beat: number; bpm: number }[];
  voices: ScoreVoice[];
  marks: ScoreMark[];
  disclaimer: string;
}

export function captureRecordedPerformance(performance: RecordedPerformance): SonificationCapture {
  const voices: ScoreVoice[] = performance.voices.map((voice) => {
    const first = voice.points[0];
    const instruments = [
      ...new Set(voice.points.map((point) => instrumentLabel(point.instrument))),
    ];
    return {
      id: voice.id,
      name: planetName(voice.id),
      color: swatch(voice.id),
      ...(first ? { instrument: instruments.join(' → ') } : {}),
      points: voice.points.map((point) => ({
        day: point.simulatedDay,
        second: point.second,
        beat: ticksAt(point.second, performance.tempos) / 480,
        hz: point.hz,
        midi: point.midi,
        note: point.note,
      })),
    };
  });
  return {
    startIso: performance.startIso.replace('.000Z', 'Z'),
    endIso: performance.endIso.replace('.000Z', 'Z'),
    spanDays: performance.simulatedSpanDays,
    durationSeconds: performance.durationSeconds,
    durationBeats: ticksAt(performance.durationSeconds, performance.tempos) / 480,
    tempoBpm: performance.tempos[0]?.bpm ?? 120,
    tempoChanges: performance.tempos.map((tempo) => ({
      beat: ticksAt(tempo.second, performance.tempos) / 480,
      bpm: tempo.bpm,
    })),
    voices,
    marks: performance.marks.map((mark) => ({
      day: mark.simulatedDay,
      second: mark.second,
      beat: ticksAt(mark.second, performance.tempos) / 480,
      type: mark.type,
      bodyIds: mark.bodyIds,
    })),
    disclaimer: DISCLAIMER,
  };
}

export interface CaptureOptions {
  start: Date;
  spanDays: number;
  includeMoons: boolean;
  pitch: PitchSettings;
  mixes: Readonly<Record<string, PlanetMix | undefined>>;
  hiddenIds: readonly string[];
  pulses: boolean;
  alignments: boolean;
}

export function captureSonification(
  astronomy: Pick<AstronomyService, 'getStates'>,
  options: CaptureOptions,
): SonificationCapture {
  const spanDays = clampSpan(options.spanDays);
  const samples = Math.min(48, Math.max(8, Math.round(spanDays / 8)));
  const hidden = new Set(options.hiddenIds);
  const anySolo = Object.values(options.mixes).some((mix) => mix?.solo);
  const voices = new Map<string, ScoreVoice>();
  const marks: ScoreMark[] = [];
  let tracks = createTracks(astronomy.getStates(options.start, options.includeMoons));

  for (let index = 0; index <= samples; index += 1) {
    const day = (spanDays * index) / samples;
    const time = addUtcDays(options.start, day);
    const states = astronomy.getStates(time, options.includeMoons);
    const readings = readPitches(states, options.pitch);
    for (const reading of readings) {
      if (!isSounding(reading.planetId, hidden, options.mixes, anySolo)) {
        continue;
      }
      const mix = options.mixes[reading.planetId];
      const instrument = options.pitch.mode === 'musical' && mix ? mix.instrument : 'sine';
      const hz = heardFrequency(reading.audibleFrequencyHz, options.pitch.mode, instrument);
      const midi = Math.round(frequencyToMidi(hz));
      const point: ScorePoint = { day, hz, midi, note: noteName(midi) };
      const voice = voices.get(reading.planetId);
      if (voice) {
        voice.points.push(point);
      } else {
        voices.set(reading.planetId, {
          id: reading.planetId,
          name: planetName(reading.planetId),
          color: swatch(reading.planetId),
          ...(options.pitch.mode === 'musical' ? { instrument: instrumentLabel(instrument) } : {}),
          points: [point],
        });
      }
    }
    if (index === 0) {
      continue;
    }
    const previousTime = addUtcDays(options.start, (spanDays * (index - 1)) / samples);
    const detected = detectOrbitalEvents(tracks, states, previousTime, time);
    tracks = detected.tracks;
    for (const event of detected.events) {
      const mark = markFor(event, hidden, options, anySolo);
      if (mark) {
        marks.push(mark);
      }
    }
  }

  return {
    startIso: options.start.toISOString().replace('.000Z', 'Z'),
    spanDays,
    voices: [...voices.values()],
    marks,
    disclaimer: DISCLAIMER,
  };
}

export function buildSpectrumSvg(capture: SonificationCapture): string {
  const width = 960;
  const legendRows = Math.max(1, Math.ceil(capture.voices.length / 4));
  const plot = { x: 72, y: 108, w: 860, h: 340 };
  const axisY = plot.y + plot.h + 22;
  const legendTop = axisY + 28;
  const height = legendTop + legendRows * 24 + 16;
  const hzValues = capture.voices.flatMap((voice) => voice.points.map((point) => point.hz));
  const finite = hzValues.filter((hz) => hz > 0 && Number.isFinite(hz));
  const minHz = finite.length > 0 ? Math.min(...finite) / 1.25 : 55;
  const maxHz = finite.length > 0 ? Math.max(...finite) * 1.25 : 880;
  const lines = capture.voices.map((voice) => {
    const path = voice.points
      .map((point, index) => {
        const command = index === 0 ? 'M' : 'L';
        return `${command}${xOf(point.second ?? point.day, timelineSpan(capture), plot).toFixed(1)},${yOf(point.hz, minHz, maxHz, plot).toFixed(1)}`;
      })
      .join(' ');
    return `<path d="${path}" fill="none" stroke="${xml(voice.color)}" stroke-width="2"/>`;
  });
  const ticks = capture.marks.flatMap((mark) =>
    mark.bodyIds.map((id) => {
      const voice = capture.voices.find((item) => item.id === id);
      const point = voice?.points.reduce((best, candidate) =>
        Math.abs(candidate.day - mark.day) < Math.abs(best.day - mark.day) ? candidate : best,
      );
      if (!voice || !point) {
        return '';
      }
      const x = xOf(mark.second ?? mark.day, timelineSpan(capture), plot);
      const y = yOf(point.hz, minHz, maxHz, plot);
      return `<line x1="${x.toFixed(1)}" y1="${(y - 7).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + 7).toFixed(1)}" stroke="${xml(voice.color)}" stroke-width="1.5"/>`;
    }),
  );
  const gridLines = [55, 110, 220, 440, 880, 1760]
    .filter((hz) => hz > minHz && hz < maxHz)
    .map((hz) => {
      const y = yOf(hz, minHz, maxHz, plot).toFixed(1);
      return `<line x1="${plot.x}" y1="${y}" x2="${plot.x + plot.w}" y2="${y}" stroke="#2c3a4d"/>`;
    });
  const gridLabels = [55, 110, 220, 440, 880, 1760]
    .filter((hz) => hz > minHz && hz < maxHz)
    .map((hz) => {
      const y = yOf(hz, minHz, maxHz, plot).toFixed(1);
      return `<text x="${plot.x - 8}" y="${y}" fill="#93a4b8" font-size="11" text-anchor="end">${hz} Hz</text>`;
    });
  const legend = capture.voices
    .map((voice, index) => {
      const x = 72 + (index % 4) * 220;
      const y = legendTop + Math.floor(index / 4) * 24;
      const hz = voice.points[0]?.hz ?? 0;
      return `<rect x="${x}" y="${y - 9}" width="12" height="12" fill="${xml(voice.color)}"/>
        <text x="${x + 18}" y="${y}" fill="#e7eef8" font-size="12">${xml(voice.name)} ${hz.toFixed(1)} Hz</text>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#07090e"/>
  <text x="72" y="32" fill="#e7eef8" font-family="Segoe UI, sans-serif" font-size="20">Harmonia Mundi</text>
  <text x="72" y="54" fill="#93a4b8" font-family="Segoe UI, sans-serif" font-size="12">${xml(capture.startIso)} · ${capture.durationSeconds === undefined ? `${capture.spanDays} simulated days` : `${capture.durationSeconds.toFixed(1)} recorded seconds · ${capture.spanDays.toFixed(2)} simulated days`}</text>
  <text x="72" y="72" fill="#93a4b8" font-family="Segoe UI, sans-serif" font-size="12">${xml(capture.disclaimer)}</text>
  <text x="${plot.x}" y="${axisY}" fill="#93a4b8" font-family="Segoe UI, sans-serif" font-size="12">${capture.durationSeconds === undefined ? 'Simulated days' : 'Recorded seconds'} →</text>
  ${gridLabels.join('')}
  <clipPath id="plot-clip"><rect x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}"/></clipPath>
  <g clip-path="url(#plot-clip)">
    ${gridLines.join('')}
    ${lines.join('')}
    ${ticks.join('')}
  </g>
  ${legend}
</svg>
`;
}

export function buildMusicXml(capture: SonificationCapture): string {
  const parts = capture.voices
    .map(
      (voice) =>
        `<score-part id="P-${xml(voice.id)}"><part-name>${xml(voice.name)}</part-name></score-part>`,
    )
    .join('');
  const bodies = capture.voices.map((voice) => renderPart(voice, capture)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Harmonia Mundi</work-title></work>
  <identification>
    <creator type="composer">Orbital frequencies</creator>
    <encoding><software>Harmonia Mundi</software><encoding-date>${xml(capture.startIso.slice(0, 10))}</encoding-date></encoding>
  </identification>
  <credit page="1"><credit-words>${xml(capture.disclaimer)} Span ${capture.spanDays} days from ${xml(capture.startIso)}.</credit-words></credit>
  <part-list>${parts}</part-list>
  ${bodies}
</score-partwise>
`;
}

export function downloadText(filename: string, mime: string, contents: string): void {
  downloadBlob(filename, new Blob([contents], { type: mime }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function timelineSpan(capture: SonificationCapture): number {
  return (capture.durationSeconds ?? capture.spanDays) || 1;
}

function renderPart(voice: ScoreVoice, capture: SonificationCapture): string {
  const held = holdNotes(voice.points);
  const clef = (held[0]?.midi ?? 60) >= 60 ? 'G' : 'F';
  const clefLine = clef === 'G' ? 2 : 4;
  const hz = voice.points[0]?.hz ?? 0;
  let beat = 0;
  const measures: string[][] = [[]];
  const open = (): string[] => measures[measures.length - 1] ?? [];
  for (const note of held) {
    let left = note.quarters;
    let continuing = false;
    while (left > 0) {
      const chunk = Math.min(4 - beat, left);
      const startsTie = left - chunk > 0;
      open().push(noteXml(note.note, chunk, startsTie, continuing));
      continuing = startsTie;
      left -= chunk;
      beat += chunk;
      if (beat >= 4) {
        beat = 0;
        measures.push([]);
      }
    }
  }
  if ((measures[measures.length - 1]?.length ?? 0) === 0) {
    measures.pop();
  }
  const body = measures
    .map((notes, index) => {
      const attributes =
        index === 0
          ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${clef}</sign><line>${clefLine}</line></clef></attributes>
        <direction placement="above"><direction-type><words>${xml(voice.name)} sounding ${hz.toFixed(2)} Hz at the start. Held across ${capture.spanDays} simulated days.</words></direction-type></direction>`
          : '';
      return `<measure number="${index + 1}">${attributes}${notes.join('')}</measure>`;
    })
    .join('');
  return `<part id="P-${xml(voice.id)}">${body}</part>`;
}

interface HeldNote {
  note: string;
  midi: number;
  quarters: number;
}

function holdNotes(points: readonly ScorePoint[]): HeldNote[] {
  const held: HeldNote[] = [];
  for (const point of points) {
    const last = held[held.length - 1];
    if (last && last.midi === point.midi) {
      last.quarters += 1;
    } else {
      held.push({ note: point.note, midi: point.midi, quarters: 1 });
    }
  }
  if (held.length === 1 && held[0]) {
    held[0].quarters = 4;
  }
  return held;
}

function noteXml(note: string, quarters: number, tieStart: boolean, tieStop: boolean): string {
  const pitch = spell(note);
  const type =
    quarters >= 4 ? 'whole' : quarters === 3 ? 'half' : quarters === 2 ? 'half' : 'quarter';
  const dot = quarters === 3 ? '<dot/>' : '';
  const ties = [tieStop ? '<tie type="stop"/>' : '', tieStart ? '<tie type="start"/>' : ''].join(
    '',
  );
  const notations =
    tieStart || tieStop
      ? `<notations>${tieStop ? '<tied type="stop"/>' : ''}${tieStart ? '<tied type="start"/>' : ''}</notations>`
      : '';
  return `<note><pitch><step>${pitch.step}</step>${pitch.alter === 0 ? '' : `<alter>${pitch.alter}</alter>`}<octave>${pitch.octave}</octave></pitch><duration>${quarters}</duration>${ties}${dot}<type>${type}</type>${notations}</note>`;
}

export function spell(note: string): { step: string; alter: number; octave: number } {
  const match = /^([A-G])(#?)(-?\d+)$/.exec(note);
  if (!match) {
    return { step: 'C', alter: 0, octave: 4 };
  }
  return {
    step: match[1] ?? 'C',
    alter: match[2] === '#' ? 1 : 0,
    octave: Number(match[3]),
  };
}

function markFor(
  event: OrbitalEvent,
  hidden: ReadonlySet<string>,
  options: CaptureOptions,
  anySolo: boolean,
): ScoreMark | null {
  if (isMoonId(event.planetId)) {
    return null;
  }
  const alignment = event.type === 'conjunction' || event.type === 'opposition';
  if (alignment && !options.alignments) {
    return null;
  }
  if (!alignment && !options.pulses) {
    return null;
  }
  const ids = [event.planetId, event.otherPlanetId].filter((id): id is string => !!id);
  if (ids.some((id) => !isSounding(id, hidden, options.mixes, anySolo))) {
    return null;
  }
  const day = (event.simulationTime.getTime() - options.start.getTime()) / 86400000;
  return { day, type: event.type, bodyIds: ids };
}

function isSounding(
  id: string,
  hidden: ReadonlySet<string>,
  mixes: Readonly<Record<string, PlanetMix | undefined>>,
  anySolo: boolean,
): boolean {
  if (hidden.has(id)) {
    return false;
  }
  const mix = mixes[id];
  if (!mix || mix.muted || mix.gain <= 0) {
    return false;
  }
  if (anySolo && !mix.solo) {
    return false;
  }
  return true;
}

function swatch(id: string): string {
  return (
    PLANETS.find((planet) => planet.id === id)?.swatch ??
    MOONS.find((moon) => moon.id === id)?.swatch ??
    '#e7eef8'
  );
}

function clampSpan(days: number): number {
  if (!Number.isFinite(days)) {
    return 365;
  }
  return Math.min(2000, Math.max(1, days));
}

function xOf(day: number, spanDays: number, plot: { x: number; w: number }): number {
  return plot.x + (spanDays === 0 ? 0 : day / spanDays) * plot.w;
}

function yOf(hz: number, minHz: number, maxHz: number, plot: { y: number; h: number }): number {
  const safe = Math.max(hz, 0.01);
  const low = Math.log(minHz);
  const high = Math.log(maxHz);
  const span = high - low || 1;
  const t = (Math.log(safe) - low) / span;
  return plot.y + plot.h - t * plot.h;
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
