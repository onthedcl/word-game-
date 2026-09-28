// Loads the shipped dictionary from disk (tests and scripts; the app uses fetch).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDawg } from './dawg';

const file = (name: string) => readFileSync(fileURLToPath(new URL(`../../public/dict/${name}`, import.meta.url)), 'utf8');

export const dict = parseDawg(file('words.dawg'));
/** Every accepted answer (a superset of `dict`). */
export const accepted = parseDawg(file('words-all.dawg'));
/** Every playable word (bonus words included). */
export const full = parseDawg(file('words-full.dawg'));
export const seeds = file('pangrams.txt').split('\n').filter(Boolean);
