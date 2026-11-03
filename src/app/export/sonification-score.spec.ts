import { AstronomyService } from '../astronomy/astronomy.service';
import { defaultMixes } from '../audio/sound-settings.service';
import { defaultPitchSettings } from '../sonification/sound-model';
import { buildScorePdf, buildScoreSvg, engraveVoice, spellMeasure } from './score-engraving';
import { buildMusicXml, buildSpectrumSvg, captureSonification } from './sonification-score';

const START = new Date('2000-01-01T12:00:00.000Z');

describe('sonification score export', () => {
  const astronomy = new AstronomyService();

  function capture(hiddenIds: string[] = []) {
    return captureSonification(astronomy, {
      start: START,
      spanDays: 30,
      includeMoons: false,
      pitch: { ...defaultPitchSettings(), motion: 'fixed' },
      mixes: defaultMixes(),
      hiddenIds,
      pulses: true,
      alignments: true,
    });
  }

  it('draws the sounding planets and omits an unchecked one', () => {
    const score = capture(['venus']);
    const svg = buildSpectrumSvg(score);
    const xml = buildMusicXml(score);

    expect(score.voices.map((voice) => voice.id)).toContain('mercury');
    expect(score.voices.map((voice) => voice.id)).not.toContain('venus');
    expect(svg).toContain('Mercury');
    expect(svg).toContain('not a spectrum of a recording');
    expect(xml).toContain('<part-name>Mercury</part-name>');
    expect(xml).not.toContain('<part-name>Venus</part-name>');
    expect(xml).toContain('<step>');
    expect(xml).toContain('nearest equal-tempered');
    const scoreSvg = buildScoreSvg(score);
    expect(scoreSvg).toContain('Mercury');
    expect(scoreSvg).toContain('Hz');
    expect(scoreSvg).toContain('4/4');
    expect(scoreSvg).toContain('Sempre staccato');
    expect(scoreSvg).not.toContain('aligns with');
    expect(scoreSvg).not.toContain('Venus');
    expect(score.marks.length).toBeGreaterThan(0);
    const bars = engraveVoice(score, 'mercury');
    expect(bars.length).toBeGreaterThan(0);
    for (const voice of score.voices) {
      for (const bar of engraveVoice(score, voice.id)) {
        expect(bar.reduce((sum, token) => sum + token.eighths, 0)).toBe(8);
      }
    }
    expect(
      score.voices.some((voice) =>
        engraveVoice(score, voice.id).some((bar) => bar.some((token) => token.kind === 'note')),
      ),
    ).toBe(true);
    for (const voice of score.voices) {
      expect(voice.points.every((point) => point.hz > 0)).toBe(true);
    }
  });

  it('writes a well-formed ASCII PDF with one page per filled system', () => {
    const score = capture();
    const pdf = buildScorePdf(score);

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(/[^\x00-\x7f]/.test(pdf)).toBe(false);
    expect(pdf).toContain('/Type /Page ');
    expect(pdf).toContain('(Mercury) Tj');
    expect(pdf).toContain('Sempre staccato');
    const count = /\/Count (\d+)/.exec(pdf);
    expect(Number(count?.[1])).toBeGreaterThan(0);
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const firstOffset = Number(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/.exec(pdf)?.[1]);
    expect(pdf.slice(firstOffset, firstOffset + 7)).toBe('1 0 obj');
  });

  it('labels parts with their instrument in musical mode', () => {
    const mixes = defaultMixes();
    mixes.mars = { ...mixes.mars, instrument: 'horn' };
    const score = captureSonification(astronomy, {
      start: START,
      spanDays: 30,
      includeMoons: false,
      pitch: { ...defaultPitchSettings(), mode: 'musical', motion: 'fixed' },
      mixes,
      hiddenIds: [],
      pulses: true,
      alignments: true,
    });
    expect(score.voices.find((voice) => voice.id === 'mars')?.instrument).toBe('French horn');
    expect(buildScoreSvg(score)).toContain('French horn');
    expect(buildScorePdf(score)).toContain('(French horn) Tj');
  });

  it('spells quarters, beamed eighths, and rests that fill a 4/4 bar', () => {
    const empty = spellMeasure([null, null, null, null, null, null, null, null]);
    expect(empty).toEqual([{ kind: 'rest', eighths: 8, note: '', beam: 'none' }]);

    const quarter = spellMeasure(['C4', null, null, null, null, null, null, null]);
    expect(quarter[0]).toEqual({ kind: 'note', eighths: 2, note: 'C4', beam: 'none' });
    expect(quarter.reduce((sum, token) => sum + token.eighths, 0)).toBe(8);

    const eighths = spellMeasure(['E5', 'G5', null, null, null, null, null, null]);
    expect(eighths[0]).toEqual({ kind: 'note', eighths: 1, note: 'E5', beam: 'begin' });
    expect(eighths[1]).toEqual({ kind: 'note', eighths: 1, note: 'G5', beam: 'end' });

    const offbeat = spellMeasure([null, 'A4', null, null, null, null, null, null]);
    expect(offbeat[0]).toEqual({ kind: 'rest', eighths: 1, note: '', beam: 'none' });
    expect(offbeat[1]).toEqual({ kind: 'note', eighths: 1, note: 'A4', beam: 'none' });
    expect(offbeat.reduce((sum, token) => sum + token.eighths, 0)).toBe(8);
  });
});
