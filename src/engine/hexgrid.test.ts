import { describe, expect, it } from 'vitest';
import { TILES, TILE_COUNT, CENTER, NEIGHBORS, areAdjacent, isValidRoute } from './hexgrid';

describe('hex grid', () => {
  it('has 19 tiles with the key tile at the origin', () => {
    expect(TILE_COUNT).toBe(19);
    expect(TILES[CENTER]).toMatchObject({ q: 0, r: 0 });
  });

  it('gives 6 neighbours inside, 4 on edges, 3 on corners', () => {
    expect(NEIGHBORS[CENTER]).toHaveLength(6);
    const counts = NEIGHBORS.map((n) => n.length).sort();
    expect(counts).toEqual([3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 6, 6, 6, 6, 6, 6, 6]);
  });

  it('has symmetric adjacency and no self-loops', () => {
    for (let a = 0; a < TILE_COUNT; a++) {
      expect(NEIGHBORS[a]).not.toContain(a);
      for (const b of NEIGHBORS[a]) expect(areAdjacent(b, a)).toBe(true);
    }
  });

  it('matches the axial distance definition of adjacency', () => {
    for (const a of TILES) for (const b of TILES) {
      const dist = (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
      expect(areAdjacent(a.id, b.id)).toBe(dist === 1);
    }
  });
});

describe('path validation', () => {
  const [n0, n1] = [NEIGHBORS[CENTER][0], NEIGHBORS[CENTER][1]];
  const far = TILES.findIndex((_, id) => id !== CENTER && !NEIGHBORS[CENTER].includes(id) && !areAdjacent(id, n0));

  it('accepts adjacent, non-repeating routes', () => {
    expect(isValidRoute([n0, CENTER, n1])).toBe(true);
    expect(isValidRoute([CENTER])).toBe(true);
  });
  it('rejects gaps', () => expect(isValidRoute([n0, far])).toBe(false));
  it('rejects reused tiles', () => expect(isValidRoute([n0, CENTER, n0])).toBe(false));
});
