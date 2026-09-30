import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PuzzleView } from './components/PuzzleView';
import { BulbIcon, CalendarIcon, ShareIcon, TrophyIcon } from './components/Icons';
import { Leaderboard, NameForm } from './components/Leaderboard';
import { api, ApiRejected, leaderboardOnline, looksLikeName, NameTaken, type Board, type LeagueSummary, type Streak } from './api';
import { isNativeApp, maybeAskForReview, nativeShare, scheduleDailyReminder } from './native';
import { Welcome } from './components/Welcome';
import { Podium } from './components/Podium';
import { Modal } from './components/Modal';
import { Rules } from './components/Rules';
import { HintGrid } from './components/HintGrid';
import { AnswerList } from './components/AnswerList';
import { Archive } from './components/Archive';
import { drawShareCard, shareCard, tileHeat } from './shareCard';
import { requestPuzzle } from './worker/client';
import {
  adoptedPlayer, dailyKey, NAME_KEY, PIN_KEY, playerId, readStored, setPlayerId, syncCarryParam, useStoredState, writeStored,
} from './storage';
import { boardLocksAt, dateKeyFor, EPOCH, isDateKey, puzzleNumber, shiftDateKey } from './engine/dates';
import { dailyBoardId, parseBoardId } from './engine/rerolls';
import { answerIndex, progress } from './engine/game';
import { hintGrid } from './engine/hints';
import { GAME_URL, shareText } from './engine/share';
import { isNewAnimal, streakAnimal } from './engine/streak';
import { useUpdateCheck } from './updates';
import { haptics } from './haptics';
import { Wordmark } from './components/Wordmark';
import { DIFFICULTY_NAMES, type Puzzle } from './engine/generator';

const BLITZ_SECONDS = 180;
const STUCK_MS = 2 * 60 * 1000; // two minutes of trying without a new word…
const STUCK_WRONG_STREAK = 5; // …or this many wrong words in a row
const DIFFICULTY_COLORS = ['bg-emerald-600', 'bg-emerald-600', 'bg-amber-500', 'bg-amber-500', 'bg-orange-600', 'bg-red-600', 'bg-red-700'];
type Mode = 'daily' | 'blitz';
type Dialog = null | 'welcome' | 'rules' | 'hints' | 'archive' | 'blitz-over' | 'leaderboard' | 'name-taken' | 'podium' | 'join-league';
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

const LEAGUE_SEEN_KEY = 'hexicon:league-seen';
const PENDING_LEAGUE_KEY = 'hexicon:pending-league';

/** An invite link (?league=abcd2345) is remembered until the player has a name and can join. */
function takeLeagueInvite(): string | null {
  const url = new URL(location.href);
  const id = url.searchParams.get('league');
  if (id && /^[a-z0-9]{8}$/.test(id)) {
    writeStored(PENDING_LEAGUE_KEY, id);
    url.searchParams.delete('league');
    history.replaceState(history.state, '', url);
  }
  return readStored<string | null>(PENDING_LEAGUE_KEY, null);
}

/** "Mon 9/28" */
function archiveDate(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${dateKey}T12:00:00Z`));
  return `${weekday} ${m}/${d}`;
}

/** Anyone with saved progress from an earlier day has played before. */
function hasPlayedBefore(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('hexicon:daily:'));
  } catch {
    return false;
  }
}

/** The board being played (and when), so a reload after midnight doesn't yank the player to a new board. */
const PLAYING_KEY = 'hexicon:playing';
const KEEP_PLAYING_MS = 3 * 3600 * 1000;

function rememberPlaying(date: string) {
  try {
    sessionStorage.setItem(PLAYING_KEY, JSON.stringify({ date, at: Date.now() }));
  } catch {
    /* no storage */
  }
}

/** ?date=YYYY-MM-DD shows any day's board (read-only once it has locked). */
const datePreview = (() => {
  const param = new URLSearchParams(location.search).get('date');
  return isDateKey(param) && param >= EPOCH ? param : null;
})();

function initialDateKey(): string {
  if (datePreview) return datePreview;
  const today = dateKeyFor();
  // Mid-game when the day changed (e.g. the page reloaded after midnight): stay on that board
  // while it's still open; a banner offers today's board instead.
  try {
    const p = JSON.parse(sessionStorage.getItem(PLAYING_KEY) ?? 'null') as { date: string; at: number } | null;
    if (p && p.date === shiftDateKey(today, -1) && Date.now() - p.at < KEEP_PLAYING_MS && Date.now() < boardLocksAt(p.date)) return p.date;
  } catch {
    /* no storage */
  }
  return today;
}

/**
 * Share text. Phones only open the share sheet straight from a tap, so nothing may be
 * awaited before navigator.share. Dismissing the sheet is fine; if the phone refuses,
 * the text is copied instead.
 */
async function share(text: string): Promise<string> {
  if (isNativeApp) {
    try {
      await nativeShare(text);
      return '';
    } catch {
      return 'Could not share';
    }
  }
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text });
      return '';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return '';
    }
  }
  try {
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
  const [, setPin] = useStoredState<string>(PIN_KEY, '');
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
  const claimName = useCallback(async (n: string, code: string) => {
    const r = await api.claim(n, code);
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
  // The calendar day, re-checked every half minute so midnight is noticed while playing.
  const [today, setToday] = useState(dateKeyFor);
  useEffect(() => {
    const t = setInterval(() => setToday((d) => (d === dateKeyFor() ? d : dateKeyFor())), 30000);
    return () => clearInterval(t);
  }, []);
  const isToday = dateKey === today;
  // The board being played still takes scores (it stays open past midnight until it locks).
  const boardOpen = !datePreview && dateKey >= shiftDateKey(today, -1) && Date.now() < boardLocksAt(dateKey);
  useEffect(() => {
    if (!datePreview) rememberPlaying(dateKey);
  }, [dateKey, dailyFound.found.length]);

  // Live standing on today's leaderboard, shown next to your rank.
  const [standing, setStanding] = useState<{ position: number; total: number } | null>(null);
  const noteStanding = useCallback((b: { total: number; you: { position: number } | null }) => {
    setStanding(b.you ? { position: b.you.position, total: b.total } : null);
  }, []);
  useEffect(() => {
    if (!online || !name || !boardOpen) return;
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
  }, [online, name, boardOpen, boardId, me, noteStanding]);

  // Bring back words this player found on another device or browser today.
  useEffect(() => {
    if (!online || !name || !boardOpen) return;
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
  }, [online, name, boardOpen, boardId, me, setDailyFound]);
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
  // Keep this device's code current (Leaderboard → my code), e.g. for names picked before codes existed.
  useEffect(() => {
    if (online && name) api.me(me).then((r) => r.pin && setPin(r.pin), () => {});
  }, [online, name, me, setPin]);

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
        setPodiumFromArchive(false);
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

  // ---- leagues ---------------------------------------------------------------
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [leagueSeen, setLeagueSeen] = useStoredState<Record<string, number>>(LEAGUE_SEEN_KEY, {});
  const [leaderboardLeague, setLeaderboardLeague] = useState<string | null>(null);
  const loadLeagues = useCallback(() => {
    if (online && name) api.myLeagues(me).then((r) => setLeagues(r.leagues), () => {});
  }, [online, name, me]);
  useEffect(() => {
    loadLeagues();
    const t = setInterval(() => document.visibilityState === 'visible' && loadLeagues(), 60000);
    return () => clearInterval(t);
  }, [loadLeagues]);
  const [chatSeen, setChatSeen] = useStoredState<Record<string, number>>('hexicon:room-chat-seen', {});
  const chatUnread = useMemo(
    () => new Set(leagues.filter((l) => (l.latestChat ?? 0) > (chatSeen[l.id] ?? 0)).map((l) => l.id)),
    [leagues, chatSeen],
  );
  const unreadLeagues = useMemo(
    () => new Set([...leagues.filter((l) => l.latestNews > (leagueSeen[l.id] ?? 0)).map((l) => l.id), ...chatUnread]),
    [leagues, leagueSeen, chatUnread],
  );
  const markChatSeen = useCallback((id: string, at: number) => {
    setChatSeen((s) => (s[id] && s[id] >= at ? s : { ...s, [id]: at }));
  }, [setChatSeen]);
  const markLeagueSeen = useCallback((id: string, at: number) => {
    setLeagueSeen((s) => (s[id] && s[id] >= at ? s : { ...s, [id]: at }));
  }, [setLeagueSeen]);
  const inviteLink = useCallback((id: string) => `${GAME_URL}?league=${id}`, []);
  const inviteToLeague = useCallback(async (l: { id: string; name: string }) => {
    const msg = await share(`Join my Lettertown room “${l.name}”! A new word puzzle every day, so let's see who's best. ${inviteLink(l.id)}`);
    if (msg) setNotice(msg === 'Copied to clipboard' ? 'Invite copied, paste it to your friends' : msg);
  }, [inviteLink]);
  // Arriving from an invite link: once there's a name, ask to join.
  const [pendingLeague, setPendingLeague] = useState<string | null>(takeLeagueInvite);
  const [invite, setInvite] = useState<{ id: string; name: string; members: number } | null>(null);
  useEffect(() => {
    if (!online || !name || !pendingLeague || invite) return;
    api.leagueInfo(pendingLeague).then(
      (info) => {
        setInvite({ id: pendingLeague, ...info });
        setDialog((d) => (d === null || d === 'rules' ? 'join-league' : d));
      },
      () => {
        writeStored(PENDING_LEAGUE_KEY, null);
        setPendingLeague(null);
      },
    );
  }, [online, name, pendingLeague, invite]);
  useEffect(() => {
    if (invite && dialog === null) setDialog('join-league');
  }, [invite, dialog]);
  const answerInvite = async (join: boolean) => {
    const current = invite;
    writeStored(PENDING_LEAGUE_KEY, null);
    setPendingLeague(null);
    setInvite(null);
    if (!join || !current) return setDialog(null);
    try {
      await api.leagueJoin(me, current.id);
      loadLeagues();
      setLeaderboardLeague(current.id);
      setDialog('leaderboard');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not join the room');
      setDialog(null);
    }
  };

  // ---- streak ----------------------------------------------------------------
  // Days in a row with a word found. The server keeps it (so it follows the player across
  // devices); this device's own history covers players without a name.
  const [serverStreak, setServerStreak] = useState<Streak | null>(null);
  useEffect(() => {
    if (online && name) api.me(me).then((r) => r.streak && setServerStreak(r.streak), () => {});
  }, [online, name, me]);
  const streak = useMemo(() => {
    const today = dateKeyFor();
    const yesterday = shiftDateKey(today, -1);
    const alive = (s: Streak | null) => (s && (s.last === today || s.last === yesterday) ? s.count : 0);
    // This device: count back from today (or yesterday, if today isn't played yet).
    const played = (d: string) => readStored<{ found: string[] }>(dailyKey(dailyBoardId(d)), { found: [] }).found.length > 0;
    let local = 0;
    for (let d = played(today) ? today : yesterday; d >= EPOCH && played(d); d = shiftDateKey(d, -1)) local++;
    if (dailyFound.found.length && !played(today)) local++;
    return Math.max(alive(serverStreak), local);
  }, [serverStreak, dailyFound.found.length]);

  // A new streak animal: celebrate it once, the day it's reached.
  useEffect(() => {
    if (!isNewAnimal(streak) || !dailyFound.found.length) return;
    const key = `hexicon:streak-animal:${streak}:${dateKeyFor()}`;
    if (readStored(key, false)) return;
    writeStored(key, true);
    const { emoji, name } = streakAnimal(streak);
    setNotice(`${emoji} ${streak}-day streak! Say hi to your ${name}`);
    haptics.pangram();
  }, [streak, dailyFound.found.length]);

  // Post daily progress to the leaderboard (a moment after each new word).
  const posted = useRef('');
  useEffect(() => {
    const found = dailyFound.found;
    const key = `${name}|${found.length}`;
    if (!online || !name || !boardOpen || !found.length || posted.current === key) return;
    const t = setTimeout(() => {
      api.submitDaily({ playerId: me, name, date: boardId, words: submission(dailyFound) }).then(
        (b) => {
          posted.current = key;
          noteStanding(b);
          if (b.streak) setServerStreak(b.streak);
        },
        (e) => {
          // Someone else owns this name: ask the player to confirm it's them or pick another.
          if (e instanceof ApiRejected && e.status === 409) setDialog((d) => d ?? 'name-taken');
        },
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [dailyFound, online, name, boardOpen, me, boardId, noteStanding]);

  // ---- past boards ----------------------------------------------------------
  const [archiveDay, setArchiveDay] = useState<string | null>(null);
  const archived = usePuzzle(dialog === 'archive' ? archiveDay : null);
  // Words found on the chosen day: saved on this device, plus any from other devices (the server keeps them).
  const [archiveFound, setArchiveFound] = useState<Set<string>>(new Set());
  const [archiveStandings, setArchiveStandings] = useState<{ id: string; board: Board } | null>(null);
  useEffect(() => {
    if (dialog !== 'archive' || !archiveDay) return;
    const id = dailyBoardId(archiveDay);
    const local = readStored<{ found: string[] }>(dailyKey(id), { found: [] }).found;
    setArchiveFound(new Set(local));
    if (!online || !name) return;
    let live = true;
    api.progress(id, me).then(({ found }) => {
      if (live) setArchiveFound(new Set([...local, ...found.map((f) => (typeof f === 'string' ? f : f.w))]));
    }, () => {});
    // Once the board has locked, its final results can be reopened from here.
    if (Date.now() >= boardLocksAt(archiveDay)) {
      api.daily(id, me).then((b) => {
        if (live) setArchiveStandings({ id, board: b });
      }, () => {});
    }
    return () => {
      live = false;
    };
  }, [dialog, archiveDay, online, name, me]);
  const [podiumFromArchive, setPodiumFromArchive] = useState(false);
  const openArchive = (day: string | null = null) => {
    setArchiveDay(day);
    setDialog('archive');
  };

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
    const t = setTimeout(() => setNotice(""), notice.length > 30 ? 4000 : 1800);
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
      standing: mode === 'daily' ? (boardOpen ? standing : null) : blitzStanding,
      streak: mode === 'daily' ? streak : undefined,
    });
    // Daily boards: share "your honeycomb" image where the phone can share pictures.
    if (mode === 'daily' && active.puzzle.dateKey && !isNativeApp) {
      const pz = active.puzzle;
      const where = boardOpen && standing ? `🏆 #${standing.position} of ${standing.total}` : null;
      let card: Blob | null = null;
      try {
        card = drawShareCard(tileHeat(active.found, active.routes ?? {}, activeAnswers), {
          title: `Lettertown #${pz.number}`,
          subtitle: [archiveDate(pz.dateKey!), pz.difficulty !== null ? DIFFICULTY_NAMES[pz.difficulty] : null].filter(Boolean).join(' · '),
          lines: [
            `${p.score} pts · ${p.rank.name}`,
            [where, streak >= 2 ? `${streakAnimal(streak).emoji} ${streak}-day streak` : null].filter(Boolean).join('  ·  ') || `${active.found.length} words`,
            `${active.found.length} words${p.pangramsFound ? ` · ${p.pangramsFound} pangram${p.pangramsFound > 1 ? 's' : ''} 🌟` : ''}`,
          ],
          footer: 'Can you beat me?  onthedcl.github.io/word-game-',
        });
      } catch {
        card = null;
      }
      if (card && (await shareCard(card, text))) return;
    }
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
  const pastBtn = 'flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-sm font-bold shadow-sm active:scale-95';
  const label = (text: string) => <span className="hidden sm:inline">{text}</span>;
  const tab = (m: Mode) =>
    `rounded-full px-2.5 py-1 sm:px-3 text-sm font-semibold ${mode === m ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`;

  return (
    // Phones: exactly one screen tall, no page scrolling. Desktop: normal page.
    // Safe-area padding keeps the iPhone app clear of the notch (it's zero in a browser tab).
    <div className="mx-auto flex h-[100dvh] max-w-5xl flex-col overflow-hidden px-4 pt-[env(safe-area-inset-top)] lg:block lg:h-auto lg:overflow-visible lg:pb-8">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2 lg:py-3">
        <div className="flex min-w-0 flex-1 items-end gap-2">
          <Wordmark />
          <span className="hidden lg:flex">{puzzleMeta}</span>
        </div>
        <div className="flex items-center gap-1.5 lg:order-last">
          <button type="button" onClick={() => openArchive()} className={`${pastBtn} hidden sm:flex`}>
            <CalendarIcon /> Past boards
          </button>
          {online && (
            <button
              type="button"
              onClick={() => {
                setLeaderboardLeague(unreadLeagues.values().next().value ?? null);
                setDialog('leaderboard');
              }}
              className="relative flex items-center gap-1.5 rounded-full bg-gradient-to-b from-[#ffd65a] to-[#f2b01e] px-3 py-1 text-sm font-extrabold text-[#3b2a00] shadow ring-[1.5px] ring-[#1f5fd6] active:scale-95"
            >
              <TrophyIcon /> Leaderboard
              {unreadLeagues.size > 0 && (
                <span className="absolute -top-1 -right-1 size-3 rounded-full bg-bad ring-2 ring-bg" aria-label="Room news" />
              )}
            </button>
          )}
        </div>
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
          <button type="button" className={iconBtn} onClick={onShare} disabled={!active} aria-label="Share"><ShareIcon />{label('Share')}</button>
          <button type="button" className={`${headerBtn} h-8 w-8 font-bold`} onClick={() => setDialog('rules')} aria-label="How to play">?</button>
          {/* Phones: no room beside the logo, so it sits right after the ? button. */}
          <button type="button" onClick={() => openArchive()} className={`${pastBtn} h-8 px-2.5 sm:hidden`} aria-label="Past boards">
            <CalendarIcon /> Past
          </button>
        </nav>
      </header>

      {notice && (
        <button
          type="button"
          role="status"
          onClick={() => setNotice('')}
          aria-label={`${notice}. Tap to dismiss`}
          className="fixed top-16 left-1/2 z-30 flex w-max max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-md bg-ink py-1.5 pr-2 pl-3 text-center text-sm font-semibold text-bg shadow-lg"
        >
          <span>{notice}</span>
          <span aria-hidden className="text-base leading-none opacity-70">×</span>
        </button>
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

      {!datePreview && mode === 'daily' && dateKey < today && (
        // The day changed mid-game: keep playing this board, and switch whenever they like.
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-key/25 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            🌅 It's a new day!{' '}
            {boardOpen ? 'You can finish this board until midnight Pacific.' : 'This board has closed.'}
          </span>
          <button
            type="button"
            onClick={() => {
              rememberPlaying(today);
              location.reload();
            }}
            className="shrink-0 rounded-full bg-ink px-3 py-1 font-semibold text-bg"
          >
            Play today's board
          </button>
        </div>
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
              onLongWord={() => {
                // In the iPhone app, a good moment to ask for a rating (Apple's own sheet), once they're a regular.
                setTimeout(() => maybeAskForReview(streak).catch(() => {}), 1800);
              }}
              starter={!starterDone}
              onStarterUsed={() => setStarterDone(true)}
              onFound={(w, r) => {
                setDailyFound((s) => ({ found: [...s.found, w], routes: { ...s.routes, [w]: r } }));
                setStarterDone(true);
                scheduleDailyReminder().catch(() => {}); // in the iPhone app: once, after the first word
                if (online && !dailyFound.found.length && boardOpen) api.event(me, 'first-word', dateKey).catch(() => {});
              }}
              keyboard={dialog === null}
              statusExtra={
                <span className="flex items-center gap-1.5">
                {standing && (
                  <button
                    type="button"
                    onClick={() => setDialog('leaderboard')}
                    className="rounded-full bg-key/25 px-2.5 py-0.5 text-sm font-bold tabular-nums"
                    aria-label={`You are number ${standing.position} of ${standing.total} today. Open leaderboard`}
                  >
                    🏆 #{standing.position} <span className="font-normal text-muted">of {standing.total}</span>
                  </button>
                )}
                </span>
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
          dateKey={boardOpen ? boardId : dailyBoardId(today)}
          playerId={me}
          name={name}
          onName={async (n) => {
            await saveName(n);
            if (boardOpen && dailyFound.found.length) {
              await api.submitDaily({ playerId: me, name: n, date: boardId, words: submission(dailyFound) }).catch(() => {});
            }
          }}
          onClaim={claimName}
          onDelete={deleteMyData}
          initialTab={mode}
          leagues={leagues}
          initialLeague={leaderboardLeague}
          onLeaguesChanged={loadLeagues}
          onInvite={inviteToLeague}
          inviteLink={inviteLink}
          onNotice={setNotice}
          onLeagueSeen={markLeagueSeen}
          unread={unreadLeagues}
          chatUnread={chatUnread}
          onChatSeen={markChatSeen}
        />
      </Modal>

      {(() => {
        // "yesterday's board", or "board #3" when opened from past boards.
        const day = podium ? parseBoardId(podium.id)?.dateKey ?? '' : '';
        const isYesterday = day === shiftDateKey(dateKeyFor(), -1);
        const which = isYesterday ? "yesterday's board" : `board #${puzzleNumber(day)}`;
        // Opened from past boards: closing goes back there.
        const close = () => (podiumFromArchive ? setDialog('archive') : closeDialog());
        return (
          <Modal open={dialog === 'podium' && !!podium} title={isYesterday ? "Yesterday's results" : `Results · #${puzzleNumber(day)}`} onClose={close}>
            {podium && (
              <Podium
                board={podium.board}
                which={which}
                onClose={close}
                onShare={async () => {
                  const b = podium.board;
                  const place = ['1st', '2nd', '3rd'][b.you!.position - 1];
                  const msg = await share(
                    `🏆 I finished ${place} of ${b.total} on ${isYesterday ? "yesterday's" : `#${puzzleNumber(day)}`} DPIYF Lettertown with ${b.you!.score} points! ` +
                      `Can you beat me today? https://onthedcl.github.io/word-game-/`,
                  );
                  if (msg) setNotice(msg);
                }}
              />
            )}
          </Modal>
        );
      })()}

      <Modal open={dialog === 'join-league' && !!invite} title="You're invited!" onClose={() => answerInvite(false)}>
        {invite && (
          <div className="text-center">
            <div className="text-5xl">🏘️</div>
            <p className="mt-2 text-xl font-black">Join “{invite.name}”?</p>
            <p className="mt-1 text-muted">
              {invite.members} {invite.members === 1 ? 'player' : 'players'} · a leaderboard just for this room, every daily board
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button type="button" onClick={() => answerInvite(true)} className="rounded-full bg-ink px-5 py-2.5 font-bold text-bg active:scale-95">
                Join the room
              </button>
              <button type="button" onClick={() => answerInvite(false)} className="rounded-full border border-line px-5 py-2.5 font-semibold">
                Not now
              </button>
            </div>
          </div>
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
            if (boardOpen && dailyFound.found.length) {
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

      <Modal open={dialog === 'archive'} title={archiveDay ? 'Past board' : 'Past boards'} onClose={closeDialog}>
        <Archive
          today={dateKeyFor()}
          colors={DIFFICULTY_COLORS}
          selected={archiveDay}
          onSelect={setArchiveDay}
          foundCount={(d) => readStored<{ found: string[] }>(dailyKey(dailyBoardId(d)), { found: [] }).found.length}
          puzzle={archived}
          found={archiveFound}
          standings={archiveDay && archiveStandings?.id === dailyBoardId(archiveDay) ? archiveStandings.board : null}
          locked={!!archiveDay && Date.now() >= boardLocksAt(archiveDay)}
          onSeeResults={() => {
            if (!archiveDay || !archiveStandings) return;
            setPodium(archiveStandings);
            setPodiumFromArchive(true);
            setDialog('podium');
          }}
        />
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
