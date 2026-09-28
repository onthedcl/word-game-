// Yesterday's final top 3, with confetti, for a player who made the podium.
import type { Board } from '../api';

const MEDALS = ['🥇', '🥈', '🥉'];
const PLACES = ['1st', '2nd', '3rd'];
// Podium order left to right: 2nd, 1st, 3rd.
const STEPS = [
  { place: 2, height: 'h-16' },
  { place: 1, height: 'h-24' },
  { place: 3, height: 'h-12' },
];
const CONFETTI_COLORS = ['#e0a526', '#2f855a', '#3b82f6', '#e76f8a', '#f2c94c', '#8b5cf6'];

interface Props {
  board: Board;
  onShare(): void;
  onClose(): void;
}

export function Podium({ board, onShare, onClose }: Props) {
  const you = board.you!;
  return (
    <div className="relative text-center">
      <div className="pointer-events-none absolute inset-x-0 -top-6 h-72 overflow-hidden" aria-hidden>
        {Array.from({ length: 36 }, (_, i) => (
          <span
            key={i}
            className="confetti"
            style={{
              left: `${(i * 37) % 100}%`,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              animationDelay: `${(i % 12) * 0.12}s`,
              animationDuration: `${2.2 + (i % 5) * 0.35}s`,
            }}
          />
        ))}
      </div>

      <div className="animate-banner-in text-6xl">{MEDALS[you.position - 1]}</div>
      <p className="mt-2 text-2xl font-black">
        You finished {PLACES[you.position - 1]}!
      </p>
      <p className="mt-1 text-muted">
        out of {board.total} players on yesterday's board, with <b className="text-ink">{you.score}</b> points
      </p>

      <div className="mt-6 flex items-end justify-center gap-2">
        {STEPS.map(({ place, height }) => {
          const r = board.top[place - 1];
          if (!r) return <div key={place} className="w-24" />;
          return (
            <div key={place} className="w-24">
              <div className={`mb-1 truncate text-sm ${r.you ? 'font-black text-ink' : 'text-muted'}`}>{r.you ? 'You' : r.name}</div>
              <div className="text-xs tabular-nums text-muted">{r.score}</div>
              <div
                className={`podium-step mt-1 flex ${height} items-start justify-center rounded-t-lg pt-1 text-2xl ${
                  r.you ? 'bg-key text-key-ink shadow-lg' : 'bg-line'
                }`}
                style={{ animationDelay: `${(3 - place) * 0.15}s` }}
              >
                {MEDALS[place - 1]}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={onShare} className="whitespace-nowrap rounded-full bg-ink px-4 py-2.5 font-bold text-bg active:scale-95">
          Share my win
        </button>
        <button type="button" onClick={onClose} className="whitespace-nowrap rounded-full border border-line px-4 py-2.5 font-semibold active:scale-95">
          Play today's
        </button>
      </div>
    </div>
  );
}
