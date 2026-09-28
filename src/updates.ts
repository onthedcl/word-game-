// Detects when a newer build has been deployed to the same URL.
import { useCallback, useEffect, useRef, useState } from 'react';

const CHECK_EVERY_MS = 5 * 60 * 1000;

/** The hashed entry script of a built page, e.g. "/word-game-/assets/index-abc123.js". */
function entryScript(doc: Document): string | null {
  return doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null;
}

async function deployedEntryScript(): Promise<string | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return entryScript(new DOMParser().parseFromString(await res.text(), 'text/html'));
}

/**
 * Checks for a new deploy every few minutes and whenever the app comes back to
 * the foreground. Returning to the app reloads straight away when `canReload`
 * (progress is saved, so nothing is lost); otherwise `updateReady` is set so the
 * UI can offer a refresh.
 */
export function useUpdateCheck(canReload: boolean, enabled = true) {
  const [updateReady, setUpdateReady] = useState(false);
  const canReloadRef = useRef(canReload);
  canReloadRef.current = canReload;

  const reload = useCallback(() => location.reload(), []);

  useEffect(() => {
    if (import.meta.env.DEV || !enabled) return;
    const current = entryScript(document);
    if (!current) return;

    let checking = false;
    async function check(returning: boolean) {
      if (checking || !navigator.onLine) return;
      checking = true;
      try {
        const latest = await deployedEntryScript();
        if (latest && latest !== current) {
          if (returning && canReloadRef.current) location.reload();
          else setUpdateReady(true);
        }
      } catch {
        /* offline or blocked: try again later */
      } finally {
        checking = false;
      }
    }

    const onVisible = () => document.visibilityState === 'visible' && check(true);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => document.visibilityState === 'visible' && check(false), CHECK_EVERY_MS);
    check(true);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [enabled]);

  return { updateReady, reload };
}
