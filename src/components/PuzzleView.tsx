import { useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './Board';
import { RankBar } from './RankBar';
import { FoundWords } from './FoundWords';
import { areAdjacent } from '../engine/hexgrid';
import { findPaths } from '../engine/solver';
import { answerIndex, checkWord, progress } from '../engine/game';
import type { Puzzle } from '../engine/generator';
import { haptics } from '../haptics';

interface Props {
  puzzle: Puzzle;
  found: readonly string[];
  onFound(word: string): void;
  disabled?: boolean;
  /** Keyboard input is ignored while a dialog is open. */
  keyboard: boolean;
  statusExtra?: React.ReactNode;
}

type Toast = { id: number; text: string; kind: 'error' | 'good' | 'info' };

export function PuzzleView({ puzzle, found, onFound, disabled, keyboard, statusExtra }: Props) {
  const answers = useMemo(() => answerIndex(puzzle), [puzzle]);
  const foundSet = useMemo(() => new Set(found), [found]);
  const { score, rank } = progress(puzzle, answers, found);

  // Input: either a traced path or typed letters (with a route highlighted for them).
  const [path, setPathState] = useState<number[]>([]);
  const [typed, setTypedState] = useState('');
  const pathRef = useRef<number[]>([]);
  const typedRef = useRef('');
  const setPath = (p: number[]) => setPathState((pathRef.current = p));
  const setTyped = (t: string) => setTypedState((typedRef.current = t));
  const press = useRef({ moved: false, submitOnRelease: false });

  const [flashPath, setFlashPath] = useState<number[] | null>(null);
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
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!flashPath) return;
    const t = setTimeout(() => setFlashPath(null), 900);
    return () => clearTimeout(t);
  }, [flashPath]);
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
    if (!result.ok) return reject(result.reason, attempted);
    const { answer } = result;
    const before = rank.index;
    onFound(answer.word);
    setFlashPath(null);
    setPulse({ id: Date.now(), ids: traced ? attempted : answer.path, kind: 'good' });
    setFresh(answer.word);
    const after = progress(puzzle, answers, [...found, answer.word]);
    if (after.complete && puzzle.kind === 'daily') {
      setBanner({ id: Date.now(), text: 'Hexmaster!', sub: 'Every word found' });
      haptics.pangram();
    } else if (answer.pangram) {
      setBanner({ id: Date.now(), text: 'Pangram!', sub: `+${answer.score}` });
      haptics.pangram();
    } else {
      say(after.rank.index > before ? `${after.rank.name}! +${answer.score}` : `+${answer.score}`, 'good');
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
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr] lg:gap-x-8">
      <div className="lg:col-start-1">
        <RankBar score={score} maxScore={puzzle.maxScore} rank={rank} extra={statusExtra} />
      </div>
      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <FoundWords found={found} answers={answers} total={puzzle.answers.length} fresh={fresh} onShow={setFlashPath} />
      </div>

      <section className="relative flex flex-col items-center lg:col-start-1" aria-label="Board">
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

        <div className="relative flex w-full justify-center">
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

        <div className="mt-2 flex gap-2.5">
          <button type="button" className={plainBtn} onClick={backspace} disabled={disabled}>Delete</button>
          <button type="button" className={plainBtn} onClick={clear} disabled={disabled}>Clear</button>
          <button type="button" className={`${btn} border-ink bg-ink text-bg`} onClick={submit} disabled={disabled}>Enter</button>
        </div>
        <p className="mt-2 max-w-[420px] text-center text-sm text-muted">
          Drag across tiles and let go to submit, or tap tiles one by one and tap the last one again. Every word goes through the <b>key</b>.
        </p>
      </section>
    </div>
  );
}
