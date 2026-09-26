// Radius-2 hex grid (19 tiles) in axial coordinates, pointy-top orientation.

export const RADIUS = 2;
const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;

export interface Tile {
  id: number;
  q: number;
  r: number;
}

function buildTiles(radius: number): Tile[] {
  const tiles: Tile[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.abs(q + r) <= radius) tiles.push({ id: tiles.length, q, r });
    }
  }
  return tiles;
}

export const TILES: readonly Tile[] = buildTiles(RADIUS);
export const TILE_COUNT = TILES.length;
export const CENTER = TILES.findIndex((t) => t.q === 0 && t.r === 0);

const indexByCoord = new Map(TILES.map((t) => [`${t.q},${t.r}`, t.id]));

export const NEIGHBORS: readonly (readonly number[])[] = TILES.map(({ q, r }) =>
  DIRECTIONS.map(([dq, dr]) => indexByCoord.get(`${q + dq},${r + dr}`)).filter((id): id is number => id !== undefined),
);

export function areAdjacent(a: number, b: number): boolean {
  return NEIGHBORS[a].includes(b);
}

// A route is a list of distinct tiles, each adjacent to the one before.
export function isValidRoute(path: readonly number[]): boolean {
  if (new Set(path).size !== path.length) return false;
  return path.every((id, i) => i === 0 || areAdjacent(path[i - 1], id));
}

// Pixel center of a tile for a hex of the given circumradius.
export function tileCenter(id: number, size: number): { x: number; y: number } {
  const { q, r } = TILES[id];
  return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
}

export function hexCorners(cx: number, cy: number, size: number): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return [cx + size * Math.cos(angle), cy + size * Math.sin(angle)];
  });
}
