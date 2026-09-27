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
