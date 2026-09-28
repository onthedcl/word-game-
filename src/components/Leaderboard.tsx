import { useEffect, useState } from 'react';
import { api, NameTaken, type Board } from '../api';
import { readStored, writeStored } from '../storage';

const HIDDEN_KEY = 'hexicon:hidden-names';

const LIVE_REFRESH_MS = 5000;

type Tab = 'daily' | 'blitz';

interface Props {
  dateKey: string;
  playerId: string;
  name: string;
  onName(name: string): Promise<void>;
  onClaim(name: string): Promise<void>;
  /** Erase this player's data (server and device). */
  onDelete(): Promise<void>;
  initialTab: Tab;
}

interface NameFormProps {
  name: string;
  cta: string;
  onSave(name: string): Promise<void>;
  /** Continue as the player who already has this name (e.g. on a new device). */
  onClaim?(name: string): Promise<void>;
}

export function NameForm({ name, cta, onSave, onClaim }: NameFormProps) {
  const [value, setValue] = useState(name);
  const [taken, setTaken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      if (err instanceof NameTaken && onClaim) setTaken(err.name);
      else setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (taken) {
    return (
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => onClaim!(taken)); }}>
        <p className="text-sm">
          <b>“{taken}”</b> is already on the leaderboard. Is that you?
        </p>
        <button type="submit" disabled={busy} className="rounded-lg bg-ink px-4 py-2 font-semibold text-bg disabled:opacity-50">
          {busy ? '…' : `Yes, continue as ${taken}`}
        </button>
        {error && <p className="text-sm text-bad">{error}</p>}
        <button type="button" className="self-start text-sm text-muted underline" onClick={() => { setTaken(null); setError(''); }}>
          No, pick a different name
        </button>
      </form>
    );
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => onSave(value.trim())); }}>
      <label className="text-sm font-semibold" htmlFor="lb-name">Your leaderboard name</label>
      <div className="flex gap-2">
        <input
          id="lb-name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={16}
          autoComplete="nickname"
          placeholder="2–16 letters"
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-base"
        />
        <button type="submit" disabled={busy || value.trim().length < 2} className="rounded-lg bg-ink px-4 py-2 font-semibold text-bg disabled:opacity-50">
          {busy ? '…' : cta}
        </button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </form>
  );
}

export function Leaderboard({ dateKey, playerId, name, onName, onClaim, onDelete, initialTab }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(!name);
  const [reload, setReload] = useState(0);

  // Live: refetch every few seconds while open, keeping the current list on screen.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setBoard(null);
    setError('');
    const load = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const b = await (tab === 'daily' ? api.daily(dateKey, playerId) : api.blitz(playerId));
          if (!live) return;
          setBoard(b);
          setError('');
        } catch (e) {
          if (live) setError((e as Error).message);
        }
      }
      if (live) timer = setTimeout(load, LIVE_REFRESH_MS);
    };
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tab, dateKey, playerId, reload]);

  // Players can hide names they don't want to see, and report offensive ones.
  const [hidden, setHidden] = useState<string[]>(() => readStored<string[]>(HIDDEN_KEY, []));
  const [menu, setMenu] = useState<string | null>(null);
  const [reported, setReported] = useState<string[]>([]);
  const hide = (n: string) => {
    const next = [...new Set([...hidden, n.toLowerCase()])];
    setHidden(next);
    writeStored(HIDDEN_KEY, next);
    setMenu(null);
  };
  const report = (n: string) => {
    api.report(playerId, n).catch(() => {});
    setReported((r) => [...r, n]);
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      className={`flex-1 rounded-full px-3 py-1 text-sm font-semibold ${tab === t ? 'bg-ink text-bg' : 'text-muted'}`}
    >
      {label}
    </button>
  );

  return (
    <div>
      {editing ? (
        <div className="mb-4 rounded-xl bg-bg p-3">
          <NameForm
            name={name}
            cta="Save"
            onSave={async (n) => {
              await onName(n);
              setEditing(false);
              setReload((r) => r + 1);
            }}
            onClaim={onClaim}
          />
          <p className="mt-2 text-xs text-muted">Shown to everyone. Your daily score is posted as you play; Blitz scores post when time runs out.</p>
        </div>
      ) : (
        <div className="mb-3 text-sm text-muted">
          Playing as <b className="text-ink">{name}</b>{' '}
          <button type="button" className="underline" onClick={() => setEditing(true)}>change</button>
          {' · '}
          <button type="button" className="underline" onClick={() => setConfirmDelete(true)}>delete my data</button>
          {confirmDelete && (
            <div className="mt-2 rounded-xl bg-bg p-3 text-ink">
              <p className="mb-2">Delete your name, scores and progress from DPIYF Lettertown? This can't be undone.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  className="rounded-lg bg-bad px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                  onClick={async () => {
                    setDeleting(true);
                    await onDelete().finally(() => setDeleting(false));
                  }}
                >
                  {deleting ? 'Deleting…' : 'Delete everything'}
                </button>
                <button type="button" className="rounded-lg border border-line px-3 py-1.5" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-3 flex rounded-full border border-line p-0.5" role="tablist">
        {tabBtn('daily', "Today's puzzle")}
        {tabBtn('blitz', 'Blitz best')}
      </div>

      {board && (
        <p className="-mt-1 mb-2 flex items-center gap-1.5 text-xs text-muted">
          <span className={`inline-block size-2 rounded-full ${error ? 'bg-bad' : 'animate-pulse bg-good'}`} />
          {error ? 'Reconnecting…' : 'Live'}
        </p>
      )}
      {error && !board ? (
        <p className="py-6 text-center text-sm text-muted">
          Couldn't reach the leaderboard. {error}{' '}
          <button type="button" className="underline" onClick={() => setReload((r) => r + 1)}>Retry</button>
        </p>
      ) : !board ? (
        <p className="py-6 text-center text-sm text-muted">Loading…</p>
      ) : !board.total ? (
        <p className="py-6 text-center text-sm text-muted">No scores yet. Be the first!</p>
      ) : (
        <>
          <ol className="max-h-[50vh] overflow-y-auto">
            {board.top.filter((r) => r.you || !hidden.includes(r.name.toLowerCase())).map((r) => (
              <li key={r.position} className="border-b border-line">
                <button
                  type="button"
                  disabled={r.you}
                  onClick={() => setMenu(menu === r.name ? null : r.name)}
                  className={`flex w-full items-center gap-3 px-1 py-1.5 text-left ${r.you ? 'rounded bg-key/30 font-bold' : ''}`}
                >
                  <span className="w-7 text-right tabular-nums text-muted">{r.position <= 3 ? ['🥇', '🥈', '🥉'][r.position - 1] : r.position}</span>
                  <span className="min-w-0 flex-1 truncate">{r.name}{r.you && ' (you)'}</span>
                  <span className="hidden text-xs text-muted sm:inline">{r.rankName} · {r.words}w{r.pangrams ? ' · 🌟' : ''}</span>
                  <span className="w-12 text-right font-bold tabular-nums">{r.score}</span>
                </button>
                {menu === r.name && !r.you && (
                  <div className="flex gap-3 px-10 pb-2 text-sm">
                    {reported.includes(r.name) ? (
                      <span className="text-muted">Reported. Thanks!</span>
                    ) : (
                      <button type="button" className="underline" onClick={() => report(r.name)}>Report name</button>
                    )}
                    <button type="button" className="underline" onClick={() => hide(r.name)}>Hide this player</button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-sm text-muted">
            {board.total} {board.total === 1 ? 'player' : 'players'}
            {hidden.length > 0 && (
              <>
                {' · '}
                <button type="button" className="underline" onClick={() => { setHidden([]); writeStored(HIDDEN_KEY, []); }}>
                  show hidden
                </button>
              </>
            )}
            {board.you && board.you.position > board.top.length ? ` · You're #${board.you.position} with ${board.you.score}` : ''}
          </p>
        </>
      )}
    </div>
  );
}
