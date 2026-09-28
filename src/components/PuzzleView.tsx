import { useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './Board';
import { RankBar } from './RankBar';
import { FoundWords } from './FoundWords';
import { areAdjacent } from '../engine/hexgrid';
import { findPaths } from '../engine/solver';
import { answerIndex, checkWord, progress, wordScore, type Routes } from '../engine/game';
import { TOP_RANK } from '../engine/scoring';
import type { Puzzle } from '../engine/generator';
import { haptics } from '../haptics';

interface Props {
  puzzle: Puzzle;
  found: readonly string[];
  /** Route each found word was traced along (it scores along that route). */
  routes: Routes;
  onFound(word: string, route: number[]): void;
  disabled?: boolean;
  /** Keyboard input is ignored while a dialog is open. */
  keyboard: boolean;
  statusExtra?: React.ReactNode;
  statusNote?: React.ReactNode;
  /** Called after every submitted word, right or wrong. */
  onAttempt?(ok: boolean): void;
  /** First game: offer to show an easy word to get started. */
  starter?: boolean;
  onStarterUsed?(): void;
}

type Toast = { id: number; text: string; kind: 'error' | 'good' | 'info' };

export function PuzzleView({
  puzzle, found, routes, onFound, disabled, keyboard, statusExtra, statusNote, onAttempt, starter, onStarterUsed,
}: Props) {
  const answers = useMemo(() => answerIndex(puzzle), [puzzle]);
  const foundSet = useMemo(() => new Set(found), [found]);
  const { score, rank } = progress(puzzle, answers, found, routes);

  // Input: either a traced path or typed letters (with a route highlighted for them).
  const [path, setPathState] = useState<number[]>([]);
  const [typed, setTypedState] = useState('');
  const pathRef = useRef<number[]>([]);
  const typedRef = useRef('');
  const setPath = (p: number[]) => setPathState((pathRef.current = p));
  const setTyped = (t: string) => setTypedState((typedRef.current = t));
  const press = useRef({ moved: false, submitOnRelease: false });

  const [flashPath, setFlashPath] = useState<number[] | null>(null);
  const [flashMs, setFlashMs] = useState(900);
  // Quick green/red flash on the tiles of the word just submitted.
  const [pulse, setPulse] = useState<{ id: number; ids: number[]; kind: 'good' | 'bad' } | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [banner, setBanner] = useState<{ id: number; text: string; sub: string } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const typedPath = useMemo(() => {
    if (!typed) return [];
    return findPaths(typed, puzzle.board, { requireCenter: true, limit: 1 })[0] ??
      findPaths(typed, puzzle.board, { limit: 1 })[0] ?? [];
  }, [typed, puzzle.board]);
  const shownPath = typed ? typedPath : path;
  const word = typed || path.map((id) => puzzle.board.letters[id]).join('');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'info' ? 3500 : 1500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!flashPath) return;
    const t = setTimeout(() => setFlashPath(null), flashMs);
    return () => clearTimeout(t);
  }, [flashPath, flashMs]);

  /** Light up a short, easy word so a first-time player sees how tracing works. */
  function showStarter() {
    const easy = [...puzzle.answers].filter((a) => !foundSet.has(a.word)).sort((a, b) => a.word.length - b.word.length || a.score - b.score)[0];
    if (!easy) return;
    setFlashMs(3500);
    setFlashPath([...easy.path]);
    setToast({ id: Date.now(), text: `Try tracing ${easy.word.toUpperCase()}`, kind: 'info' });
    onStarterUsed?.();
  }
  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => setPulse(null), 500);
    return () => clearTimeout(t);
  }, [pulse]);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1900);
    return () => clearTimeout(t);
  }, [banner]);
  useEffect(() => {
    setPath([]);
    setTyped('');
  }, [puzzle]);

  function say(text: string, kind: Toast['kind']) {
    setToast({ id: Date.now(), text, kind });
  }
  function reject(reason: string, ids: number[] = []) {
    say(reason, 'error');
    if (ids.length) setPulse({ id: Date.now(), ids, kind: 'bad' });
    setShakeKey((k) => k + 1);
    haptics.error();
  }
  function clear() {
    setPath([]);
    setTyped('');
  }

  function submit() {
    if (disabled) return;
    const traced = !typedRef.current;
    const w = traced ? pathRef.current.map((id) => puzzle.board.letters[id]).join('') : typedRef.current;
    if (!w) return;
    const attempted = traced ? pathRef.current : typedPath;
    const result = checkWord(puzzle, answers, foundSet, w, traced ? pathRef.current : null);
    // Every submission starts the next word fresh, right or wrong.
    clear();
    onAttempt?.(result.ok);
    if (!result.ok) return reject(result.reason, attempted);
    const { answer, route, score: points } = result;
    const before = rank.index;
    onFound(answer.word, route);
    setFlashPath(null);
    setPulse({ id: Date.now(), ids: route, kind: 'good' });
    setFresh(answer.word);
    const after = progress(puzzle, answers, [...found, answer.word], { ...routes, [answer.word]: route });
    if (after.complete && puzzle.kind === 'daily') {
      setBanner({ id: Date.now(), text: 'Every word found!', sub: after.rank.name === TOP_RANK ? TOP_RANK : `+${points}` });
      haptics.pangram();
    } else if (answer.pangram) {
      setBanner({ id: Date.now(), text: 'Pangram!', sub: `+${points}` });
      haptics.pangram();
    } else {
      const bestNote = points < answer.score ? ` (best spot: ${answer.score})` : '';
      say(after.rank.index > before ? `${after.rank.name}! +${points}` : `+${points}${bestNote}`, 'good');
      haptics.success();
    }
  }

  // ---- tracing ----------------------------------------------------------------
  function onPress(id: number) {
    press.current = { moved: false, submitOnRelease: false };
    const p = typedRef.current ? [] : pathRef.current;
    if (typedRef.current) setTyped('');
    const last = p[p.length - 1];
    if (!p.length) setPath([id]);
    else if (id === last) {
      press.current.submitOnRelease = true;
      return;
    } else if (p.includes(id)) setPath(p.slice(0, p.indexOf(id) + 1));
    else if (areAdjacent(last, id)) setPath([...p, id]);
    else if (p.length === 1) setPath([id]);
    else return reject('Tiles not adjacent', [id]);
    haptics.tap();
  }

  function onDrag(id: number) {
    const p = pathRef.current;
    const last = p[p.length - 1];
    if (id === last || last === undefined) return;
    if (id === p[p.length - 2]) setPath(p.slice(0, -1));
    else if (!p.includes(id) && areAdjacent(last, id)) setPath([...p, id]);
    else return;
    press.current = { moved: true, submitOnRelease: false };
    haptics.tap();
  }

  function onRelease() {
    // Lifting your finger after a drag submits the word, like pressing Enter.
    if (press.current.moved || press.current.submitOnRelease) submit();
  }

  // ---- keyboard -----------------------------------------------------------------
  function type(ch: string) {
    if (!puzzle.letters.includes(ch)) {
      setShakeKey((k) => k + 1);
      return;
    }
    if (!typedRef.current) setPath([]);
    setTyped(typedRef.current + ch);
  }
  function backspace() {
    if (typedRef.current) setTyped(typedRef.current.slice(0, -1));
    else setPath(pathRef.current.slice(0, -1));
  }

  const handlers = useRef({ submit, backspace, clear, type });
  handlers.current = { submit, backspace, clear, type };
  useEffect(() => {
    if (!keyboard || disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const h = handlers.current;
      if (e.key === 'Enter') h.submit();
      else if (e.key === 'Backspace') h.backspace();
      else if (e.key === 'Escape') h.clear();
      else if (/^[a-zA-Z]$/.test(e.key)) h.type(e.key.toLowerCase());
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, disabled]);

  const btn = 'min-w-[88px] rounded-full border px-4 py-2.5 font-semibold active:scale-95 disabled:opacity-50';
  const plainBtn = `${btn} border-line bg-surface`;

  return (
    // Phones: a column that fills the screen, with the board taking whatever height is left.
    <div className="flex min-h-0 flex-1 flex-col gap-2 lg:grid lg:flex-none lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:gap-y-3">
      <div className="lg:col-start-1">
        <RankBar score={score} maxScore={puzzle.maxScore} rank={rank} extra={statusExtra} note={statusNote} />
      </div>
      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <FoundWords
          found={found}
          answers={answers}
          scoreOf={(w) => wordScore(puzzle, answers, w, routes)}
          routeOf={(w) => [...(routes[w] ?? answers.get(w)!.path)]}
          total={puzzle.answers.length}
          fresh={fresh}
          onShow={(p) => {
            setFlashMs(900);
            setFlashPath(p);
          }}
        />
      </div>

      {/* Phones: the section is a size container, so the board can scale to fit the space left on screen. */}
      <section className="min-h-0 w-full flex-1 max-lg:[container-type:size] lg:col-start-1" aria-label="Board">
       <div className="relative flex h-full flex-col items-center justify-center lg:justify-start">
        {/* Fixed-height entry line so tracing never shifts the layout. */}
        <div
          className={`flex h-12 items-center justify-center text-[2rem] font-bold uppercase tracking-wider ${
            typed && !typedPath.length ? 'opacity-40' : ''
          }`}
          aria-live="polite"
          aria-label="Current word"
        >
          {[...word].map((ch, i) => (
            <span key={i} className={ch === puzzle.centerLetter ? 'text-accent' : ''}>{ch}</span>
          ))}
          <span className="ml-0.5 h-[1.1em] w-0.5 animate-blink bg-accent" />
        </div>

        {starter && !found.length && !toast && !disabled && (
          <button
            type="button"
            onClick={showStarter}
            className="absolute top-1 left-1/2 z-10 animate-pop whitespace-nowrap rounded-full bg-key px-3 py-1 text-sm font-semibold text-key-ink shadow"
          >
            First time? Show me a word
          </button>
        )}

        {toast && (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-none absolute top-1 left-1/2 z-10 animate-pop whitespace-nowrap rounded-md px-3 py-1 text-sm font-semibold ${
              toast.kind === 'good' ? 'bg-good text-white' : toast.kind === 'error' ? 'bg-bad text-white' : 'bg-ink text-bg'
            }`}
          >
            {toast.text}
          </div>
        )}

        {/* As big as fits: full width, at most 480px, and short enough to leave room for the word line and buttons. */}
        <div className="relative aspect-[440/400] w-[min(100cqw,480px,calc((100cqh-7.5rem)*1.1))] shrink-0 lg:aspect-auto lg:h-[400px] lg:w-full lg:max-w-[440px]">
          <Board
            board={puzzle.board}
            path={shownPath}
            flashPath={flashPath}
            pulse={pulse}
            shakeKey={shakeKey}
            disabled={disabled}
            onPress={onPress}
            onDrag={onDrag}
            onRelease={onRelease}
          />
          {banner && (
            <div key={banner.id} className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status">
              <div className="animate-banner rounded-2xl bg-key px-8 py-4 text-center text-key-ink shadow-2xl">
                <div className="text-4xl font-black tracking-tight">{banner.text}</div>
                <div className="text-lg font-bold">{banner.sub}</div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex shrink-0 gap-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:pb-0">
          <button type="button" className={plainBtn} onClick={backspace} disabled={disabled}>Delete</button>
          <button type="button" className={plainBtn} onClick={clear} disabled={disabled}>Clear</button>
          <button type="button" className={`${btn} border-ink bg-ink text-bg`} onClick={submit} disabled={disabled}>Enter</button>
        </div>
        <p className="mt-2 hidden max-w-[420px] text-center text-sm text-muted lg:block">
          Drag across tiles and let go to submit, or tap tiles one by one and tap the last one again. Each tile once per word, and every word must include the gold <b>key</b> tile.
        </p>
       </div>
      </section>
    </div>
  );
}
