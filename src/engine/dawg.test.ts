import { describe, expect, it } from 'vitest';
import { parseDawg } from './dawg';
import { dict } from './node-dict';

describe('DAWG dictionary', () => {
  it('loads the shipped dictionary', () => {
    expect(dict.wordCount).toBeGreaterThan(20000);
    for (const w of ['bracket', 'water', 'word', 'puzzle']) expect(dict.contains(w)).toBe(true);
    for (const w of ['brack', 'xqzv', '', 'wordz']) expect(dict.contains(w)).toBe(false);
  });

  it('lists words spellable from a letter set', () => {
    const words = dict.wordsFrom(['a', 'b', 'c', 'e', 'k', 'r', 't']);
    expect(words).toContain('bracket');
    expect(words).toContain('tact'); // letters may repeat
    expect(words.every((w) => /^[abcekrt]+$/.test(w))).toBe(true);
  });

  it('round-trips a hand-written dawg', () => {
    // root -a-> 1 -t-> 2(!) ; root -i-> 1  => "at", "it"
    const d = parseDawg('HEXDAWG1 3 2\na1,i1\nt2\n!\n');
    expect(d.wordsFrom(['a', 'i', 't'])).toEqual(['at', 'it']);
    expect(d.contains('a')).toBe(false);
  });
});
