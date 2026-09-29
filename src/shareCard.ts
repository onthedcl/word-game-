// "Your town map": a spoiler-free share image. The day's hex board without letters,
// each tile glowing by how many of your words passed through it.
import { CENTER, TILE_COUNT, hexCorners, tileCenter } from './engine/hexgrid';
import type { Answer } from './engine/solver';
import type { Routes } from './engine/game';

/** How many found words used each tile (their traced route, or best route if typed). */
export function tileHeat(found: readonly string[], routes: Routes, answers: Map<string, Answer>): number[] {
  const heat = new Array<number>(TILE_COUNT).fill(0);
  for (const w of found) for (const id of routes[w] ?? answers.get(w)?.path ?? []) heat[id]++;
  return heat;
}

// Cream → gold → orange → ember, by share of the busiest tile.
const STOPS: [number, [number, number, number]][] = [
  [0, [236, 227, 207]],
  [0.35, [246, 196, 69]],
  [0.7, [232, 117, 42]],
  [1, [184, 59, 26]],
];
function heatColor(t: number): string {
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
    }
  }
  return 'rgb(184,59,26)';
}

export interface CardInfo {
  title: string; // "Lettertown #5"
  subtitle: string; // "Mon 9/28 · Easy"
  lines: string[]; // stats lines
  footer: string;
}

export async function drawShareCard(heat: readonly number[], info: CardInfo): Promise<Blob | null> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = (px: number, weight = 800) => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  ctx.fillStyle = '#f5efe2';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#c28a12';
  ctx.font = font(34, 900);
  ctx.fillText('DPIYF', W / 2, 110);
  ctx.fillStyle = '#2b2317';
  ctx.font = font(84, 900);
  ctx.fillText(info.title, W / 2, 195);
  ctx.fillStyle = '#6b665c';
  ctx.font = font(38, 600);
  ctx.fillText(info.subtitle, W / 2, 255);

  // The honeycomb.
  const size = 76;
  const cx = W / 2;
  const cy = 640;
  const max = Math.max(1, ...heat);
  for (let id = 0; id < TILE_COUNT; id++) {
    const { x, y } = tileCenter(id, size);
    const pts = hexCorners(cx + x, cy + y, size - 6);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = heatColor(heat[id] / max);
    ctx.fill();
    ctx.lineWidth = id === CENTER ? 10 : 4;
    ctx.strokeStyle = id === CENTER ? '#2b2317' : 'rgba(43,35,23,0.18)';
    ctx.stroke();
    if (id === CENTER) {
      ctx.font = font(54, 400);
      ctx.fillText('🔑', cx + x, cy + y + 19);
    }
  }

  ctx.fillStyle = '#2b2317';
  info.lines.forEach((line, i) => {
    ctx.font = font(i === 0 ? 56 : 40, i === 0 ? 900 : 700);
    ctx.fillText(line, W / 2, 1050 + i * 64 + (i ? 12 : 0));
  });
  ctx.fillStyle = '#6b665c';
  ctx.font = font(32, 600);
  ctx.fillText(info.footer, W / 2, H - 70);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Share the card with the system share sheet, if this browser can share images. */
export async function shareCard(blob: Blob, text: string): Promise<boolean> {
  const file = new File([blob], 'lettertown.png', { type: 'image/png' });
  if (!navigator.canShare?.({ files: [file] }) || !matchMedia('(pointer: coarse)').matches) return false;
  try {
    await navigator.share({ files: [file], text });
    return true;
  } catch (err) {
    // Dismissing the share sheet counts as done; anything else falls back to text.
    return err instanceof DOMException && err.name === 'AbortError';
  }
}
