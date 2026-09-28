import { useState } from 'react';
import type { Answer } from '../engine/solver';

interface Props {
  found: readonly string[];
  answers: Map<string, Answer>;
  total: number;
  fresh: string | null;
  scoreOf(word: string): number;
  routeOf(word: string): number[];
  onShow(path: number[]): void;
}

export function FoundWords({ found, answers, scoreOf, routeOf, total, fresh, onShow }: Props) {
  const [open, setOpen] = useState(false);
  const [alpha, setAlpha] = useState(false);
  const words = alpha ? [...found].sort() : [...found].reverse();
  // Bonus words (uncommon but valid) score, but don't count toward the total.
  const bonus = found.filter((w) => answers.get(w)?.bonus).length;
  const counted = found.length - bonus;
  const title = `${counted} ${counted === 1 ? 'word' : 'words'} of ${total}${bonus ? ` +${bonus} bonus` : ''}`;

  const list = (
    <ul className="max-h-[50vh] columns-2 gap-4 overflow-y-auto lg:max-h-[520px]">
      {words.map((w) => {
        const a = answers.get(w)!;
        return (
          <li key={w} className={`break-inside-avoid border-b border-line ${w === fresh ? 'animate-fresh' : ''}`}>
            <button
              type="button"
              onClick={() => onShow(routeOf(w))}
              title="Show your route"
              className="flex w-full justify-between gap-2 py-1 text-left capitalize"
            >
              <span className={a.pangram ? 'font-extrabold text-accent' : ''}>
                {w}
                {a.bonus && <span className="ml-1 text-xs text-muted" title="Bonus word: scores, but isn't counted in the total">★</span>}
              </span>
              <span className="text-sm tabular-nums text-muted">{scoreOf(w)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <section className="relative rounded-xl border border-line bg-surface shadow-sm" aria-label="Found words">
      {/* Mobile: a one-line strip that expands over the board, so nothing below it moves. */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left lg:hidden"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="shrink-0 font-bold">{title}</span>
        <span className="min-w-0 flex-1 truncate capitalize text-muted">{[...found].reverse().join(' · ')}</span>
        <span className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      <div
        className={`${open ? 'block' : 'hidden'} absolute inset-x-0 top-full z-20 -mt-1 rounded-b-xl border border-t-0 border-line bg-surface px-3.5 pb-3 shadow-lg
          lg:static lg:mt-0 lg:block lg:rounded-xl lg:border-0 lg:px-4 lg:pt-3 lg:shadow-none`}
      >
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="hidden font-bold lg:block">{title}</h2>
          <button type="button" className="ml-auto text-sm text-muted underline" onClick={() => setAlpha((a) => !a)}>
            {alpha ? 'Recent' : 'A–Z'}
          </button>
        </div>
        {found.length ? list : <p className="text-sm text-muted">Your words will appear here.</p>}
      </div>
    </section>
  );
}
