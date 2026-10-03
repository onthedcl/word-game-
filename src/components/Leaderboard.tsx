import { useCallback, useEffect, useState } from 'react';
import { api, NameTaken, type Board, type LeagueSummary, type LeagueView } from '../api';
import { PIN_KEY, readStored, writeStored } from '../storage';
import { RoomChat } from './RoomChat';
import { streakAnimal } from '../engine/streak';
import { appRules } from '../native';

const HIDDEN_KEY = 'hexicon:hidden-names';

const LIVE_REFRESH_MS = 5000;

type Tab = 'daily' | 'blitz';

interface Props {
  dateKey: string;
  playerId: string;
  name: string;
  onName(name: string): Promise<void>;
  onClaim(name: string, code: string): Promise<void>;
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
  /** Which leagues have news or chat the player hasn't seen. */
  unread: ReadonlySet<string>;
  /** Which rooms have chat messages the player hasn't seen. */
  chatUnread: ReadonlySet<string>;
  /** The player has read a room's chat up to this time. */
  onChatSeen(id: string, at: number): void;
  /** This player's current streak (days in a row), shown only to them. */
  streak: number;
  /** How they sign in ('google.com', 'apple.com', 'password'), or null if they don't. */
  account: string | null;
  /** Open the sign-in screen (absent when sign-in isn't set up). */
  onSignIn?(): void;
  onSignOut(): void;
}

interface NameFormProps {
  name: string;
  cta: string;
  onSave(name: string): Promise<void>;
  /** Continue as the player who already has this name (e.g. on a new device), with their code. */
  onClaim?(name: string, code: string): Promise<void>;
  /** Sign in instead (when the name is saved to an account). */
  onSignIn?(): void;
}

export function NameForm({ name, cta, onSave, onClaim, onSignIn }: NameFormProps) {
  const [value, setValue] = useState(name);
  const [taken, setTaken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [lost, setLost] = useState<'no' | 'asking' | 'sent'>('no');
  const [note, setNote] = useState('');
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
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => onClaim!(taken, code)); }}>
        {onSignIn && (
          <button type="button" onClick={onSignIn} className="rounded-lg border border-ink px-4 py-2 font-semibold">
            That’s me: sign in to my account
          </button>
        )}
        <p className="text-sm">
          <b>“{taken}”</b> is already on the leaderboard. If that’s you{onSignIn ? ' and you haven’t saved it to an account' : ''}, enter the 4-digit code you chose. You can
          also see it on your other device under <b>Leaderboard → my code</b>.
        </p>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Code"
            aria-label="Your 4-digit code"
            className="w-24 rounded-lg border border-line bg-bg px-3 py-2 text-base tracking-widest"
          />
          <button type="submit" disabled={busy || code.length !== 4} className="flex-1 rounded-lg bg-ink px-4 py-2 font-semibold text-bg disabled:opacity-50">
            {busy ? '…' : `Continue as ${taken}`}
          </button>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        {lost === 'sent' ? (
          <p className="text-sm text-muted">Thanks, we’ve let the game’s owner know. They’ll help you get back in.</p>
        ) : lost === 'asking' ? (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-2">
            <label className="text-sm" htmlFor="lost-note">
              We’ll let the game’s owner know. Anything that helps them know it’s you? (optional)
            </label>
            <input
              id="lost-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 140))}
              placeholder="e.g. your first name, or who invited you"
              className="rounded-lg border border-line bg-bg px-3 py-2 text-base"
            />
            <button
              type="button"
              className="self-start rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-bg"
              onClick={() => { setLost('sent'); api.lostCode(taken, note).catch(() => {}); }}
            >
              Let the owner know
            </button>
          </div>
        ) : (
          <button type="button" className="self-start text-sm text-muted underline" onClick={() => setLost('asking')}>
            Can’t find your code?
          </button>
        )}
        <button type="button" className="self-start text-sm text-muted underline" onClick={() => { setTaken(null); setError(''); setCode(''); setLost('no'); setNote(''); }}>
          That’s not me, pick a different name
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
  leagues, initialLeague, onLeaguesChanged, onInvite, inviteLink, onNotice, onLeagueSeen, unread, chatUnread, onChatSeen, streak, account, onSignIn, onSignOut,
}: Props) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  // Everyone, one of the player's leagues, or the "new league" form.
  const [scope, setScope] = useState<string>(initialLeague ?? 'everyone');
  // Inside a room: its leaderboard or its chat.
  const [roomTab, setRoomTab] = useState<'board' | 'chat'>('board');
  const [confirmRoomDelete, setConfirmRoomDelete] = useState(false);
  const [league, setLeague] = useState<LeagueView | null>(null);
  // The iPhone app keeps chat to private, invite-only rooms: Apple doesn't allow chat between strangers.
  const chatOff = appRules && !!league?.public;
  const inChat = scope !== 'everyone' && scope !== 'new' && roomTab === 'chat' && !chatOff;
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
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState(() => readStored(PIN_KEY, ''));
  const [newCode, setNewCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const chatSeen = useCallback((at: number) => {
    if (scope !== 'everyone' && scope !== 'new') onChatSeen(scope, at);
  }, [scope, onChatSeen]);
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
            onSignIn={onSignIn}
          />
          <p className="mt-2 text-xs text-muted">Shown to everyone. Your daily score is posted as you play; Blitz scores post when time runs out.</p>
        </div>
      ) : inChat ? null : (
        <div className="mb-3 text-sm text-muted">
          Playing as <b className="text-ink">{name}</b>
          {streak > 0 && (
            <span className="ml-1.5 font-semibold text-ink" title="Days in a row you’ve found at least one word">
              · {streakAnimal(streak).emoji} {streak}-day streak
            </span>
          )}{' '}
          <button type="button" className="underline" onClick={() => setEditing(true)}>change</button>
          {' · '}
          {account ? (
            <span className="whitespace-nowrap">
              ✓ Saved to {account === 'google.com' ? 'Google' : account === 'apple.com' ? 'Apple' : 'email'}{' '}
              (<button type="button" className="underline" onClick={onSignOut}>sign out</button>)
            </span>
          ) : onSignIn ? (
            <button type="button" className="font-semibold text-ink underline" onClick={onSignIn}>Save my progress</button>
          ) : null}
          {(account || onSignIn) && ' · '}
          {!account && (
          <button
            type="button"
            className="underline"
            onClick={() => {
              setShowCode((v) => !v);
              // Fetch it fresh, so players from before codes existed get theirs set up now.
              api.me(playerId).then((r) => { if (r.pin) { writeStored(PIN_KEY, r.pin); setCode(r.pin); } }, () => {});
            }}
          >
            my code
          </button>
          )}
          {!account && ' · '}
          <button type="button" className="underline" onClick={() => setConfirmDelete(true)}>delete my data</button>
          {showCode && (
            <div className="mt-2 rounded-xl bg-bg p-3 text-ink">
              {code ? (
                <p>Your code is <b className="tracking-widest">{code}</b>. To play on another device, type your name there, then this code. Keep it to yourself.</p>
              ) : (
                <p>Getting your code… (you need to be online)</p>
              )}
              {code && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setCodeError('');
                    api.setCode(playerId, newCode).then(
                      (r) => { writeStored(PIN_KEY, r.pin); setCode(r.pin); setNewCode(''); onNotice('Code changed'); },
                      (err) => setCodeError(err instanceof Error ? err.message : 'Could not change your code'),
                    );
                  }}
                >
                  <label htmlFor="new-code" className="text-sm text-muted">Change it to</label>
                  <input
                    id="new-code"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="4 digits"
                    className="w-24 rounded-lg border border-line bg-surface px-3 py-1.5 text-base tracking-widest"
                  />
                  <button type="submit" disabled={newCode.length !== 4} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-bg disabled:opacity-50">
                    Save
                  </button>
                  {codeError && <p className="w-full text-sm text-bad">{codeError}</p>}
                </form>
              )}
            </div>
          )}
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
              onClick={() => {
                setScope(l.id);
                setRoomTab('board');
                setInviteOpen(false);
                setConfirmRoomDelete(false);
              }}
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
                    List in public rooms (anyone can find and join it){appRules ? '; chat stays off' : ''}
                  </label>
                )}
              </div>
            )}
            {chatOff ? (
              <p className="mt-3 text-xs text-muted">Chat is available in private rooms.</p>
            ) : (
            <div className="mt-3 flex rounded-full border border-line p-0.5" role="tablist" aria-label="Room">
              {(['board', 'chat'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={roomTab === t}
                  onClick={() => setRoomTab(t)}
                  className={`relative flex-1 rounded-full px-3 py-1 text-sm font-semibold ${roomTab === t ? 'bg-ink text-bg' : 'text-muted'}`}
                >
                  {t === 'board' ? '🏆 Leaderboard' : '💬 Chat'}
                  {t === 'chat' && roomTab !== 'chat' && chatUnread.has(league.id) && (
                    <span className="absolute top-1 right-3 size-2.5 rounded-full bg-bad" aria-label="new messages" />
                  )}
                </button>
              ))}
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

      {inChat && league && (
        <RoomChat
          roomId={league.id}
          playerId={playerId}
          hidden={hidden}
          onHide={(n) => hide(n)}
          onSeen={chatSeen}
        />
      )}

      {!inChat && scope !== 'new' && board && (
        <p className="-mt-1 mb-2 flex items-center gap-1.5 text-xs text-muted">
          <span className={`inline-block size-2 rounded-full ${error ? 'bg-bad' : 'animate-pulse bg-good'}`} />
          {error ? 'Reconnecting…' : 'Live'}
        </p>
      )}
      {scope === 'new' || inChat ? null : error && !board ? (
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
                  <span className="min-w-0 flex-1 truncate">
                    {r.name}
                    {r.you && ' (you)'}
                  </span>
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
        <div className={inChat ? "" : "mt-4"}>
          {!inChat && (
          <>
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
          </>
          )}
          {league.owner && !inChat && (
            <div className="mt-2">
              {!confirmRoomDelete ? (
                <button type="button" className="text-xs text-bad underline" onClick={() => setConfirmRoomDelete(true)}>
                  Delete this room
                </button>
              ) : (
                <div className="rounded-xl bg-bad/10 p-3 text-sm">
                  <p className="mb-2">
                    Are you sure? This deletes <b>{league.name}</b> for everyone: its leaderboard, news and chat. Everyone's
                    scores stay on the main leaderboard.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-bad px-3 py-1.5 font-semibold text-white"
                      onClick={async () => {
                        try {
                          await api.deleteRoom(playerId, league.id);
                          onNotice(`${league.name} was deleted`);
                          onLeaguesChanged();
                          setScope('everyone');
                        } catch (err) {
                          onNotice(err instanceof Error ? err.message : 'Could not delete the room');
                        }
                        setConfirmRoomDelete(false);
                      }}
                    >
                      Yes, delete it
                    </button>
                    <button type="button" className="rounded-lg border border-line px-3 py-1.5" onClick={() => setConfirmRoomDelete(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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
