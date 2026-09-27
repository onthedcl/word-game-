// localStorage with graceful failure (private mode, blocked storage).
import { useCallback, useState } from 'react';

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* play on without saving */
  }
}

export function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback));
  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        writeStored(key, resolved);
        return resolved;
      });
    },
    [key],
  );
  return [value, update] as const;
}

export const dailyKey = (dateKey: string) => `hexicon:daily:${dateKey}`;

/** Anonymous id for this browser, used to keep one leaderboard entry per player. */
export function playerId(): string {
  let id = readStored<string | null>('hexicon:player-id', null);
  if (!id) {
    id = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    writeStored('hexicon:player-id', id);
  }
  return id;
}

export const NAME_KEY = 'hexicon:player-name';
export const PIN_KEY = 'hexicon:player-pin';

/** Switch this device to another player (after signing in with name + PIN). */
export function setPlayerId(id: string): void {
  writeStored('hexicon:player-id', id);
}

// ---- home-screen apps ----------------------------------------------------------
// On iPhone, an icon added to the home screen gets its own empty storage, so the
// game would start as a new player. It does open at the address it was added
// from, though, so that address carries the player id ("?p=") and a fresh
// home-screen app picks it up. The id is never shown to anyone else.
const CARRY_PARAM = 'p';
const ADOPTED_KEY = 'hexicon:adopted';
const CARRIED_ID = /^[A-Za-z0-9-]{16,64}$/;

export function isHomeScreenApp(): boolean {
  try {
    return (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/**
 * Before the app starts: a home-screen app with no player of its own becomes the
 * player it was added by. A shared link opened in a browser is ignored.
 */
export function adoptCarriedPlayer(): void {
  const carried = new URLSearchParams(location.search).get(CARRY_PARAM);
  if (!carried || !CARRIED_ID.test(carried) || !isHomeScreenApp() || readStored(NAME_KEY, '')) return;
  setPlayerId(carried);
  writeStored(ADOPTED_KEY, true);
  writeStored('hexicon:asked-name', true);
  writeStored('hexicon:seen-rules', true);
}

/** True when this device took its player from the address and still needs their name. */
export function adoptedPlayer(): boolean {
  return readStored(ADOPTED_KEY, false);
}

/** Keep the address pointing at this device's own player (once they have a name), for "Add to Home Screen". */
export function syncCarryParam(id: string, named: boolean): void {
  try {
    const url = new URL(location.href);
    const want = named ? id : null;
    if (url.searchParams.get(CARRY_PARAM) === want) return;
    if (want) url.searchParams.set(CARRY_PARAM, want);
    else url.searchParams.delete(CARRY_PARAM);
    history.replaceState(history.state, '', url);
  } catch {
    /* the address just won't carry the player */
  }
}
