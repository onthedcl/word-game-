import { useState } from 'react';
import { api, NameTaken } from '../api';

interface Props {
  playerId: string;
  name: string;
  /** Save a (possibly new) leaderboard name; throws NameTaken if someone else has it. */
  onName(name: string): Promise<void>;
  /** The player's new code is saved. */
  onDone(code: string): void;
  onLater(): void;
}

/** Confirm (or change) your leaderboard name and pick your own 4-digit code. */
export function SetupAccount({ playerId, name, onName, onDone, onLater }: Props) {
  const [newName, setNewName] = useState(name);
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setError('');
    if (code !== again) return setError('The two codes don’t match');
    setBusy(true);
    try {
      const trimmed = newName.trim();
      if (trimmed !== name) {
        try {
          await onName(trimmed);
        } catch (err) {
          throw err instanceof NameTaken ? new Error(`“${trimmed}” is taken. Try another name`) : err;
        }
      }
      const r = await api.setCode(playerId, code);
      onDone(r.pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Try again');
    } finally {
      setBusy(false);
    }
  }

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="text-sm">
        Keep your name yours: pick a 4-digit code only you know. You’ll use it with your name to play on another
        device. Your scores and streak stay just as they are.
      </p>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Your leaderboard name
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={16}
          autoComplete="nickname"
          className="rounded-lg border border-line bg-bg px-3 py-2 text-base font-normal"
        />
      </label>
      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">
          Your code
          <input
            value={code}
            onChange={(e) => setCode(digits(e.target.value))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="4 digits"
            className="w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-base font-normal tracking-widest"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">
          Once more
          <input
            value={again}
            onChange={(e) => setAgain(digits(e.target.value))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="4 digits"
            className="w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-base font-normal tracking-widest"
          />
        </label>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <button
        type="submit"
        disabled={busy || newName.trim().length < 2 || code.length !== 4 || again.length !== 4}
        className="rounded-lg bg-ink px-4 py-2 font-semibold text-bg disabled:opacity-50"
      >
        {busy ? '…' : 'Save'}
      </button>
      <button type="button" className="self-center text-sm text-muted underline" onClick={onLater}>
        Not now
      </button>
    </form>
  );
}
