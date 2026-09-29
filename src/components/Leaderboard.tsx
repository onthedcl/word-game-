import { useEffect, useState } from 'react';
import { api, NameTaken, type Board, type LeagueSummary, type LeagueView } from '../api';
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
  leagues: readonly LeagueSummary[];
  /** A league to open straight away (e.g. just joined). */
  initialLeague?: string | null;
  onLeaguesChanged(): void;
  /** Share a room's invite (straight from the tap). */
  onInvite(league: { id: string; name: string }): void;
  /** The invite link for a room. */
  inviteLink(id: string): string;
  /** Show a short message (e.g. "Link copied"). */
  onNotice(text: string): void;
  /** The player has seen a league's news up to this time. */
  onLeagueSeen(id: string, at: number): void;
  /** Which leagues have news the player hasn't seen. */
  unread: ReadonlySet<string>;
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

/** "just now", "5m", "3h", "2d" */
function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export function Leaderboard({
  dateKey, playerId, name, onName, onClaim, onDelete, initialTab,
  leagues, initialLeague, onLeaguesChanged, onInvite, inviteLink, onNotice, onLeagueSeen, unread,
}: Props) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  // Everyone, one of the player's leagues, or the "new league" form.
  const [scope, setScope] = useState<string>(initialLeague ?? 'everyone');
  const [league, setLeague] = useState<LeagueView | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(!name);
  const [reload, setReload] = useState(0);

  // Live: refetch every few seconds while open, keeping the current list on screen.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setBoard(null);
    setLeague(null);
    setError('');
    const load = async () => {
      if (document.visibilityState === 'visible') {
        if (scope === 'new') return;
        try {
          if (scope !== 'everyone') {
            const l = await api.league(scope, dateKey, playerId);
            if (!live) return;
            setLeague(l);
            setBoard(l.board);
            setError('');
            onLeagueSeen(scope, Date.now());
          } else {
            const b = await (tab === 'daily' ? api.daily(dateKey, playerId) : api.blitz(playerId));
            if (!live) return;
            setBoard(b);
            setError('');
          }
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
  }, [tab, dateKey, playerId, reload, scope]);

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

      {name && (
        <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Leaderboards">
          {[{ id: 'everyone', name: 'Everyone' }, ...leagues].map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={scope === l.id}
              onClick={() => setScope(l.id)}
              className={`relative shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-semibold ${
                scope === l.id ? 'border-ink bg-ink text-bg' : 'border-line'
              }`}
            >
              {l.name}
              {unread.has(l.id) && scope !== l.id && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-bad" aria-label="new" />}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setScope('new')}
            className={`shrink-0 whitespace-nowrap rounded-full border border-dashed px-3 py-1 text-sm font-semibold ${
              scope === 'new' ? 'border-ink' : 'border-muted text-muted'
            }`}
          >
            + Room
          </button>
        </div>
      )}

      {scope === 'new' ? (
        <Rooms
          playerId={playerId}
          onCreated={(l) => {
            onLeaguesChanged();
            setScope(l.id);
            setInviteOpen(true);
          }}
          onJoined={(id) => {
            onLeaguesChanged();
            setScope(id);
          }}
        />
      ) : scope !== 'everyone' ? (
        league && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-sm text-muted">
                <b className="text-ink">{league.name}</b> · {league.members} {league.members === 1 ? 'member' : 'members'} ·{' '}
                {league.public ? 'public' : 'private'}
              </p>
              <button
                type="button"
                onClick={() => setInviteOpen((o) => !o)}
                className="shrink-0 rounded-full bg-ink px-3 py-1 text-sm font-bold text-bg"
                aria-expanded={inviteOpen}
              >
                Invite friends
              </button>
            </div>
            {inviteOpen && (
              <div className="mt-2 rounded-xl bg-bg p-3">
                <p className="mb-2 text-sm">Send this link to friends. Opening it asks them to join <b>{league.name}</b>.</p>
                <input
                  readOnly
                  value={inviteLink(league.id)}
                  onFocus={(e) => e.target.select()}
                  aria-label="Invite link"
                  className="mb-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onInvite({ id: league.id, name: league.name })}
                    className="flex-1 rounded-lg bg-ink px-3 py-2 font-semibold text-bg"
                  >
                    Share…
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard.writeText(inviteLink(league.id)).then(
                        () => onNotice('Invite link copied'),
                        () => onNotice('Press and hold the link to copy it'),
                      )
                    }
                    className="flex-1 rounded-lg border border-line px-3 py-2 font-semibold"
                  >
                    Copy link
                  </button>
                </div>
                {league.owner && (
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!league.public}
                      onChange={async (e) => {
                        const on = e.target.checked;
                        setLeague({ ...league, public: on });
                        await api.setRoomPublic(playerId, league.id, on).catch(() => setLeague({ ...league }));
                      }}
                    />
                    List in public rooms (anyone can find and join it)
                  </label>
                )}
              </div>
            )}
          </div>
        )
      ) : (
        <div className="mb-3 flex rounded-full border border-line p-0.5" role="tablist">
          {tabBtn('daily', "Today's puzzle")}
          {tabBtn('blitz', 'Blitz best')}
        </div>
      )}

      {scope !== 'new' && board && (
        <p className="-mt-1 mb-2 flex items-center gap-1.5 text-xs text-muted">
          <span className={`inline-block size-2 rounded-full ${error ? 'bg-bad' : 'animate-pulse bg-good'}`} />
          {error ? 'Reconnecting…' : 'Live'}
        </p>
      )}
      {scope === 'new' ? null : error && !board ? (
        <p className="py-6 text-center text-sm text-muted">
          Couldn't reach the leaderboard. {error}{' '}
          <button type="button" className="underline" onClick={() => setReload((r) => r + 1)}>Retry</button>
        </p>
      ) : !board ? (
        <p className="py-6 text-center text-sm text-muted">Loading…</p>
      ) : !board.total ? (
        <p className="py-6 text-center text-sm text-muted">
          {scope === 'everyone' ? 'No scores yet. Be the first!' : 'No one in this room has played today yet. Be the first!'}
        </p>
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

      {scope !== 'everyone' && scope !== 'new' && league && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-bold">Room news</h3>
          {league.news.length ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {league.news.slice(0, 12).map((n) => (
                <li key={`${n.at}-${n.text}`} className="flex gap-2">
                  <span className="min-w-0 flex-1">{n.text}</span>
                  <span className="shrink-0 text-xs text-muted">{ago(n.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing yet.</p>
          )}
          <button
            type="button"
            className="mt-3 text-xs text-muted underline"
            onClick={async () => {
              if (!confirm(`Leave ${league.name}?`)) return;
              setInviteOpen(false);
              await api.leagueLeave(playerId, league.id).catch(() => {});
              onLeaguesChanged();
              setScope('everyone');
            }}
          >
            Leave this room
          </button>
        </div>
      )}
    </div>
  );
}

type PublicRoom = { id: string; name: string; members: number; joined: boolean };

/** Host a room (public or private), or join a public one. */
function Rooms({
  playerId, onCreated, onJoined,
}: { playerId: string; onCreated(l: { id: string; name: string }): void; onJoined(id: string): void }) {
  const [value, setValue] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  useEffect(() => {
    api.publicRooms(playerId).then((r) => setRooms(r.rooms), () => setRooms([]));
  }, [playerId]);
  const seg = (on: boolean) => `flex-1 rounded-full px-3 py-1 text-sm font-semibold ${on ? 'bg-ink text-bg' : 'text-muted'}`;
  return (
    <div className="mb-2 space-y-3">
      <form
        className="rounded-xl bg-bg p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            onCreated(await api.leagueCreate(playerId, value.trim(), isPublic));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create the room');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="text-sm font-semibold" htmlFor="room-name">Host a room</label>
        <p className="mb-2 text-xs text-muted">A leaderboard for your friends, family or office, for every daily board.</p>
        <div className="mb-2 flex rounded-full border border-line p-0.5" role="radiogroup" aria-label="Who can join">
          <button type="button" role="radio" aria-checked={!isPublic} className={seg(!isPublic)} onClick={() => setIsPublic(false)}>
            🔒 Private
          </button>
          <button type="button" role="radio" aria-checked={isPublic} className={seg(isPublic)} onClick={() => setIsPublic(true)}>
            🌎 Public
          </button>
        </div>
        <p className="mb-2 text-xs text-muted">
          {isPublic ? 'Listed below for anyone to join, and you can invite friends too.' : 'Only people with your invite link can join.'}
        </p>
        <div className="flex gap-2">
          <input
            id="room-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={24}
            placeholder="e.g. The Office"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-base"
          />
          <button type="submit" disabled={busy || value.trim().length < 2} className="rounded-lg bg-ink px-4 py-2 font-semibold text-bg disabled:opacity-50">
            {busy ? '…' : 'Create'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      </form>

      <div>
        <h3 className="mb-1 text-sm font-bold">Public rooms</h3>
        {!rooms ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !rooms.length ? (
          <p className="text-sm text-muted">No public rooms yet. Host the first one!</p>
        ) : (
          <ul className="max-h-48 overflow-y-auto">
            {rooms.map((r) => (
              <li key={r.id} className="flex items-center gap-2 border-b border-line py-1.5">
                <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                <span className="text-xs text-muted">{r.members} {r.members === 1 ? 'player' : 'players'}</span>
                {r.joined ? (
                  <button type="button" className="rounded-full border border-line px-3 py-0.5 text-sm" onClick={() => onJoined(r.id)}>Open</button>
                ) : (
                  <button
                    type="button"
                    className="rounded-full bg-ink px-3 py-0.5 text-sm font-semibold text-bg"
                    onClick={async () => {
                      try {
                        await api.leagueJoin(playerId, r.id);
                        onJoined(r.id);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Could not join');
                      }
                    }}
                  >
                    Join
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
