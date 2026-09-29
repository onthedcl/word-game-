import type { Answer } from '../engine/solver';

interface Props {
  answers: readonly Answer[];
  found: ReadonlySet<string>;
  /** Accepted uncommon words; the ones the player found are listed after the key. */
  bonus?: readonly Answer[];
}

/** Every answer, coloured by whether the player got it, with a key. */
export function AnswerList({ answers, found, bonus = [] }: Props) {
  const got = answers.filter((a) => found.has(a.word)).length;
  const bonusFound = bonus.filter((a) => found.has(a.word));
  const dot = 'inline-block size-2.5 rounded-full';
  return (
    <div>
      <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Key">
        <span className="flex items-center gap-1.5"><span className={`${dot} bg-good`} /> Got it ({got})</span>
        <span className="flex items-center gap-1.5"><span className={`${dot} bg-bad`} /> Missed ({answers.length - got})</span>
        {answers.some((a) => a.pangram) && (
          <span className="flex items-center gap-1.5"><b>Bold</b> = pangram</span>
        )}
      </p>
      <ul className="max-h-[50vh] columns-2 gap-5 overflow-y-auto">
        {answers.map((a) => {
          const hit = found.has(a.word);
          return (
            <li
              key={a.word}
              className={`mb-0.5 flex break-inside-avoid items-center justify-between rounded px-1.5 py-0.5 capitalize ${
                hit ? 'bg-good/15' : 'bg-bad/10'
              }`}
            >
              <span className={`${hit ? 'text-good' : 'text-bad'} ${a.pangram ? 'font-extrabold' : ''}`}>
                {hit ? '✓ ' : ''}
                {a.word}
              </span>
              <span className="text-sm tabular-nums text-muted">{a.score}</span>
            </li>
          );
        })}
      </ul>
      {bonusFound.length > 0 && (
        <p className="mt-2 text-sm text-muted">
          <b className="text-ink">★ Bonus words you found:</b> <span className="capitalize">{bonusFound.map((a) => a.word).join(', ')}</span>
        </p>
      )}
    </div>
  );
}
