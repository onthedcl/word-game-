import { describe, expect, it } from 'vitest';
import { randomName } from './randomName';
import { cleanName } from '../server/names';

describe('randomName', () => {
  it('always makes a name the server accepts as is', () => {
    for (let i = 0; i < 5000; i++) {
      const name = randomName();
      expect(cleanName(name)).toBe(name);
    }
  });
});
