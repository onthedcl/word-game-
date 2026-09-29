import { describe, expect, it } from 'vitest';
import { buildDigest, type Notification } from './digest';

const ping = (event: Notification['event'], title = 't', message = 'm'): Notification => ({ title, message, event });

describe('notification digest', () => {
  it('sends a lone ping as it is', () => {
    expect(buildDigest([])).toBeNull();
    expect(buildDigest([{ title: 'New player!', message: 'hi', tags: ['tada'] }])).toEqual({ title: 'New player!', message: 'hi', tags: ['tada'] });
  });

  it('sums up a busy hour in a few lines', () => {
    const d = buildDigest([
      ping({ kind: 'new', place: '🇺🇸 New York City, NY', today: 30 }),
      ping({ kind: 'new', place: '🇺🇸 New York City, NY', today: 31 }),
      ping({ kind: 'new', who: 'RL', place: '🇺🇸 Denver, CO', today: 32 }),
      ping({ kind: 'back', who: 'Castle', days: 3, today: 33 }),
      ping({ kind: 'back', days: 2, today: 34 }),
      ping({ kind: 'joined', who: 'Bean' }),
      ping({ kind: 'blitz', who: 'Poop', score: 86, best: false }),
      ping({ kind: 'blitz', who: 'Poop', score: 154, best: true }),
      ping({ kind: 'allwords', who: 'stOri', words: 49, score: 516 }),
      ping({ kind: 'device', who: 'J-ojo' }),
      ping({ kind: 'device', who: 'J-ojo' }),
      ping({ kind: 'suggest', word: 'lites' }),
      ping({ kind: 'suggest', word: 'lites' }),
      ping({ kind: 'suggest', word: 'selfies' }),
      { title: 'Something else', message: 'odd one' },
    ])!;
    expect(d.title).toBe('Lettertown: 34 players today');
    expect(d.tags).toEqual(['trophy']);
    expect(d.message.split('\n')).toEqual([
      '🏆 stOri found all 49 words (516 pts)',
      '🎉 3 new players from New York City, NY ×2, Denver, CO (RL)',
      '👋 2 returning players: Castle (day 3), 1 without a name',
      '🏷️ New names: Bean',
      '⚡ 2 Blitz games: Poop 154',
      '📝 Word suggestions: lites ×2, selfies (add with the Add words workflow)',
      '📱 Picked up on another device: J-ojo',
      'Something else: odd one',
    ]);
  });
});
