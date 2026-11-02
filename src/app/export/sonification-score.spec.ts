import { AstronomyService } from '../astronomy/astronomy.service';
import { defaultMixes } from '../audio/sound-settings.service';
import { defaultPitchSettings } from '../sonification/sound-model';
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
    for (const voice of score.voices) {
      expect(voice.points.every((point) => point.hz > 0)).toBe(true);
    }
  });
});
