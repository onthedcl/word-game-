import type { Puzzle } from '../engine/generator';

export type PuzzleRequest = { type: 'daily'; dateKey: string } | { type: 'blitz'; seed: string };
export type WorkerRequest = { id: number; request: PuzzleRequest };
export type WorkerResponse = { id: number; puzzle: Puzzle } | { id: number; error: string };
