import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PuzzleView } from './components/PuzzleView';
import { BulbIcon, CalendarIcon, ShareIcon, TrophyIcon } from './components/Icons';
import { Leaderboard, NameForm } from './components/Leaderboard';
import { api, ApiRejected, leaderboardOnline, looksLikeName, NameTaken, type Board } from './api';
import { isNativeApp, nativeShare, scheduleDailyReminder } from './native';
import { Welcome } from './components/Welcome';
import { Podium } from './components/Podium';
import { Modal } from './components/Modal';
import { Rules } from './components/Rules';
import { HintGrid } from './components/HintGrid';
import { AnswerList } from './components/AnswerList';
import { requestPuzzle } from './worker/client';
import {
  adoptedPlayer, dailyKey, NAME_KEY, PIN_KEY, playerId, readStored, setPlayerId, syncCarryParam, useStoredState, writeStored,
} from './storage';
import { boardLocksAt, dateKeyFor, EPOCH, isDateKey, shiftDateKey } from './engine/dates';
import { dailyBoardId } from './engine/rerolls';
import { answerIndex, progress } from './engine/game';
import { hintGrid } from './engine/hints';
import { shareText } from './engine/share';
import { useUpdateCheck } from './updates';
import { haptics } from './haptics';
import { Wordmark } from './components/Wordmark';
import { DIFFICULTY_NAMES, type Puzzle } from './engine/generator';

const BLITZ_SECONDS = 180;
const STUCK_MS = 2 * 60 * 1000; // two minutes of trying without a new word…
const STUCK_WRONG_STREAK = 5; // …or this many wrong words in a row
const DIFFICULTY_COLORS = ['bg-emerald-600', 'bg-emerald-600', 'bg-amber-500', 'bg-amber-500', 'bg-orange-600', 'bg-red-600', 'bg-red-700'];
type Mode = 'daily' | 'blitz';
type Dialog = null | 'welcome' | 'rules' | 'hints' | 'yesterday' | 'blitz-over' | 'leaderboard' | 'name-taken' | 'podium';
/** Saved progress on a board: words found, and the route each was traced along. */
interface Progress {
  found: string[];
  routes?: Record<string, number[]>;
}

/** What the leaderboard server scores: each word with its traced route (when known). */
const submission = (p: Progress) => p.found.map((w) => (p.routes?.[w] ? { w, p: p.routes[w] } : w));

type Posted =
  | { status: 'pending' }
  | { status: 'done'; text: string; standing: { position: number; total: number } | null }
  | { status: 'error'; text: string };
type Blitz =
  | { phase: 'intro' }
  | { phase: 'loading' }
  | {
      phase: 'playing' | 'over';
      puzzle: Puzzle;
      found: string[];
      routes: Record<string, number[]>;
      endsAt: number;
      /** Server-issued game id when the round counts for the leaderboard. */
      rankedGame: string | null;
      newBest?: boolean;
      posted?: Posted;
    };

/** Marks a day's results recap as seen ("v2": the first version marked it seen even when it wasn't shown). */
const recapKey = (boardId: string) => `hexicon:recap-v2:${boardId}`;

/** Anyone with saved progress from an earlier day has played before. */
function hasPlayedBefore(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('hexicon:daily:'));
  } catch {
    return false;
  }
}

function initialDateKey(): string {
  // ?date=YYYY-MM-DD replays (or previews) any day's board.
  const param = new URLSearchParams(location.search).get('date');
  return isDateKey(param) && param >= EPOCH ? param : dateKeyFor();
}

async function share(text: string): Promise<string> {
  try {
    if (await nativeShare(text)) return '';
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
  // Leaderboard features only show up when a leaderboard server is reachable.
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    leaderboardOnline().then(setOnline);
  }, []);

  // First visit: ask for a leaderboard name (if there's a leaderboard), otherwise show the rules.
  const [dialog, setDialog] = useState<Dialog>(null);
  const firstDialogShown = useRef(false);
  useEffect(() => {
    if (online === null || firstDialogShown.current) return;
    firstDialogShown.current = true;
    if (online && !readStored(NAME_KEY, '') && !readStored('hexicon:asked-name', false)) setDialog('welcome');
    else if (!readStored('hexicon:seen-rules', false)) setDialog('rules');
  }, [online]);
  const [notice, setNotice] = useState('');
  const [dateKey] = useState(initialDateKey);
  const [me] = useState(playerId);
  const [name, setName] = useStoredState<string>(NAME_KEY, '');
  // Let the leaderboard server know someone's playing (it notifies the owner once per player per day).
  const greeted = useRef(false);
  useEffect(() => {
    if (!online || greeted.current) return;
    greeted.current = true;
    api.hello(me, location.hash === '#blitz' ? 'blitz' : 'daily', name, dateKeyFor()).catch(() => {});
  }, [online, me, name]);
  const [pin, setPin] = useStoredState<string>(PIN_KEY, '');
  const saveName = useCallback(
    async (n: string) => {
      if (!looksLikeName(n)) throw new Error('Please use 2–16 letters or numbers');
      try {
        const r = await api.saveName(me, n);
        setName(r.name);
        setPin(r.pin);
      } catch (err) {
        if (err instanceof ApiRejected && err.status === 409) throw new NameTaken(n.trim());
        // The server said no (e.g. a blocked word): show why. If it's just unreachable, keep the name for later.
        if (err instanceof ApiRejected) throw err;
        setName(n.trim());
      }
    },
    [me, setName, setPin],
  );
  /** Continue as an existing player (by name). The page reloads as that player. */
  const claimName = useCallback(async (n: string) => {
    const r = await api.claim(n);
    setPlayerId(r.playerId);
    writeStored(NAME_KEY, r.name);
    writeStored(PIN_KEY, r.pin);
    writeStored('hexicon:asked-name', true);
    writeStored('hexicon:seen-rules', true); // a returning player: skip the intro
    location.reload();
  }, []);

  /** Erase this player from the server and this device, then start fresh. */
  const deleteMyData = useCallback(async () => {
    await api.deleteMe(me);
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('hexicon:')) localStorage.removeItem(k);
    } catch {
      /* nothing stored */
    }
    location.replace(location.pathname);
  }, [me]);

  // ---- daily ----------------------------------------------------------------
  // New players get a "show me a word" tip until they find their first word.
  const [starterDone, setStarterDone] = useStoredState<boolean>('hexicon:starter-done', hasPlayedBefore());
  const daily = usePuzzle(dateKey);
  const [dailyFound, setDailyFound] = useStoredState<Progress>(dailyKey(dailyBoardId(dateKey)), { found: [] });
  const boardId = dailyBoardId(dateKey);
  const isToday = dateKey === dateKeyFor();

  // Live standing on today's leaderboard, shown next to your rank.
  const [standing, setStanding] = useState<{ position: number; total: number } | null>(null);
  const noteStanding = useCallback((b: { total: number; you: { position: number } | null }) => {
    setStanding(b.you ? { position: b.you.position, total: b.total } : null);
  }, []);
  useEffect(() => {
    if (!online || !name || !isToday) return;
    let live = true;
    const poll = () =>
      document.visibilityState === 'visible' &&
      api.daily(boardId, me).then((b) => live && noteStanding(b), () => {});
    poll();
    const t = setInterval(poll, 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [online, name, isToday, boardId, me, noteStanding]);

  // Bring back words this player found on another device or browser today.
  useEffect(() => {
    if (!online || !name || !isToday) return;
    let live = true;
    api.progress(boardId, me).then(({ found }) => {
      if (!live || !found.length) return;
      setDailyFound((s) => {
        const have = new Set(s.found);
        const extra = found.map((f) => (typeof f === 'string' ? { w: f, p: null } : f)).filter((f) => !have.has(f.w));
        if (!extra.length) return s;
        const routes = { ...s.routes };
        for (const f of extra) if (f.p) routes[f.w] = f.p;
        return { found: [...s.found, ...extra.map((f) => f.w)], routes };
      });
    }, () => {});
    return () => {
      live = false;
    };
  }, [online, name, isToday, boardId, me, setDailyFound]);
  // A home-screen app that took its player from the address: fetch their name and PIN.
  useEffect(() => {
    if (!online || name || !adoptedPlayer()) return;
    api.me(me).then((r) => {
      if (!r.name) return;
      setName(r.name);
      if (r.pin) setPin(r.pin);
    }, () => {});
  }, [online, name, me, setName, setPin]);
  // Keep the address carrying this player, so "Add to Home Screen" keeps their progress.
  useEffect(() => syncCarryParam(me, !!name), [me, name]);
  // Players who picked a name before PINs existed: fetch theirs so the leaderboard can show it.
  useEffect(() => {
    if (online && name && !pin) api.me(me).then((r) => r.pin && setPin(r.pin), () => {});
  }, [online, name, pin, me, setPin]);

  // The first visit after a day closes: show where this player finished yesterday (once).
  // The top 3 get the podium and confetti; everyone else gets their place and the gap to the podium.
  // It waits until yesterday's board has locked (its results are final), checking again at that moment.
  const [podium, setPodium] = useState<{ id: string; board: Board } | null>(null);
  // Set when there's a recap this player hasn't seen; it's marked seen only once it's actually on screen.
  const [recapDue, setRecapDue] = useState(false);
  const [podiumCheck, setPodiumCheck] = useState(0);
  useEffect(() => {
    if (!online || !name || !isToday) return;
    const yesterday = shiftDateKey(dateKeyFor(), -1);
    const yesterdayId = dailyBoardId(yesterday);
    if (yesterday < EPOCH || readStored(recapKey(yesterdayId), false)) return;
    const wait = boardLocksAt(yesterday) - Date.now();
    if (wait > 0) {
      const t = setTimeout(() => setPodiumCheck((n) => n + 1), Math.min(wait + 5000, 2 ** 31 - 1));
      return () => clearTimeout(t);
    }
    let live = true;
    const t = setTimeout(() => {
      api.daily(yesterdayId, me).then((b) => {
        if (!live || !b.you) return;
        setPodium({ id: yesterdayId, board: b });
        setRecapDue(true);
      }, () => {});
    }, 1200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [online, name, isToday, me, podiumCheck]);
  // Show it as soon as nothing else (welcome, rules…) is on screen, and only then count it as seen.
  useEffect(() => {
    if (!recapDue || !podium) return;
    if (dialog === null) setDialog('podium');
    else if (dialog === 'podium') {
      writeStored(recapKey(podium.id), true);
      setRecapDue(false);
      if (podium.board.you && podium.board.you.position <= 3) haptics.pangram();
    }
  }, [recapDue, podium, dialog]);

  // Post daily progress to the leaderboard (a moment after each new word).
  const posted = useRef('');
  useEffect(() => {
    const found = dailyFound.found;
    const key = `${name}|${found.length}`;
    if (!online || !name || !isToday || !found.length || posted.current === key) return;
    const t = setTimeout(() => {
      api.submitDaily({ playerId: me, name, date: boardId, words: submission(dailyFound) }).then(
        (b) => {
          posted.current = key;
          noteStanding(b);
        },
        (e) => {
          // Someone else owns this name: ask the player to confirm it's them or pick another.
          if (e instanceof ApiRejected && e.status === 409) setDialog((d) => d ?? 'name-taken');
        },
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [dailyFound, online, name, isToday, me, boardId, noteStanding]);

  const yesterdayKey = shiftDateKey(dateKey, -1);
  const yesterday = usePuzzle(dialog === 'yesterday' && yesterdayKey >= EPOCH ? yesterdayKey : null);
  // Words this player found yesterday: saved on this device, plus any from other devices (the server keeps them).
  const [yesterdayFound, setYesterdayFound] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (dialog !== 'yesterday' || yesterdayKey < EPOCH) return;
    const id = dailyBoardId(yesterdayKey);
    const local = readStored<{ found: string[] }>(dailyKey(id), { found: [] }).found;
    setYesterdayFound(new Set(local));
    if (!online || !name) return;
    let live = true;
    api.progress(id, me).then(({ found }) => {
      if (live) setYesterdayFound(new Set([...local, ...found.map((f) => (typeof f === 'string' ? f : f.w))]));
    }, () => {});
    // Once the board has locked, its final results can be reopened from here.
    if (Date.now() >= boardLocksAt(yesterdayKey)) {
      api.daily(id, me).then((b) => {
        if (live && b.you) setPodium({ id, board: b });
      }, () => {});
    }
    return () => {
      live = false;
    };
  }, [dialog, yesterdayKey, online, name, me]);

  // ---- blitz ----------------------------------------------------------------
  const [blitz, setBlitz] = useState<Blitz>({ phase: 'intro' });
  const [best, setBest] = useStoredState('hexicon:blitz-best', 0);
  const [now, setNow] = useState(() => Date.now());

  // ---- stuck nudge ------------------------------------------------------------
  // Once per player: if they seem stuck on the daily, pulse the Blitz tab so they
  // know there's another way to play. Skipped for anyone who's tried Blitz already.
  const [nudgeBlitz, setNudgeBlitz] = useState(false);
  const stuck = useRef({ lastFound: Date.now(), lastAttempt: 0, wrongStreak: 0 });
  const nudgeUsed = () => readStored('hexicon:blitz-nudged', false) || readStored('hexicon:played-blitz', false);
  const triggerNudge = useCallback(() => {
    if (nudgeUsed()) return;
    writeStored('hexicon:blitz-nudged', true);
    setNudgeBlitz(true);
    haptics.tap();
  }, []);
  const onDailyAttempt = useCallback(
    (ok: boolean) => {
      const s = stuck.current;
      s.lastAttempt = Date.now();
      if (ok) {
        s.lastFound = Date.now();
        s.wrongStreak = 0;
      } else if (++s.wrongStreak >= STUCK_WRONG_STREAK) triggerNudge();
    },
    [triggerNudge],
  );
  useEffect(() => {
    if (mode !== 'daily' || nudgeUsed()) return;
    const t = setInterval(() => {
      const s = stuck.current;
      const trying = s.lastAttempt > s.lastFound; // still making attempts, not just idle
      if (trying && dialog === null && document.visibilityState === 'visible' && Date.now() - s.lastFound >= STUCK_MS) {
        triggerNudge();
      }
    }, 5000);
    return () => clearInterval(t);
  }, [mode, dialog, triggerNudge]);
  useEffect(() => {
    if (!nudgeBlitz) return;
    const t = setTimeout(() => setNudgeBlitz(false), 7000);
    return () => clearTimeout(t);
  }, [nudgeBlitz]);

  const startBlitz = useCallback(async () => {
    writeStored('hexicon:played-blitz', true);
    setBlitz({ phase: 'loading' });
    // Ranked rounds use a board the server hands out, so it can check the result.
    let ranked: { game: string; seed: string } | null = null;
    if (online && name) {
      try {
        ranked = await api.startBlitz(me);
      } catch {
        setNotice('Leaderboard offline: this round won’t be ranked');
      }
    }
    const seed = ranked?.seed ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    try {
      const puzzle = await requestPuzzle({ type: 'blitz', seed });
      setNow(Date.now());
      setBlitz({ phase: 'playing', puzzle, found: [], routes: {}, endsAt: Date.now() + BLITZ_SECONDS * 1000, rankedGame: ranked?.game ?? null });
    } catch {
      setBlitz({ phase: 'intro' });
      setNotice('Could not build a board');
    }
  }, [online, name, me]);

  useEffect(() => {
    if (blitz.phase !== 'playing') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [blitz.phase]);

  useEffect(() => {
    if (blitz.phase === 'playing' && now >= blitz.endsAt) {
      const score = progress(blitz.puzzle, answerIndex(blitz.puzzle), blitz.found, blitz.routes).score;
      if (score > best) setBest(score);
      const ranked = blitz.rankedGame && name;
      setBlitz({ ...blitz, phase: 'over', newBest: score > best, posted: ranked ? { status: 'pending' } : undefined });
      setDialog('blitz-over');
      if (ranked) {
        const update = (p: Posted) =>
          setBlitz((b) => (b.phase === 'over' && b.rankedGame === blitz.rankedGame ? { ...b, posted: p } : b));
        api.finishBlitz({ playerId: me, name, game: blitz.rankedGame!, words: submission(blitz) }).then(
          (r) =>
            update({
              status: 'done',
              text: r.personalBest
                ? `Leaderboard: #${r.you?.position} of ${r.total} 🏆`
                : `Your best Blitz score ranks #${r.you?.position} of ${r.total}`,
              standing: r.you ? { position: r.you.position, total: r.total } : null,
            }),
          (e: Error) => {
            update({ status: 'error', text: `Couldn't post to the leaderboard: ${e.message}` });
            if (e instanceof ApiRejected && e.status === 409) setDialog('name-taken');
          },
        );
      }
    }
  }, [now, blitz, best, setBest, name, me]);

  // ---- shared ---------------------------------------------------------------
  // Never reload out from under a Blitz round; daily progress is saved, so that's safe.
  // (The iPhone app bundles its files and updates through the App Store instead.)
  const { updateReady, reload } = useUpdateCheck(blitz.phase !== 'playing' && blitz.phase !== 'loading', !isNativeApp);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 1800);
    return () => clearTimeout(t);
  }, [notice]);

  const active =
    mode === 'daily'
      ? daily?.puzzle && { puzzle: daily.puzzle, found: dailyFound.found, routes: dailyFound.routes ?? {} }
      : blitz.phase === 'playing' || blitz.phase === 'over'
        ? { puzzle: blitz.puzzle, found: blitz.found, routes: blitz.routes }
        : null;

  const activeAnswers = useMemo(() => (active ? answerIndex(active.puzzle) : null), [active?.puzzle]);

  async function onShare() {
    if (!active || !activeAnswers) return;
    const p = progress(active.puzzle, activeAnswers, active.found, active.routes);
    const blitzStanding = blitz.phase === 'over' && blitz.posted?.status === 'done' ? blitz.posted.standing : null;
    const text = shareText(active.puzzle, {
      rankName: p.rank.name, rankIndex: p.rank.index, score: p.score, words: active.found.length, pangrams: p.pangramsFound,
      standing: mode === 'daily' ? (isToday ? standing : null) : blitzStanding,
    });
    const msg = await share(text);
    if (msg) setNotice(msg);
  }

  function closeDialog() {
    if (dialog === 'rules') writeStored('hexicon:seen-rules', true);
    if (dialog === 'welcome') {
      writeStored('hexicon:asked-name', true);
      writeStored('hexicon:seen-rules', true);
    }
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

  // Puzzle number and this day's difficulty (beside the title on desktop, in the button row on phones).
  const puzzleMeta = mode === 'daily' && daily?.puzzle && (
    <span className="flex items-center gap-1.5 pb-0.5 text-sm text-muted">
      #{daily.puzzle.number}
      {daily.puzzle.difficulty !== null && (
        <span className={`rounded-full px-2 py-px text-xs font-bold text-white ${DIFFICULTY_COLORS[daily.puzzle.difficulty]}`}>
          {DIFFICULTY_NAMES[daily.puzzle.difficulty]}
        </span>
      )}
    </span>
  );

  const headerBtn = 'rounded-full border border-line py-1 text-sm hover:border-muted disabled:opacity-40';
  const textBtn = `${headerBtn} px-2.5 sm:px-3`;
  const iconBtn = `${headerBtn} flex h-8 min-w-8 items-center justify-center gap-1.5 sm:px-3`;
  const label = (text: string) => <span className="hidden sm:inline">{text}</span>;
  const tab = (m: Mode) =>
    `rounded-full px-2.5 py-1 sm:px-3 text-sm font-semibold ${mode === m ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`;

  return (
    // Phones: exactly one screen tall, no page scrolling. Desktop: normal page.
    <div className="mx-auto flex h-[100dvh] max-w-5xl flex-col overflow-hidden px-4 lg:block lg:h-auto lg:overflow-visible lg:pb-8">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2 lg:py-3">
        <div className="flex min-w-0 flex-1 items-end gap-2">
          <Wordmark />
          <span className="hidden lg:flex">{puzzleMeta}</span>
        </div>
        {online && (
          <button
            type="button"
            onClick={() => setDialog('leaderboard')}
            className="flex items-center gap-1.5 rounded-full bg-gradient-to-b from-[#ffd65a] to-[#f2b01e] px-3.5 py-1.5 text-sm font-extrabold text-[#3b2a00] shadow-md ring-2 ring-[#1f5fd6] active:scale-95 lg:order-last"
          >
            <TrophyIcon /> Leaderboard
          </button>
        )}
        <nav className="flex w-full flex-wrap items-center gap-1.5 lg:w-auto">
          <div className="relative sm:mr-1">
          <div className="flex rounded-full border border-line p-0.5" role="tablist" aria-label="Mode">
            <button type="button" role="tab" aria-selected={mode === 'daily'} className={tab('daily')} onClick={() => switchMode('daily')}>Daily</button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'blitz'}
              className={`${tab('blitz')} ${nudgeBlitz ? 'animate-nudge relative z-10 bg-key text-key-ink' : ''}`}
              onClick={() => {
                setNudgeBlitz(false);
                switchMode('blitz');
              }}
            >
              Blitz
            </button>
          </div>
          {nudgeBlitz && (
            <div
              role="status"
              className="pointer-events-none absolute top-full left-0 z-30 mt-2 w-max animate-rise rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-bg shadow-lg"
            >
              Stuck? Try a quick game of <b>Blitz</b> ⚡
            </div>
          )}
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
          A new version of DPIYF Lettertown is ready. Tap to update.
        </button>
      )}

      <main className="flex min-h-0 flex-1 flex-col pt-3 lg:block lg:pt-4">
        {mode === 'daily' &&
          (daily?.puzzle ? (
            <PuzzleView
              puzzle={daily.puzzle}
              found={dailyFound.found}
              routes={dailyFound.routes ?? {}}
              statusNote={<span className="lg:hidden">{puzzleMeta}</span>}
              onAttempt={onDailyAttempt}
              starter={!starterDone}
              onStarterUsed={() => setStarterDone(true)}
              onFound={(w, r) => {
                setDailyFound((s) => ({ found: [...s.found, w], routes: { ...s.routes, [w]: r } }));
                setStarterDone(true);
                scheduleDailyReminder().catch(() => {}); // in the iPhone app: once, after the first word
              }}
              keyboard={dialog === null}
              statusExtra={
                standing && (
                  <button
                    type="button"
                    onClick={() => setDialog('leaderboard')}
                    className="rounded-full bg-key/25 px-2.5 py-0.5 text-sm font-bold tabular-nums"
                    aria-label={`You are number ${standing.position} of ${standing.total} today. Open leaderboard`}
                  >
                    🏆 #{standing.position} <span className="font-normal text-muted">of {standing.total}</span>
                  </button>
                )
              }
            />
          ) : (
            <p className="py-24 text-center text-muted">{daily?.error ? `Could not load the puzzle: ${daily.error}` : "Building today's board…"}</p>
          ))}

        {mode === 'blitz' &&
          (blitz.phase === 'playing' || blitz.phase === 'over' ? (
            <PuzzleView
              puzzle={blitz.puzzle}
              found={blitz.found}
              routes={blitz.routes}
              onFound={(w, r) =>
                setBlitz((b) => (b.phase === 'playing' ? { ...b, found: [...b.found, w], routes: { ...b.routes, [w]: r } } : b))
              }
              disabled={blitz.phase === 'over'}
              keyboard={dialog === null}
              statusExtra={timer || (
                <button type="button" onClick={startBlitz} className="rounded-full bg-ink px-3 py-1 text-sm font-semibold text-bg">Play again</button>
              )}
            />
          ) : (
            <section className="mx-auto max-w-md overflow-y-auto py-8 text-center lg:py-16">
              <h2 className="text-3xl font-black">Blitz</h2>
              <p className="mt-2 text-muted">A random board. Three minutes. Find as many words as you can.</p>
              {best > 0 && <p className="mt-1 text-sm text-muted">Your best: <b className="text-ink">{best}</b> points</p>}
              {!online ? null : name ? (
                <p className="mt-1 text-sm text-muted">Playing as <b className="text-ink">{name}</b>. Your score goes on the leaderboard.</p>
              ) : (
                <div className="mx-auto mt-5 max-w-xs text-left">
                  <NameForm name="" cta="Save" onSave={saveName} onClaim={claimName} />
                  <p className="mt-1 text-xs text-muted">Add a name to get on the leaderboard, or just press Start.</p>
                </div>
              )}
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

      <Modal open={dialog === 'leaderboard'} title="Leaderboard" onClose={closeDialog}>
        <Leaderboard
          dateKey={isToday ? boardId : dailyBoardId(dateKeyFor())}
          playerId={me}
          name={name}
          onName={async (n) => {
            await saveName(n);
            if (isToday && dailyFound.found.length) {
              await api.submitDaily({ playerId: me, name: n, date: boardId, words: submission(dailyFound) }).catch(() => {});
            }
          }}
          onClaim={claimName}
          onDelete={deleteMyData}
          initialTab={mode}
        />
      </Modal>

      <Modal open={dialog === 'podium' && !!podium} title="Yesterday's results" onClose={closeDialog}>
        {podium && (
          <Podium
            board={podium.board}
            onClose={closeDialog}
            onShare={async () => {
              const b = podium.board;
              const place = ['1st', '2nd', '3rd'][b.you!.position - 1];
              const msg = await share(
                `🏆 I finished ${place} of ${b.total} in yesterday's DPIYF Lettertown with ${b.you!.score} points! ` +
                  `Can you beat me today? https://onthedcl.github.io/word-game-/`,
              );
              if (msg) setNotice(msg);
            }}
          />
        )}
      </Modal>

      <Modal open={dialog === 'name-taken'} title="That name is taken" onClose={closeDialog}>
        <p className="mb-3 text-sm">
          Someone else is already on the leaderboard as <b>{name}</b>. If that's you, continue as them; otherwise pick a new name
          so your score can post.
        </p>
        <NameForm
          name={name}
          cta="Save"
          onSave={async (n) => {
            await saveName(n);
            if (isToday && dailyFound.found.length) {
              await api.submitDaily({ playerId: me, name: n.trim(), date: boardId, words: submission(dailyFound) }).then(noteStanding, () => {});
            }
            closeDialog();
          }}
          onClaim={claimName}
        />
      </Modal>

      <Modal open={dialog === 'welcome'} title="Welcome to DPIYF Lettertown" onClose={closeDialog}>
        <Welcome
          onSave={async (n) => {
            await saveName(n);
            closeDialog();
          }}
          onClaim={claimName}
          onSkip={closeDialog}
          onRules={() => {
            writeStored('hexicon:asked-name', true);
            setDialog('rules');
          }}
        />
      </Modal>

      <Modal open={dialog === 'rules'} title="How to play" onClose={closeDialog}>
        <Rules />
      </Modal>

      <Modal open={dialog === 'hints'} title="Hints" onClose={closeDialog}>
        {active && <HintGrid grid={hintGrid(active.puzzle, new Set(active.found))} />}
      </Modal>

      <Modal open={dialog === 'yesterday'} title="Yesterday's answers" onClose={closeDialog}>
        {yesterdayKey < EPOCH ? (
          <p className="text-muted">DPIYF Lettertown #1 is today. Check back tomorrow.</p>
        ) : yesterday?.puzzle ? (
          <>
            <p className="mb-3 text-sm text-muted">
              #{yesterday.puzzle.number} · Letters <b className="text-ink">{yesterday.puzzle.letters.join(' ').toUpperCase()}</b>, key{' '}
              <b className="text-ink">{yesterday.puzzle.centerLetter.toUpperCase()}</b> · {yesterday.puzzle.answers.length} words ·{' '}
              {yesterday.puzzle.maxScore} points
            </p>
            {podium?.id === dailyBoardId(yesterdayKey) && podium.board.you && (
              <button
                type="button"
                onClick={() => setDialog('podium')}
                className="mb-3 flex w-full items-center gap-2 rounded-xl bg-key/25 px-3 py-2 text-left font-semibold"
              >
                <span className="text-xl">{['🥇', '🥈', '🥉'][podium.board.you.position - 1] ?? '🎖️'}</span>
                <span className="flex-1">You finished #{podium.board.you.position} of {podium.board.total}</span>
                <span className="text-sm text-muted underline">See results</span>
              </button>
            )}
            <AnswerList
              answers={yesterday.puzzle.answers}
              bonus={yesterday.puzzle.bonus}
              found={yesterdayFound}
            />
          </>
        ) : (
          <p className="text-muted">{yesterday?.error ?? 'Loading…'}</p>
        )}
      </Modal>

      <Modal open={dialog === 'blitz-over'} title="Time's up!" onClose={closeDialog}>
        {blitz.phase === 'over' && (() => {
          const p = progress(blitz.puzzle, answerIndex(blitz.puzzle), blitz.found, blitz.routes);
          return (
            <>
              <p className="mb-1 text-lg">
                <b>{p.score}</b> points · {blitz.found.length} of {blitz.puzzle.answers.length} words · <b>{p.rank.name}</b>
              </p>
              <p className="mb-3 text-sm text-muted">
                {blitz.newBest ? 'New personal best!' : `Your best: ${best}`}
              </p>
              {blitz.posted && (
                <p className={`mb-3 text-sm font-semibold ${blitz.posted.status === 'error' ? 'text-bad' : ''}`}>
                  {blitz.posted.status === 'pending' ? 'Posting to the leaderboard…' : blitz.posted.text}
                </p>
              )}
              <AnswerList answers={blitz.puzzle.answers} bonus={blitz.puzzle.bonus} found={new Set(blitz.found)} />
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
