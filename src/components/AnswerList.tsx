import type { Answer } from '../engine/solver';

export function AnswerList({ answers, found }: { answers: readonly Answer[]; found: ReadonlySet<string> }) {
  return (
    <ul className="max-h-[50vh] columns-2 gap-5 overflow-y-auto">
      {answers.map((a) => (
        <li key={a.word} className="flex break-inside-avoid justify-between border-b border-line py-0.5 capitalize">
          <span className={`${a.pangram ? 'font-extrabold text-accent' : ''} ${found.has(a.word) ? '' : 'opacity-60'}`}>
            {a.word}
            {found.has(a.word) && <span className="text-good"> ✓</span>}
          </span>
          <span className="text-sm tabular-nums text-muted">{a.score}</span>
        </li>
      ))}
    </ul>
  );
}
