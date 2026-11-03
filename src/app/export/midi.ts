import { RecordedPerformance, TempoChange } from './performance-capture';
import { InstrumentId } from '../sonification/sound-model';

const PPQ = 480;

const PROGRAM: Readonly<Record<InstrumentId, number>> = {
  sine: 80,
  pad: 89,
  bell: 14,
  pluck: 45,
  bass: 33,
  strings: 49,
  cello: 43,
  flute: 74,
  bassoon: 71,
  clarinet: 72,
  horn: 61,
  trumpet: 57,
  harp: 47,
  piano: 1,
};

interface MidiEvent {
  tick: number;
  order: number;
  bytes: number[];
}

/** Standard MIDI File format 1. Programs are General MIDI approximations. */
export function buildMidi(performance: RecordedPerformance): Uint8Array {
  const voices = performance.voices.filter((voice) =>
    performance.notes.some((note) => note.bodyId === voice.id),
  );
  const tracks = [tempoTrack(performance.tempos)];
  voices.forEach((voice, index) => {
    const channel = midiChannel(index);
    const events: MidiEvent[] = [
      { tick: 0, order: 0, bytes: metaText(0x03, voice.id) },
      { tick: 0, order: 1, bytes: [0xb0 | channel, 7, 100] },
    ];
    performance.notes
      .filter((note) => note.bodyId === voice.id)
      .forEach((note) => {
        const start = ticksAt(note.second, performance.tempos);
        const end = Math.max(
          start + 1,
          ticksAt(note.second + note.durationSeconds, performance.tempos),
        );
        const pitch = clamp7(note.midi);
        const velocity = Math.max(1, clamp7(Math.round(note.gain * 127)));
        events.push(
          { tick: start, order: 1, bytes: [0xc0 | channel, PROGRAM[note.instrument] - 1] },
          { tick: start, order: 2, bytes: [0xb0 | channel, 7, velocity] },
          { tick: start, order: 3, bytes: [0x90 | channel, pitch, velocity] },
          { tick: end, order: 0, bytes: [0x80 | channel, pitch, 0] },
        );
      });
    tracks.push(eventTrack(events));
  });
  return file(tracks);
}

export function ticksAt(second: number, tempos: readonly TempoChange[]): number {
  const ordered = tempos.length > 0 ? tempos : [{ second: 0, bpm: 120 }];
  let ticks = 0;
  let cursor = 0;
  let bpm = ordered[0]?.bpm ?? 120;
  for (const change of ordered.slice(1)) {
    if (change.second >= second) {
      break;
    }
    ticks += (change.second - cursor) * (bpm / 60) * PPQ;
    cursor = change.second;
    bpm = change.bpm;
  }
  ticks += Math.max(0, second - cursor) * (bpm / 60) * PPQ;
  return Math.max(0, Math.round(ticks));
}

function tempoTrack(tempos: readonly TempoChange[]): Uint8Array {
  const events: MidiEvent[] = [{ tick: 0, order: 0, bytes: metaText(0x03, 'Harmonia Mundi') }];
  for (const tempo of tempos) {
    const micros = Math.round(60000000 / Math.max(1, tempo.bpm));
    events.push({
      tick: ticksAt(tempo.second, tempos),
      order: 1,
      bytes: [0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff],
    });
  }
  return eventTrack(events);
}

function eventTrack(events: readonly MidiEvent[]): Uint8Array {
  const sorted = [...events].sort(
    (left, right) => left.tick - right.tick || left.order - right.order,
  );
  const body: number[] = [];
  let previous = 0;
  for (const event of sorted) {
    body.push(...variable(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return chunk('MTrk', body);
}

function file(tracks: readonly Uint8Array[]): Uint8Array {
  const header = chunk('MThd', [0, 1, (tracks.length >> 8) & 0xff, tracks.length & 0xff, 1, 0xe0]);
  const length = header.length + tracks.reduce((sum, track) => sum + track.length, 0);
  const output = new Uint8Array(length);
  output.set(header, 0);
  let offset = header.length;
  for (const track of tracks) {
    output.set(track, offset);
    offset += track.length;
  }
  return output;
}

function chunk(name: string, body: readonly number[]): Uint8Array {
  const output = new Uint8Array(8 + body.length);
  for (let index = 0; index < 4; index += 1) {
    output[index] = name.charCodeAt(index);
  }
  new DataView(output.buffer).setUint32(4, body.length);
  output.set(body, 8);
  return output;
}

function metaText(type: number, text: string): number[] {
  const bytes = [...new TextEncoder().encode(text)];
  return [0xff, type, ...variable(bytes.length), ...bytes];
}

function variable(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      return bytes;
    }
  }
}

function midiChannel(index: number): number {
  const channel = index % 15;
  return channel >= 9 ? channel + 1 : channel;
}

function clamp7(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}
