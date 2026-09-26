import { useCallback, useEffect, useMemo, useState } from 'react';
import { PuzzleView } from './components/PuzzleView';
import { BulbIcon, CalendarIcon, ShareIcon } from './components/Icons';
import { Modal } from './components/Modal';
import { Rules } from './components/Rules';
import { HintGrid } from './components/HintGrid';
import { AnswerList } from './components/AnswerList';
import { requestPuzzle } from './worker/client';
import { dailyKey, readStored, useStoredState, writeStored } from './storage';
import { dateKeyFor, EPOCH, isDateKey, shiftDateKey } from './engine/dates';
import { answerIndex, progress } from './engine/game';
import { hintGrid } from './engine/hints';
import { shareText } from './engine/share';
import { useUpdateCheck } from './updates';
import type { Puzzle } from './engine/generator';

const BLITZ_SECONDS = 180;
type Mode = 'daily' | 'blitz';
type Dialog = null | 'rules' | 'hints' | 'yesterday' | 'blitz-over';
type Blitz =
  | { phase: 'intro' }
  | { phase: 'loading' }
  | { phase: 'playing' | 'over'; puzzle: Puzzle; found: string[]; endsAt: number; newBest?: boolean };

function initialDateKey(): string {
  // ?date=YYYY-MM-DD replays (or previews) any day's board.
  const param = new URLSearchParams(location.search).get('date');
  return isDateKey(param) && param >= EPOCH ? param : dateKeyFor();
}

async function share(text: string): Promise<string> {
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text });
      return '';
    }
    await navigator.clipboard.writeText(text);
    return 'Copied to clipboard';
  } catch {
    return 'Could not share';
  }
}

function usePuzzle(dateKey: string | null) {
  const [state, setState] = useState<{ key: string; puzzle?: Puzzle; error?: string } | null>(null);
  useEffect(() => {
    if (!dateKey) return;
    let live = true;
    requestPuzzle({ type: 'daily', dateKey }).then(
      (puzzle) => live && setState({ key: dateKey, puzzle }),
      (err: Error) => live && setState({ key: dateKey, error: err.message }),
    );
    return () => {
      live = false;
    };
  }, [dateKey]);
  return state?.key === dateKey ? state : null;
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() => (location.hash === '#blitz' ? 'blitz' : 'daily'));
  const [dialog, setDialog] = useState<Dialog>(() => (readStored('hexicon:seen-rules', false) ? null : 'rules'));
  const [notice, setNotice] = useState('');
  const [dateKey] = useState(initialDateKey);

  // ---- daily ----------------------------------------------------------------
  const daily = usePuzzle(dateKey);
  const [dailyFound, setDailyFound] = useStoredState<{ found: string[] }>(dailyKey(dateKey), { found: [] });
  const yesterdayKey = shiftDateKey(dateKey, -1);
  const yesterday = usePuzzle(dialog === 'yesterday' && yesterdayKey >= EPOCH ? yesterdayKey : null);

  // ---- blitz ----------------------------------------------------------------
  const [blitz, setBlitz] = useState<Blitz>({ phase: 'intro' });
  const [best, setBest] = useStoredState('hexicon:blitz-best', 0);
  const [now, setNow] = useState(() => Date.now());

  const startBlitz = useCallback(async () => {
    setBlitz({ phase: 'loading' });
    const seed = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    try {
      const puzzle = await requestPuzzle({ type: 'blitz', seed });
      setNow(Date.now());
      setBlitz({ phase: 'playing', puzzle, found: [], endsAt: Date.now() + BLITZ_SECONDS * 1000 });
    } catch {
      setBlitz({ phase: 'intro' });
      setNotice('Could not build a board');
    }
  }, []);

  useEffect(() => {
    if (blitz.phase !== 'playing') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [blitz.phase]);

  useEffect(() => {
    if (blitz.phase === 'playing' && now >= blitz.endsAt) {
      const score = progress(blitz.puzzle, answerIndex(blitz.puzzle), blitz.found).score;
      if (score > best) setBest(score);
      setBlitz({ ...blitz, phase: 'over', newBest: score > best });
      setDialog('blitz-over');
    }
  }, [now, blitz, best, setBest]);

  // ---- shared ---------------------------------------------------------------
  // Never reload out from under a Blitz round; daily progress is saved, so that's safe.
  const { updateReady, reload } = useUpdateCheck(blitz.phase !== 'playing' && blitz.phase !== 'loading');

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 1800);
    return () => clearTimeout(t);
  }, [notice]);

  const active =
    mode === 'daily'
      ? daily?.puzzle && { puzzle: daily.puzzle, found: dailyFound.found }
      : blitz.phase === 'playing' || blitz.phase === 'over'
        ? { puzzle: blitz.puzzle, found: blitz.found }
        : null;

  const activeAnswers = useMemo(() => (active ? answerIndex(active.puzzle) : null), [active?.puzzle]);

  async function onShare() {
    if (!active || !activeAnswers) return;
    const p = progress(active.puzzle, activeAnswers, active.found);
    const text = shareText(active.puzzle, {
      rankName: p.rank.name, rankIndex: p.rank.index, score: p.score, words: active.found.length, pangrams: p.pangramsFound,
    });
    const msg = await share(text);
    if (msg) setNotice(msg);
  }

  function closeDialog() {
    if (dialog === 'rules') writeStored('hexicon:seen-rules', true);
    setDialog(null);
  }

  function switchMode(m: Mode) {
    setMode(m);
    history.replaceState(null, '', `${location.pathname}${location.search}${m === 'blitz' ? '#blitz' : ''}`);
  }

  const secondsLeft = blitz.phase === 'playing' ? Math.max(0, Math.ceil((blitz.endsAt - now) / 1000)) : 0;
  const timer = blitz.phase === 'playing' && (
    <span className={`font-mono text-lg font-bold tabular-nums ${secondsLeft <= 15 ? 'text-bad' : ''}`} aria-label="Time left">
      {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
    </span>
  );

  const headerBtn = 'rounded-full border border-line py-1 text-sm hover:border-muted disabled:opacity-40';
  const textBtn = `${headerBtn} px-2.5 sm:px-3`;
  const iconBtn = `${headerBtn} flex h-8 min-w-8 items-center justify-center gap-1.5 sm:px-3`;
  const label = (text: string) => <span className="hidden sm:inline">{text}</span>;
  const tab = (m: Mode) =>
    `rounded-full px-2.5 py-1 sm:px-3 text-sm font-semibold ${mode === m ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-8">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight">Hexicon</h1>
          {mode === 'daily' && daily?.puzzle && <span className="text-sm text-muted">#{daily.puzzle.number}</span>}
        </div>
        <nav className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-full border border-line p-0.5 sm:mr-1" role="tablist" aria-label="Mode">
            <button type="button" role="tab" aria-selected={mode === 'daily'} className={tab('daily')} onClick={() => switchMode('daily')}>Daily</button>
            <button type="button" role="tab" aria-selected={mode === 'blitz'} className={tab('blitz')} onClick={() => switchMode('blitz')}>Blitz</button>
          </div>
          <button type="button" className={iconBtn} onClick={() => setDialog('hints')} disabled={!active} aria-label="Hints"><BulbIcon />{label('Hints')}</button>
          {mode === 'daily' && (
            <button type="button" className={iconBtn} onClick={() => setDialog('yesterday')} aria-label="Yesterday's answers"><CalendarIcon />{label('Yesterday')}</button>
          )}
          <button type="button" className={iconBtn} onClick={onShare} disabled={!active} aria-label="Share"><ShareIcon />{label('Share')}</button>
          <button type="button" className={`${headerBtn} h-8 w-8 font-bold`} onClick={() => setDialog('rules')} aria-label="How to play">?</button>
        </nav>
      </header>

      {notice && (
        <div role="status" className="fixed top-16 left-1/2 z-30 -translate-x-1/2 rounded-md bg-ink px-3 py-1 text-sm font-semibold text-bg">{notice}</div>
      )}

      {updateReady && (
        <button
          type="button"
          onClick={reload}
          className="mt-3 w-full rounded-lg bg-key px-3 py-2 text-sm font-semibold text-key-ink"
        >
          A new version of Hexicon is ready. Tap to update.
        </button>
      )}

      <main className="pt-4">
        {mode === 'daily' &&
          (daily?.puzzle ? (
            <PuzzleView
              puzzle={daily.puzzle}
              found={dailyFound.found}
              onFound={(w) => setDailyFound((s) => ({ found: [...s.found, w] }))}
              keyboard={dialog === null}
            />
          ) : (
            <p className="py-24 text-center text-muted">{daily?.error ? `Could not load the puzzle: ${daily.error}` : "Building today's board…"}</p>
          ))}

        {mode === 'blitz' &&
          (blitz.phase === 'playing' || blitz.phase === 'over' ? (
            <PuzzleView
              puzzle={blitz.puzzle}
              found={blitz.found}
              onFound={(w) => setBlitz((b) => (b.phase === 'playing' ? { ...b, found: [...b.found, w] } : b))}
              disabled={blitz.phase === 'over'}
              keyboard={dialog === null}
              statusExtra={timer || (
                <button type="button" onClick={startBlitz} className="rounded-full bg-ink px-3 py-1 text-sm font-semibold text-bg">Play again</button>
              )}
            />
          ) : (
            <section className="mx-auto max-w-md py-16 text-center">
              <h2 className="text-3xl font-black">Blitz</h2>
              <p className="mt-2 text-muted">A random board. Three minutes. Find as many words as you can.</p>
              {best > 0 && <p className="mt-1 text-sm text-muted">Your best: <b className="text-ink">{best}</b> points</p>}
              <button
                type="button"
                onClick={startBlitz}
                disabled={blitz.phase === 'loading'}
                className="mt-6 rounded-full bg-ink px-8 py-3 text-lg font-bold text-bg active:scale-95 disabled:opacity-60"
              >
                {blitz.phase === 'loading' ? 'Building board…' : 'Start'}
              </button>
            </section>
          ))}
      </main>

      <Modal open={dialog === 'rules'} title="How to play" onClose={closeDialog}>
        <Rules />
      </Modal>

      <Modal open={dialog === 'hints'} title="Hints" onClose={closeDialog}>
        {active && <HintGrid grid={hintGrid(active.puzzle, new Set(active.found))} />}
      </Modal>

      <Modal open={dialog === 'yesterday'} title="Yesterday's answers" onClose={closeDialog}>
        {yesterdayKey < EPOCH ? (
          <p className="text-muted">Hexicon #1 is today. Check back tomorrow.</p>
        ) : yesterday?.puzzle ? (
          <>
            <p className="mb-3 text-sm text-muted">
              #{yesterday.puzzle.number} · Letters <b className="text-ink">{yesterday.puzzle.letters.join(' ').toUpperCase()}</b>, key{' '}
              <b className="text-ink">{yesterday.puzzle.centerLetter.toUpperCase()}</b> · {yesterday.puzzle.answers.length} words ·{' '}
              {yesterday.puzzle.maxScore} points
            </p>
            <AnswerList
              answers={yesterday.puzzle.answers}
              found={new Set(readStored<{ found: string[] }>(dailyKey(yesterdayKey), { found: [] }).found)}
            />
          </>
        ) : (
          <p className="text-muted">{yesterday?.error ?? 'Loading…'}</p>
        )}
      </Modal>

      <Modal open={dialog === 'blitz-over'} title="Time's up!" onClose={closeDialog}>
        {blitz.phase === 'over' && (() => {
          const p = progress(blitz.puzzle, answerIndex(blitz.puzzle), blitz.found);
          return (
            <>
              <p className="mb-1 text-lg">
                <b>{p.score}</b> points · {blitz.found.length} of {blitz.puzzle.answers.length} words · <b>{p.rank.name}</b>
              </p>
              <p className="mb-3 text-sm text-muted">
                {blitz.newBest ? 'New personal best!' : `Your best: ${best}`}
              </p>
              <AnswerList answers={blitz.puzzle.answers} found={new Set(blitz.found)} />
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className={textBtn} onClick={onShare}>Share</button>
                <button
                  type="button"
                  className="rounded-full bg-ink px-4 py-1 text-sm font-semibold text-bg"
                  onClick={() => {
                    closeDialog();
                    startBlitz();
                  }}
                >
                  Play again
                </button>
              </div>
            </>
          );
        })()}
      </Modal>
    </div>
  );
}
