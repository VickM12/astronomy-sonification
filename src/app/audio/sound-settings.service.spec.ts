import { SoundSettingsService } from './sound-settings.service';

describe('SoundSettingsService playback texture', () => {
  it('migrates old drone/event preferences and validates new texture settings', () => {
    const event = new SoundSettingsService();
    event.apply({ drones: false, pulses: true, alignments: true });
    expect(event.texture()).toBe('event');

    const continuous = new SoundSettingsService();
    continuous.apply({ drones: true, pulses: false, alignments: false });
    expect(continuous.texture()).toBe('continuous');

    const hybrid = new SoundSettingsService();
    hybrid.apply({ texture: 'hybrid', relationshipAmount: 2 });
    expect(hybrid.texture()).toBe('hybrid');
    expect(hybrid.relationshipAmount()).toBe(1);
  });
});
