import { rankThresholds, type RANKS } from '../engine/scoring';

interface Props {
  score: number;
  maxScore: number;
  rank: { name: (typeof RANKS)[number]['name']; index: number; next: { name: string; points: number } | null };
  extra?: React.ReactNode;
  /** Shown at the right end of the "points to next rank" line. */
  note?: React.ReactNode;
}

export function RankBar({ score, maxScore, rank, extra, note }: Props) {
  const thresholds = rankThresholds(maxScore);
  const cur = thresholds[rank.index];
  const within = rank.next ? (score - cur.points) / Math.max(1, rank.next.points - cur.points) : 1;
  const pct = ((rank.index + Math.min(1, within)) / (thresholds.length - 1)) * 100;

  return (
    <section aria-label="Score and rank">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-extrabold">{rank.name}</span>
        {extra}
        <span className="text-lg font-extrabold tabular-nums" aria-label="Score">{score}</span>
      </div>
      <div className="relative mx-[7px] mt-1.5 mb-0.5 h-[18px]" aria-hidden>
        <div className="absolute inset-x-0 top-[7px] h-1 rounded bg-line">
          <div className="h-full rounded bg-key transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        {thresholds.map((t, i) => (
          <span
            key={t.name}
            title={`${t.name}: ${t.points}`}
            className={`absolute top-[3px] -ml-1.5 size-3 rounded-full border-2 transition-colors ${
              i <= rank.index ? 'border-key bg-key' : 'border-line bg-surface'
            }`}
            style={{ left: `${(i / (thresholds.length - 1)) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-sm text-muted">
        <p>{rank.next ? `${rank.next.points - score} points to ${rank.next.name}` : 'You hold the Key to the City!'}</p>
        {note}
      </div>
    </section>
  );
}
