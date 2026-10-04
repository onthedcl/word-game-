// Past boards: every daily board so far, and for each one the board itself, your
// result and the colour-coded answers.
import { Board } from './Board';
import { AnswerList } from './AnswerList';
import type { Board as Standings } from '../api';
import type { Puzzle } from '../engine/generator';
import { DIFFICULTY_NAMES, OPEN_LETTERS_FROM, weekdayIndex } from '../engine/generator';
import { boardLocksAt, EPOCH, puzzleNumber, shiftDateKey } from '../engine/dates';

/** "3:00 AM" in the player's own time zone. */
const LOCAL_TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
/** "Sun 9/27" */
const dayLabel = (dateKey: string) => {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${WEEKDAY.format(new Date(`${dateKey}T12:00:00Z`))} ${m}/${d}`;
};
const MEDALS = ['🥇', '🥈', '🥉'];

interface Props {
  /** Today's date; the archive lists every day before it. */
  today: string;
  colors: readonly string[];
  selected: string | null;
  onSelect(dateKey: string | null): void;
  /** Words found on a day (saved on this device). */
  foundCount(dateKey: string): number;
  /** The selected day's board, once built. */
  puzzle: { puzzle?: Puzzle; error?: string } | null;
  found: ReadonlySet<string>;
  /** The selected day's final standings, once the board has locked. */
  standings: Standings | null;
  locked: boolean;
  onSeeResults(): void;
}

const noop = () => {};

export function Archive({ today, colors, selected, onSelect, foundCount, puzzle, found, standings, locked, onSeeResults }: Props) {
  if (!selected) {
    const days: string[] = [];
    for (let d = shiftDateKey(today, -1); d >= EPOCH; d = shiftDateKey(d, -1)) days.push(d);
    if (!days.length) return <p className="text-muted">DPIYF Lettertown #1 is today. Check back tomorrow.</p>;
    return (
      <ul className="max-h-[60vh] overflow-y-auto">
        {days.map((d) => {
          const difficulty = d >= OPEN_LETTERS_FROM ? weekdayIndex(d) : null;
          const n = foundCount(d);
          return (
            <li key={d} className="border-b border-line">
              <button type="button" onClick={() => onSelect(d)} className="flex w-full items-center gap-3 py-2.5 text-left">
                <span className="w-8 font-bold tabular-nums text-muted">#{puzzleNumber(d)}</span>
                <span className="min-w-0 flex-1 whitespace-nowrap font-semibold">{d === shiftDateKey(today, -1) ? 'Yesterday' : dayLabel(d)}</span>
                {difficulty !== null && (
                  <span className={`rounded-full px-2 py-px text-xs font-bold text-white ${colors[difficulty]}`}>{DIFFICULTY_NAMES[difficulty]}</span>
                )}
                <span className="whitespace-nowrap text-right text-sm text-muted">{n ? `${n} ${n === 1 ? 'word' : 'words'}` : 'not played'}</span>
                <span className="text-muted">›</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  const p = puzzle?.puzzle;
  return (
    <div>
      <button type="button" onClick={() => onSelect(null)} className="mb-2 text-sm text-muted underline">← All boards</button>
      {!p ? (
        <p className="text-muted">{puzzle?.error ?? 'Loading…'}</p>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">
            <b className="text-ink">#{p.number} · {dayLabel(selected)}</b> · Letters{' '}
            <b className="text-ink">{p.letters.join(' ').toUpperCase()}</b>, key <b className="text-ink">{p.centerLetter.toUpperCase()}</b> ·{' '}
            {p.answers.length} words · {p.maxScore} points
          </p>
          <div className="pointer-events-none relative mx-auto mb-3 aspect-[440/400] w-[230px]" aria-hidden>
            <Board board={p.board} path={[]} flashPath={null} shakeKey={0} onPress={noop} onDrag={noop} onRelease={noop} />
          </div>
          {standings?.you ? (
            <button
              type="button"
              onClick={onSeeResults}
              className="mb-3 flex w-full items-center gap-2 rounded-xl bg-key/25 px-3 py-2 text-left font-semibold"
            >
              <span className="text-xl">{MEDALS[standings.you.position - 1] ?? '🎖️'}</span>
              <span className="flex-1">You finished #{standings.you.position} of {standings.total}</span>
              <span className="text-sm text-muted underline">See results</span>
            </button>
          ) : null}
          {locked ? (
            <AnswerList answers={p.answers} bonus={p.bonus} found={found} />
          ) : (
            <>
              {/* Still open: show only your own words, so the answers can't be read here and
                  entered before the board closes. */}
              <p className="mb-3 rounded-xl bg-bg p-3 text-sm">
                This board is still open. The words you missed appear at{' '}
                <b>{LOCAL_TIME.format(boardLocksAt(selected))}</b>, once it closes for everyone.
              </p>
              <AnswerList answers={p.answers} bonus={p.bonus} found={found} hideMissed />
            </>
          )}
        </>
      )}
    </div>
  );
}
