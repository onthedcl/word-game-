import { memo, useMemo, useRef } from 'react';
import { TILES, CENTER, tileCenter, hexCorners } from '../engine/hexgrid';
import { LETTER_VALUES, PREMIUMS, type Board as BoardData } from '../engine/scoring';

const SIZE = 50;
const CENTERS = TILES.map((t) => tileCenter(t.id, SIZE));
const points = (path: readonly number[]) => path.map((id) => `${CENTERS[id].x},${CENTERS[id].y}`).join(' ');

interface Props {
  board: BoardData;
  path: readonly number[];
  flashPath: readonly number[] | null;
  shakeKey: number;
  disabled?: boolean;
  /** Pointer pressed on a tile. */
  onPress(id: number): void;
  /** Pointer dragged onto a tile while pressed. */
  onDrag(id: number): void;
  onRelease(): void;
}

const Tile = memo(function Tile({ id, letter, premium, selected, flash }: {
  id: number; letter: string; premium: keyof typeof PREMIUMS | null; selected: boolean; flash: boolean;
}) {
  const { x, y } = CENTERS[id];
  const key = id === CENTER;
  const cls = ['tile', key && 'key', premium && `prem-${premium}`, selected && 'selected', flash && 'flash']
    .filter(Boolean).join(' ');
  const label = `${letter.toUpperCase()}${premium ? `, ${PREMIUMS[premium].name}` : ''}${key ? ', key tile' : ''}`;
  return (
    <g className={cls} role="gridcell" aria-label={label} aria-selected={selected}>
      <polygon points={hexCorners(x, y, SIZE - 3).map((p) => p.join(',')).join(' ')} />
      <text x={x} y={y + 2} className="letter">{letter.toUpperCase()}</text>
      <text x={x + 19} y={y + 25} className="value">{LETTER_VALUES[letter]}</text>
      {(premium || key) && <text x={x} y={y - 26} className="badge">{key ? 'KEY' : premium}</text>}
    </g>
  );
});

export function Board({ board, path, flashPath, shakeKey, disabled, onPress, onDrag, onRelease }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const selected = useMemo(() => new Set(path), [path]);
  const flashing = useMemo(() => new Set(flashPath ?? []), [flashPath]);

  function tileAt(e: React.PointerEvent, radius: number): number | null {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best = -1;
    let bestDist = Infinity;
    CENTERS.forEach((c, id) => {
      const d = Math.hypot(c.x - pt.x, c.y - pt.y);
      if (d < bestDist) [best, bestDist] = [id, d];
    });
    return bestDist <= radius ? best : null;
  }

  return (
    <svg
      ref={svg}
      key={shakeKey}
      viewBox="-220 -200 440 400"
      role="grid"
      aria-label="Schmexicon board"
      className={`w-full max-w-[440px] touch-none select-none overflow-visible ${shakeKey ? 'animate-shake' : ''} ${disabled ? 'opacity-50' : ''}`}
      onPointerDown={(e) => {
        if (disabled) return;
        const id = tileAt(e, SIZE * 0.95);
        if (id === null) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        onPress(id);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        // Tighter than the press radius so cutting a corner doesn't grab a neighbour.
        const id = tileAt(e, SIZE * 0.72);
        if (id !== null) onDrag(id);
      }}
      onPointerUp={() => {
        if (!dragging.current) return;
        dragging.current = false;
        onRelease();
      }}
      onPointerCancel={() => (dragging.current = false)}
    >
      <g>
        {TILES.map(({ id }) => (
          <Tile
            key={id}
            id={id}
            letter={board.letters[id]}
            premium={board.premiums[id]}
            selected={selected.has(id)}
            flash={flashing.has(id)}
          />
        ))}
      </g>
      <polyline className="trace" points={points(path)} />
      {flashPath && <polyline className="trace flash-line" points={points(flashPath)} />}
    </svg>
  );
}
