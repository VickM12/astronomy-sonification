import { planetName } from '../domain/planets';
import {
  ScoreMark,
  ScorePoint,
  ScoreVoice,
  SonificationCapture,
  spell,
} from './sonification-score';

/**
 * Engraving of the captured sonification as a 4/4 score. The engraver emits
 * device-independent shapes; `shapesToSvg` and `buildScorePdf` draw them.
 * Every glyph (clefs, accidentals, rests, flags) is a vector path so the PDF
 * needs no music font.
 */

const SCORE_W = 1040;
const STAFF_LEFT = 136;
const MEASURES_PER_SYSTEM = 4;
const MEASURE_W = 220;
const STAFF_SPACE = 8;
const INK = '#1a140f';
const QUIET = '#5c5146';
const PAPER = '#f6f1e7';
const TEMPO = 96;

export type Pt = readonly [number, number];
export type Segment = { op: 'M' | 'L'; p: Pt } | { op: 'C'; c1: Pt; c2: Pt; p: Pt } | { op: 'Z' };

export interface PathShape {
  kind: 'path';
  segments: Segment[];
  fill: string | null;
  stroke: string | null;
  width: number;
  round: boolean;
}

export interface TextShape {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  style: 'regular' | 'italic' | 'bold';
  anchor: 'start' | 'middle';
}

export type Shape = PathShape | TextShape;

export interface EngravedSystem {
  height: number;
  shapes: Shape[];
}

export interface EngravedToken {
  kind: 'note' | 'rest';
  eighths: number;
  note: string;
  beam: 'begin' | 'end' | 'none';
}

/** 4/4, four to thirty-two bars. One quarter is an even slice of the exported span. */
export function measureCountFor(spanDays: number): number {
  return Math.min(32, Math.max(4, Math.round(spanDays / 16)));
}

/**
 * Spell one 4/4 bar. An attack on the beat followed by an empty offbeat is a
 * quarter. Two attacks in the same beat are beamed eighths. An offbeat attack
 * is a flagged eighth. Rests fill whatever is left and sum with the notes to 8.
 */
export function spellMeasure(slots: readonly (string | null)[]): EngravedToken[] {
  const bar = Array.from({ length: 8 }, (_, index) => slots[index] ?? null);
  const tokens: EngravedToken[] = [];
  let index = 0;
  while (index < 8) {
    const note = bar[index];
    if (note) {
      const onBeat = index % 2 === 0;
      const next = bar[index + 1];
      if (onBeat && next) {
        tokens.push({ kind: 'note', eighths: 1, note, beam: 'begin' });
        tokens.push({ kind: 'note', eighths: 1, note: next, beam: 'end' });
        index += 2;
      } else if (onBeat) {
        tokens.push({ kind: 'note', eighths: 2, note, beam: 'none' });
        index += 2;
      } else {
        tokens.push({ kind: 'note', eighths: 1, note, beam: 'none' });
        index += 1;
      }
    } else {
      let end = index + 1;
      while (end < 8 && !bar[end]) {
        end += 1;
      }
      tokens.push(...spellRests(index, end));
      index = end;
    }
  }
  return tokens;
}

export function engraveVoice(capture: SonificationCapture, voiceId: string): EngravedToken[][] {
  const voice = capture.voices.find((item) => item.id === voiceId);
  if (!voice) {
    return [];
  }
  const measures = scoreMeasureCount(capture);
  const slots = attackSlots(voice, capture, measures * 8);
  return Array.from({ length: measures }, (_, measure) =>
    spellMeasure(slots.slice(measure * 8, measure * 8 + 8)),
  );
}

export function engraveScore(capture: SonificationCapture): EngravedSystem[] {
  const voices = [...capture.voices].sort(
    (left, right) => (right.points[0]?.midi ?? 0) - (left.points[0]?.midi ?? 0),
  );
  const measures = scoreMeasureCount(capture);
  const quarterDays = capture.spanDays / (measures * 4);
  const parts: PartLayout[] = voices.map((voice) => {
    const bars = engraveVoice(capture, voice.id);
    const treble = (voice.points[0]?.midi ?? 60) >= 60;
    const positions = bars
      .flat()
      .filter((token) => token.kind === 'note')
      .map((token) => staffPosition(token.note, treble));
    const pads = staffPads(positions);
    return { voice, treble, bars, above: pads.above, below: pads.below };
  });
  const systemCount = Math.max(1, Math.ceil(measures / MEASURES_PER_SYSTEM));
  const systems: EngravedSystem[] = [];
  for (let system = 0; system < systemCount; system += 1) {
    const start = system * MEASURES_PER_SYSTEM;
    const count = Math.min(MEASURES_PER_SYSTEM, measures - start);
    systems.push(
      renderSystem(
        capture,
        parts,
        start,
        count,
        system === 0,
        quarterDays,
        start + count >= measures,
      ),
    );
  }
  return systems;
}

export function buildScoreSvg(capture: SonificationCapture): string {
  const systems = engraveScore(capture);
  const height = systems.reduce((sum, system) => sum + system.height, 0);
  let offset = 0;
  const body = systems
    .map((system) => {
      const markup = `<g transform="translate(0 ${offset})">${shapesToSvg(system.shapes)}</g>`;
      offset += system.height;
      return markup;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SCORE_W}" height="${height}" viewBox="0 0 ${SCORE_W} ${height}">
  <rect width="${SCORE_W}" height="${height}" fill="${PAPER}"/>
  ${body}
</svg>
`;
}

export function shapesToSvg(shapes: readonly Shape[]): string {
  return shapes
    .map((shape) => {
      if (shape.kind === 'text') {
        const weight = shape.style === 'bold' ? ' font-weight="700"' : '';
        const italic = shape.style === 'italic' ? ' font-style="italic"' : '';
        const anchor = shape.anchor === 'middle' ? ' text-anchor="middle"' : '';
        return `<text x="${num(shape.x)}" y="${num(shape.y)}" fill="${shape.color}" font-family="Georgia, Times New Roman, serif" font-size="${num(shape.size)}"${weight}${italic}${anchor}>${escapeXml(shape.text)}</text>`;
      }
      const d = shape.segments
        .map((segment) => {
          if (segment.op === 'Z') {
            return 'Z';
          }
          if (segment.op === 'C') {
            return `C${num(segment.c1[0])} ${num(segment.c1[1])} ${num(segment.c2[0])} ${num(segment.c2[1])} ${num(segment.p[0])} ${num(segment.p[1])}`;
          }
          return `${segment.op}${num(segment.p[0])} ${num(segment.p[1])}`;
        })
        .join(' ');
      const fill = shape.fill ? ` fill="${shape.fill}"` : ' fill="none"';
      const stroke = shape.stroke
        ? ` stroke="${shape.stroke}" stroke-width="${num(shape.width)}"${shape.round ? ' stroke-linecap="round" stroke-linejoin="round"' : ''}`
        : '';
      return `<path d="${d}"${fill}${stroke}/>`;
    })
    .join('');
}

/**
 * A PDF written directly: one content stream per US Letter page, base-14 Times
 * for words, and every musical glyph as path operators. The string is pure
 * ASCII, so byte offsets in the cross-reference table equal string offsets.
 */
export function buildScorePdf(capture: SonificationCapture): string {
  const pageW = 612;
  const pageH = 792;
  const margin = 36;
  const scale = (pageW - margin * 2) / SCORE_W;
  const systems = engraveScore(capture);
  const pages: string[][] = [];
  let current: string[] = [];
  let cursor = margin;
  for (const system of systems) {
    const drawn = system.height * scale;
    if (current.length > 0 && cursor + drawn > pageH - margin) {
      pages.push(current);
      current = [];
      cursor = margin;
    }
    current.push(pdfContent(system.shapes, scale, margin, cursor, pageH));
    cursor += drawn + 10;
  }
  pages.push(current);

  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  const fontRegular = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
  );
  const fontItalic = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>',
  );
  const fontBold = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>',
  );
  const pagesId = objects.length + 1 + pages.length * 2;
  const pageIds: number[] = [];
  for (const page of pages) {
    const stream = page.join('\n');
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontItalic} 0 R /F3 ${fontBold} 0 R >> >> >>`,
    );
    pageIds.push(pageId);
  }
  add(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
  );
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const infoId = add(
    `<< /Title (Harmonia Mundi) /Producer (Harmonia Mundi) /Subject (${pdfString(`${capture.startIso} ${capture.durationSeconds === undefined ? `${capture.spanDays} simulated days` : `${capture.durationSeconds.toFixed(1)} recorded seconds`}`)}) >>`,
  );

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

function pdfContent(
  shapes: readonly Shape[],
  scale: number,
  left: number,
  top: number,
  pageH: number,
): string {
  const tx = (x: number): string => num(left + x * scale);
  const ty = (y: number): string => num(pageH - (top + y * scale));
  const ops: string[] = ['q'];
  for (const shape of shapes) {
    if (shape.kind === 'text') {
      const font = shape.style === 'bold' ? '/F3' : shape.style === 'italic' ? '/F2' : '/F1';
      const size = shape.size * scale;
      const text = pdfString(shape.text);
      const x =
        shape.anchor === 'middle' ? shape.x - (shape.text.length * shape.size * 0.5) / 2 : shape.x;
      ops.push(
        `BT ${rgb(shape.color)} rg ${font} ${num(size)} Tf ${tx(x)} ${ty(shape.y)} Td (${text}) Tj ET`,
      );
      continue;
    }
    const path = shape.segments
      .map((segment) => {
        if (segment.op === 'Z') {
          return 'h';
        }
        if (segment.op === 'C') {
          return `${tx(segment.c1[0])} ${ty(segment.c1[1])} ${tx(segment.c2[0])} ${ty(segment.c2[1])} ${tx(segment.p[0])} ${ty(segment.p[1])} c`;
        }
        return `${tx(segment.p[0])} ${ty(segment.p[1])} ${segment.op === 'M' ? 'm' : 'l'}`;
      })
      .join(' ');
    const paint = shape.fill && shape.stroke ? 'B' : shape.fill ? 'f' : 'S';
    const style = [
      shape.fill ? `${rgb(shape.fill)} rg` : '',
      shape.stroke
        ? `${rgb(shape.stroke)} RG ${num(shape.width * scale)} w ${shape.round ? '1 J 1 j' : '0 J 0 j'}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    ops.push(`${style} ${path} ${paint}`);
  }
  ops.push('Q');
  return ops.join('\n');
}

function pdfString(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (char === '\\' || char === '(' || char === ')') {
      out += `\\${char}`;
    } else if (char === '♯') {
      out += '#';
    } else if (char === '·') {
      out += '\\267';
    } else if (char === '°') {
      out += '\\260';
    } else if (code >= 32 && code < 127) {
      out += char;
    } else {
      out += '?';
    }
  }
  return out;
}

function rgb(hex: string): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const channel = (index: number): string => num(parseInt(full.slice(index, index + 2), 16) / 255);
  return `${channel(0)} ${channel(2)} ${channel(4)}`;
}

interface PartLayout {
  voice: ScoreVoice;
  treble: boolean;
  bars: EngravedToken[][];
  above: number;
  below: number;
}

function renderSystem(
  capture: SonificationCapture,
  parts: readonly PartLayout[],
  measureStart: number,
  measureCount: number,
  first: boolean,
  quarterDays: number,
  last: boolean,
): EngravedSystem {
  const header = first ? 96 : 28;
  const right = STAFF_LEFT + measureCount * MEASURE_W;
  const shapes: Shape[] = [];
  let cursor = header + 16;
  const staffTops: number[] = [];
  for (const part of parts) {
    cursor += part.above;
    staffTops.push(cursor);
    cursor += 4 * STAFF_SPACE + part.below + 8;
  }
  const height = Math.max(cursor + 8, header + 48);
  const topLine = staffTops[0] ?? header;
  const bottomLine = staffTops.length
    ? (staffTops[staffTops.length - 1] ?? topLine) + 4 * STAFF_SPACE
    : topLine + 4 * STAFF_SPACE;

  if (first) {
    shapes.push(text(48, 32, 'Harmonia Mundi', 22, INK));
    shapes.push(
      text(
        48,
        52,
        capture.durationSeconds === undefined
          ? `${capture.startIso} · ${capture.spanDays} simulated days · 4/4`
          : `${capture.startIso} to ${capture.endIso ?? ''} · ${capture.durationSeconds.toFixed(1)} recorded seconds · 4/4`,
        13,
        QUIET,
      ),
    );
    shapes.push(
      text(
        48,
        70,
        capture.durationSeconds === undefined
          ? `Quarter note = ${TEMPO}. One quarter note = ${formatDays(quarterDays)} simulated days. Sempre staccato.`
          : `Quarter note = ${capture.tempoBpm ?? TEMPO}. Recorded performance; later tempo changes are marked by system. Sempre staccato.`,
        13,
        QUIET,
      ),
    );
    shapes.push(
      text(
        48,
        86,
        'A note is a meridian crossing or an alignment. Events closer than one eighth share that note. Pitches are the nearest equal-tempered notes.',
        12,
        QUIET,
      ),
    );
  } else {
    const tempo = capture.tempoChanges?.find(
      (change) =>
        change.beat >= measureStart * 4 && change.beat < (measureStart + measureCount) * 4,
    );
    shapes.push(
      text(
        48,
        18,
        `Harmonia Mundi · measure ${measureStart + 1}${tempo ? ` · quarter = ${tempo.bpm}` : ''}`,
        12,
        QUIET,
      ),
    );
  }
  if (parts.length === 0) {
    shapes.push(text(48, header + 28, 'No sounding planets in this span.', 16, INK));
    return { height, shapes };
  }
  if (parts.length > 1) {
    shapes.push(
      stroked(
        [
          { op: 'M', p: [STAFF_LEFT - 10, topLine] },
          { op: 'L', p: [STAFF_LEFT - 16, topLine] },
          { op: 'L', p: [STAFF_LEFT - 16, bottomLine] },
          { op: 'L', p: [STAFF_LEFT - 10, bottomLine] },
        ],
        1.4,
      ),
    );
  }
  shapes.push(...barlines(topLine, bottomLine, measureCount, right, last));
  shapes.push(
    text(STAFF_LEFT + 4, topLine - (parts[0]?.above ?? 0) - 3, String(measureStart + 1), 10, QUIET),
  );
  parts.forEach((part, index) => {
    shapes.push(
      ...renderPartStaff(
        part,
        staffTops[index] ?? header,
        measureStart,
        measureCount,
        right,
        first,
      ),
    );
  });
  return { height, shapes };
}

function renderPartStaff(
  part: PartLayout,
  staffTop: number,
  measureStart: number,
  measureCount: number,
  right: number,
  timeSignature: boolean,
): Shape[] {
  const shapes: Shape[] = [];
  for (let index = 0; index < 5; index += 1) {
    const y = staffTop + index * STAFF_SPACE;
    shapes.push(line(STAFF_LEFT, y, right, y, 0.9));
  }
  const point = part.voice.points[0];
  const hz = point?.hz ?? 0;
  const firstNote =
    part.bars.flat().find((token) => token.kind === 'note')?.note ?? point?.note ?? '';
  const written = firstNote.replace('#', '♯');
  const mid = staffTop + 2 * STAFF_SPACE;
  shapes.push(rect(16, mid - 18, 9, 9, part.voice.color));
  shapes.push(text(30, mid - 10, part.voice.name, 14, INK, 'italic'));
  shapes.push(text(30, mid + 4, `${written} · ${hz.toFixed(1)} Hz`, 11, QUIET));
  if (part.voice.instrument) {
    shapes.push(text(30, mid + 17, part.voice.instrument, 11, QUIET));
  }
  shapes.push(
    ...(part.treble ? trebleClef(STAFF_LEFT + 22, staffTop) : bassClef(STAFF_LEFT + 14, staffTop)),
  );
  if (timeSignature) {
    shapes.push(text(STAFF_LEFT + 46, staffTop + 15, '4', 20, INK, 'bold', 'middle'));
    shapes.push(text(STAFF_LEFT + 46, staffTop + 31, '4', 20, INK, 'bold', 'middle'));
  }
  const yFor = (position: number): number =>
    staffTop + 4 * STAFF_SPACE - position * (STAFF_SPACE / 2);
  for (let index = 0; index < measureCount; index += 1) {
    shapes.push(
      ...renderMeasure(
        part.bars[measureStart + index] ?? [],
        part.treble,
        STAFF_LEFT + index * MEASURE_W,
        index === 0,
        timeSignature,
        staffTop,
        yFor,
      ),
    );
  }
  return shapes;
}

function renderMeasure(
  tokens: readonly EngravedToken[],
  treble: boolean,
  measureX: number,
  firstOfSystem: boolean,
  timeSignature: boolean,
  staffTop: number,
  yFor: (position: number) => number,
): Shape[] {
  const inset = firstOfSystem ? (timeSignature ? 72 : 46) : 12;
  const contentStart = measureX + inset;
  const contentSpan = Math.max(24, MEASURE_W - inset - 16);
  const xAt = (eighthIndex: number): number => contentStart + (eighthIndex / 8) * contentSpan;
  const active = new Map<string, number>();
  const shapes: Shape[] = [];
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token.kind === 'rest') {
      const x = token.eighths === 8 ? measureX + MEASURE_W / 2 : xAt(cursor) + 6;
      shapes.push(...restGlyph(token.eighths, x, staffTop));
      cursor += token.eighths;
      continue;
    }
    const next = tokens[index + 1];
    if (token.beam === 'begin' && next?.beam === 'end' && next.kind === 'note') {
      shapes.push(
        ...beamedPair(token, next, xAt(cursor), xAt(cursor + token.eighths), treble, yFor, active),
      );
      cursor += token.eighths + next.eighths;
      index += 1;
      continue;
    }
    shapes.push(...singleNote(token, xAt(cursor), treble, yFor, active));
    cursor += token.eighths;
  }
  return shapes;
}

interface PlacedNote {
  x: number;
  y: number;
  position: number;
  shapes: Shape[];
}

function beamedPair(
  first: EngravedToken,
  second: EngravedToken,
  x1: number,
  x2: number,
  treble: boolean,
  yFor: (position: number) => number,
  active: Map<string, number>,
): Shape[] {
  const a = placeNote(first.note, x1, treble, yFor, active);
  const b = placeNote(second.note, x2, treble, yFor, active);
  const down = (a.position + b.position) / 2 >= 4;
  const reach = (y: number): number => (down ? y + 28 : y - 28);
  const beamY = down ? Math.max(reach(a.y), reach(b.y)) : Math.min(reach(a.y), reach(b.y));
  const stemX = (note: PlacedNote): number => (down ? note.x - 5.2 : note.x + 5.2);
  return [
    ...a.shapes,
    ...b.shapes,
    line(stemX(a), a.y, stemX(a), beamY, 1.15),
    line(stemX(b), b.y, stemX(b), beamY, 1.15),
    line(stemX(a), beamY, stemX(b), beamY, 3.2),
  ];
}

function singleNote(
  token: EngravedToken,
  x: number,
  treble: boolean,
  yFor: (position: number) => number,
  active: Map<string, number>,
): Shape[] {
  const note = placeNote(token.note, x, treble, yFor, active);
  const down = note.position >= 4;
  const stemX = down ? note.x - 5.2 : note.x + 5.2;
  const stemY = down ? note.y + 28 : note.y - 28;
  const shapes = [...note.shapes, line(stemX, note.y, stemX, stemY, 1.15)];
  if (token.eighths === 1) {
    shapes.push(eighthFlag(stemX, stemY, down));
  }
  return shapes;
}

function placeNote(
  note: string,
  x: number,
  treble: boolean,
  yFor: (position: number) => number,
  active: Map<string, number>,
): PlacedNote {
  const accidental = accidentalFor(note, active);
  const position = staffPosition(note, treble);
  const y = yFor(position);
  const shapes: Shape[] = [...ledgerMarks(position, x, yFor)];
  if (accidental === 'sharp') {
    shapes.push(...sharpSign(x - 13, y));
  } else if (accidental === 'natural') {
    shapes.push(...naturalSign(x - 13, y));
  }
  shapes.push(ellipse(x, y, 6, 4.2, -18, INK));
  return { x, y, position, shapes };
}

function accidentalFor(note: string, active: Map<string, number>): 'sharp' | 'natural' | null {
  const spelled = spell(note);
  const key = `${spelled.step}${spelled.octave}`;
  const previous = active.get(key) ?? 0;
  if (spelled.alter === previous) {
    return null;
  }
  active.set(key, spelled.alter);
  return spelled.alter === 1 ? 'sharp' : 'natural';
}

function barlines(
  top: number,
  bottom: number,
  measureCount: number,
  right: number,
  last: boolean,
): Shape[] {
  const shapes = [line(STAFF_LEFT, top, STAFF_LEFT, bottom, 1)];
  for (let index = 1; index < measureCount; index += 1) {
    const x = STAFF_LEFT + index * MEASURE_W;
    shapes.push(line(x, top, x, bottom, 0.9));
  }
  if (last) {
    shapes.push(line(right - 7, top, right - 7, bottom, 0.9));
    shapes.push(rect(right - 4.5, top, 3.4, bottom - top, INK));
  } else {
    shapes.push(line(right, top, right, bottom, 0.9));
  }
  return shapes;
}

/** Treble clef: a spiral around the G line, a tall loop, a stem, and a tailing dot. */
function trebleClef(x: number, staffTop: number): Shape[] {
  const g = staffTop + 3 * STAFF_SPACE;
  const segments: Segment[] = [];
  const turns = 56;
  const thetaStart = 1.7 * Math.PI;
  const thetaEnd = -0.35 * Math.PI;
  for (let index = 0; index <= turns; index += 1) {
    const t = index / turns;
    const theta = thetaStart + (thetaEnd - thetaStart) * t;
    const r = 1.2 + 6.8 * t;
    const p: Pt = [x + r * Math.cos(theta), g + r * Math.sin(theta)];
    segments.push({ op: index === 0 ? 'M' : 'L', p });
  }
  segments.push({ op: 'C', c1: [x + 8.5, g - 13], c2: [x + 7.5, g - 27], p: [x + 3, g - 37] });
  segments.push({
    op: 'C',
    c1: [x + 1.6, g - 41.5],
    c2: [x + 0.2, g - 44.5],
    p: [x - 0.8, g - 43.5],
  });
  segments.push({ op: 'C', c1: [x - 1.6, g - 42.5], c2: [x - 1.6, g - 39], p: [x - 1.6, g - 33] });
  segments.push({ op: 'L', p: [x - 1.6, g + 21] });
  segments.push({
    op: 'C',
    c1: [x - 1.6, g + 26.5],
    c2: [x - 7.4, g + 27.5],
    p: [x - 7.8, g + 22.5],
  });
  return [stroked(segments, 2.3), circle(x - 7.8, g + 22.5, 2.3, INK)];
}

/** Bass clef: a head on the F line, a curl, and the two dots either side of that line. */
function bassClef(x: number, staffTop: number): Shape[] {
  const f = staffTop + STAFF_SPACE;
  return [
    circle(x, f, 2.5, INK),
    stroked(
      [
        { op: 'M', p: [x, f] },
        { op: 'C', c1: [x - 1, f - 8.5], c2: [x + 11, f - 11], p: [x + 12, f - 2] },
        { op: 'C', c1: [x + 13, f + 8], c2: [x + 4, f + 16], p: [x - 4, f + 21] },
      ],
      2.4,
    ),
    circle(x + 17, f - 4, 1.7, INK),
    circle(x + 17, f + 4, 1.7, INK),
  ];
}

function sharpSign(x: number, y: number): Shape[] {
  return [
    line(x - 2, y - 7, x - 2, y + 8, 1.1),
    line(x + 2, y - 8, x + 2, y + 7, 1.1),
    line(x - 4.5, y + 2.8, x + 4.5, y + 0.8, 2.2),
    line(x - 4.5, y - 2.2, x + 4.5, y - 4.2, 2.2),
  ];
}

function naturalSign(x: number, y: number): Shape[] {
  return [
    line(x - 2.2, y - 8, x - 2.2, y + 3.5, 1.1),
    line(x + 2.2, y - 3.5, x + 2.2, y + 8, 1.1),
    line(x - 2.2, y - 1.5, x + 2.2, y - 3.2, 2),
    line(x - 2.2, y + 3.8, x + 2.2, y + 2.1, 2),
  ];
}

function restGlyph(eighths: number, x: number, staffTop: number): Shape[] {
  if (eighths >= 8) {
    return [rect(x - 7, staffTop + STAFF_SPACE, 14, 5, INK)];
  }
  if (eighths >= 4) {
    return [rect(x - 7, staffTop + 2 * STAFF_SPACE - 5, 14, 5, INK)];
  }
  const mid = staffTop + 2 * STAFF_SPACE;
  if (eighths >= 2) {
    const ox = x - 1;
    const oy = mid - 13;
    return [
      stroked(
        [
          { op: 'M', p: [ox + 1, oy + 1] },
          { op: 'C', c1: [ox + 8, oy + 2], c2: [ox + 8, oy + 7], p: [ox + 2, oy + 8] },
          { op: 'C', c1: [ox + 9, oy + 9], c2: [ox + 9, oy + 14], p: [ox + 3, oy + 16] },
          { op: 'C', c1: [ox + 1, oy + 20], c2: [ox + 4, oy + 23], p: [ox + 7, oy + 24] },
        ],
        1.7,
      ),
    ];
  }
  const ox = x - 1;
  const oy = mid - 1;
  return [
    circle(ox + 6, oy - 9, 2.5, INK),
    stroked(
      [
        { op: 'M', p: [ox + 6.2, oy - 7] },
        { op: 'C', c1: [ox + 10, oy - 1], c2: [ox + 5, oy + 3], p: [ox + 1, oy + 11] },
      ],
      1.7,
    ),
  ];
}

function eighthFlag(x: number, y: number, down: boolean): Shape {
  const s = down ? -1 : 1;
  return filled(
    [
      { op: 'M', p: [x, y] },
      { op: 'C', c1: [x + 9, y + 2 * s], c2: [x + 13, y + 10 * s], p: [x + 5, y + 16 * s] },
      { op: 'C', c1: [x + 10, y + 10 * s], c2: [x + 8, y + 4 * s], p: [x, y + 2 * s] },
      { op: 'Z' },
    ],
    INK,
  );
}

function ledgerMarks(position: number, x: number, yFor: (position: number) => number): Shape[] {
  const marks: Shape[] = [];
  for (let step = -2; step >= position; step -= 2) {
    const y = yFor(step);
    marks.push(line(x - 11, y, x + 11, y, 1));
  }
  for (let step = 10; step <= position; step += 2) {
    const y = yFor(step);
    marks.push(line(x - 11, y, x + 11, y, 1));
  }
  return marks;
}

function staffPosition(note: string, treble: boolean): number {
  const spelled = spell(note);
  return treble
    ? diatonic(spelled.step, spelled.octave) - diatonic('E', 4)
    : diatonic(spelled.step, spelled.octave) - diatonic('G', 2);
}

function diatonic(step: string, octave: number): number {
  const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const index = letters.indexOf(step);
  return octave * 7 + (index < 0 ? 0 : index);
}

function staffPads(positions: readonly number[]): { above: number; below: number } {
  const min = positions.length ? Math.min(...positions) : 4;
  const max = positions.length ? Math.max(...positions) : 4;
  const stem = 28;
  const aboveLedger = Math.max(0, (max - 8) * (STAFF_SPACE / 2));
  const belowLedger = Math.max(0, -min * (STAFF_SPACE / 2));
  return {
    above: Math.max(26, aboveLedger + (max < 4 ? stem : STAFF_SPACE) + 10),
    below: Math.max(30, belowLedger + (min >= 4 ? stem : STAFF_SPACE) + 8),
  };
}

function attackSlots(
  voice: ScoreVoice,
  capture: SonificationCapture,
  eighths: number,
): (string | null)[] {
  const slots: (string | null)[] = Array.from({ length: eighths }, () => null);
  for (const mark of capture.marks) {
    if (!mark.bodyIds.includes(voice.id) || slots.length === 0) {
      continue;
    }
    const index =
      mark.beat === undefined
        ? Math.min(
            eighths - 1,
            Math.max(0, Math.floor((mark.day / (capture.spanDays || 1)) * eighths)),
          )
        : Math.min(eighths - 1, Math.max(0, Math.floor(mark.beat * 2)));
    if (!slots[index]) {
      slots[index] = writtenNote(voice, mark.beat ?? mark.day);
    }
  }
  return slots;
}

/**
 * A part whose pitch wobbles by at most a semitone across the span is written
 * on its most common note, so a steady drone reads as one pitch.
 */
function writtenNote(voice: ScoreVoice, coordinate: number): string {
  const point = nearestPoint(voice, coordinate);
  const midis = voice.points.map((item) => item.midi);
  if (midis.length === 0 || Math.max(...midis) - Math.min(...midis) > 1) {
    return point.note;
  }
  const counts = new Map<string, number>();
  for (const item of voice.points) {
    counts.set(item.note, (counts.get(item.note) ?? 0) + 1);
  }
  let chosen = point.note;
  let best = -1;
  for (const [note, count] of counts) {
    if (count > best) {
      best = count;
      chosen = note;
    }
  }
  return chosen;
}

function nearestPoint(voice: ScoreVoice, coordinate: number): ScorePoint {
  const first = voice.points[0];
  if (!first) {
    return { day: coordinate, hz: 0, midi: 60, note: 'C4' };
  }
  return voice.points.reduce((best, candidate) =>
    Math.abs((candidate.beat ?? candidate.day) - coordinate) <
    Math.abs((best.beat ?? best.day) - coordinate)
      ? candidate
      : best,
  );
}

function scoreMeasureCount(capture: SonificationCapture): number {
  if (capture.durationBeats === undefined) {
    return measureCountFor(capture.spanDays);
  }
  return Math.min(256, Math.max(1, Math.ceil(capture.durationBeats / 4)));
}

function spellRests(start: number, end: number): EngravedToken[] {
  const tokens: EngravedToken[] = [];
  let index = start;
  while (index < end) {
    const remain = end - index;
    if (index === 0 && remain === 8) {
      tokens.push({ kind: 'rest', eighths: 8, note: '', beam: 'none' });
      break;
    }
    if (index % 4 === 0 && remain >= 4) {
      tokens.push({ kind: 'rest', eighths: 4, note: '', beam: 'none' });
      index += 4;
      continue;
    }
    if (index % 2 === 0 && remain >= 2) {
      tokens.push({ kind: 'rest', eighths: 2, note: '', beam: 'none' });
      index += 2;
      continue;
    }
    tokens.push({ kind: 'rest', eighths: 1, note: '', beam: 'none' });
    index += 1;
  }
  return tokens;
}

export function describeMark(mark: ScoreMark, voiceId: string): string {
  if (mark.type === 'reference-meridian') {
    return 'crosses 0°';
  }
  if (mark.type === 'revolution') {
    return 'completes a lap';
  }
  const other = mark.bodyIds.find((id) => id !== voiceId) ?? '';
  const name = other ? planetName(other) : 'another';
  return mark.type === 'opposition' ? `opposite ${name}` : `aligns with ${name}`;
}

function formatDays(days: number): string {
  const rounded = Math.round(days * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2).replace(/0$/, '');
}

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  color: string,
  style: TextShape['style'] = 'regular',
  anchor: TextShape['anchor'] = 'start',
): TextShape {
  return { kind: 'text', x, y, text: value, size, color, style, anchor };
}

function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  color = INK,
): PathShape {
  return {
    kind: 'path',
    segments: [
      { op: 'M', p: [x1, y1] },
      { op: 'L', p: [x2, y2] },
    ],
    fill: null,
    stroke: color,
    width,
    round: false,
  };
}

function rect(x: number, y: number, w: number, h: number, color: string): PathShape {
  return filled(
    [
      { op: 'M', p: [x, y] },
      { op: 'L', p: [x + w, y] },
      { op: 'L', p: [x + w, y + h] },
      { op: 'L', p: [x, y + h] },
      { op: 'Z' },
    ],
    color,
  );
}

function circle(cx: number, cy: number, r: number, color: string): PathShape {
  return ellipse(cx, cy, r, r, 0, color);
}

function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotateDeg: number,
  color: string,
): PathShape {
  const k = 0.5522847498;
  const angle = (rotateDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at = (dx: number, dy: number): Pt => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  return filled(
    [
      { op: 'M', p: at(rx, 0) },
      { op: 'C', c1: at(rx, ry * k), c2: at(rx * k, ry), p: at(0, ry) },
      { op: 'C', c1: at(-rx * k, ry), c2: at(-rx, ry * k), p: at(-rx, 0) },
      { op: 'C', c1: at(-rx, -ry * k), c2: at(-rx * k, -ry), p: at(0, -ry) },
      { op: 'C', c1: at(rx * k, -ry), c2: at(rx, -ry * k), p: at(rx, 0) },
      { op: 'Z' },
    ],
    color,
  );
}

function stroked(segments: Segment[], width: number, color = INK): PathShape {
  return { kind: 'path', segments, fill: null, stroke: color, width, round: true };
}

function filled(segments: Segment[], color: string): PathShape {
  return { kind: 'path', segments, fill: color, stroke: null, width: 0, round: false };
}

function num(value: number): string {
  const fixed = value.toFixed(2);
  return fixed.replace(/\.?0+$/, '') || '0';
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
