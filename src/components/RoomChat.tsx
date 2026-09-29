// A room's chat. Members only; offensive words are masked by the server. Tap a message
// to delete it (yours, or any if you host), or to report it or hide its sender.
import { useEffect, useRef, useState } from 'react';
import { api, type ChatMessage } from '../api';

const POLL_MS = 3000;

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface Props {
  roomId: string;
  playerId: string;
  /** Lower-cased names this player has hidden. */
  hidden: readonly string[];
  onHide(name: string): void;
  onSeen(at: number): void;
}

export function RoomChat({ roomId, playerId, hidden, onHide, onSeen }: Props) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [host, setHost] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [reported, setReported] = useState<string[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const r = await api.chat(roomId, playerId);
          if (!live) return;
          setMessages(r.messages);
          setHost(r.host);
          onSeen(Date.now());
        } catch {
          /* keep what's on screen */
        }
      }
      if (live) timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [roomId, playerId, onSeen]);

  // Stay pinned to the newest message unless the player has scrolled up to read.
  useEffect(() => {
    const el = list.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError('');
    try {
      const { message } = await api.sendChat(playerId, roomId, t);
      setMessages((m) => [...(m ?? []), message]);
      setText('');
      atBottom.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  }

  const shown = (messages ?? []).filter((m) => m.mine || !hidden.includes(m.name.toLowerCase()));
  return (
    <div>
      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        // As tall as the screen allows: everything else in the dialog takes about 330px.
        className="mb-2 h-[max(16rem,calc(100dvh-330px))] space-y-1.5 overflow-y-auto rounded-xl bg-bg p-2"
        aria-live="polite"
      >
        {!messages ? (
          <p className="p-2 text-sm text-muted">Loading…</p>
        ) : !shown.length ? (
          <p className="p-2 text-sm text-muted">No messages yet. Say hi 👋</p>
        ) : (
          shown.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[85%]">
                <button
                  type="button"
                  onClick={() => setMenu(menu === m.id ? null : m.id)}
                  className={`rounded-2xl px-3 py-1.5 text-left text-sm ${m.mine ? 'bg-ink text-bg' : 'bg-surface shadow-sm'}`}
                >
                  {!m.mine && <span className="block text-xs font-bold opacity-70">{m.name}</span>}
                  <span className="break-words">{m.text}</span>
                </button>
                <div className={`mt-0.5 flex gap-3 px-1 text-xs text-muted ${m.mine ? 'justify-end' : ''}`}>
                  <span>{time(m.at)}</span>
                  {menu === m.id && (m.mine || host) && (
                    <button
                      type="button"
                      className="underline"
                      onClick={async () => {
                        await api.deleteChat(playerId, roomId, m.id).catch(() => {});
                        setMessages((all) => (all ?? []).filter((x) => x.id !== m.id));
                        setMenu(null);
                      }}
                    >
                      Delete
                    </button>
                  )}
                  {menu === m.id && !m.mine && (
                    <>
                      {reported.includes(m.id) ? (
                        <span>Reported. Thanks!</span>
                      ) : (
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            api.reportChat(playerId, roomId, m.id).catch(() => {});
                            setReported((r) => [...r, m.id]);
                          }}
                        >
                          Report
                        </button>
                      )}
                      <button type="button" className="underline" onClick={() => { onHide(m.name); setMenu(null); }}>
                        Hide {m.name}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <form onSubmit={send} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Message the room…"
          aria-label="Message"
          enterKeyHint="send"
          className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2 text-base"
        />
        <button type="submit" disabled={busy || !text.trim()} className="rounded-full bg-ink px-4 py-2 font-semibold text-bg disabled:opacity-50">
          Send
        </button>
      </form>
      {error && <p className="mt-1 text-sm text-bad">{error}</p>}
    </div>
  );
}
