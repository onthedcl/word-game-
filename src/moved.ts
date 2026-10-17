// Lettertown moved to dpiyf.com. The copy of the game at the old address (built with
// VITE_MOVED_TO) sends each player to the new one, bringing this device's game data along,
// but only once the new address really is serving the game: until then, or if it can't be
// reached, the game just carries on here. See acceptCarriedData() for the other end.
const MOVED_TO = (import.meta.env.VITE_MOVED_TO as string | undefined) || '';

/** This device's game data, for the link (recent days' progress only; older boards are over). */
function carriedData(): Record<string, string> {
  const data: Record<string, string> = {};
  try {
    const cutoff = new Date(Date.now() - 4 * 864e5).toISOString().slice(0, 10);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('hexicon:') || k.startsWith('hexicon:known:')) continue;
      const day = /^hexicon:(daily|caught-up):(\d{4}-\d{2}-\d{2})/.exec(k);
      if (day && day[2] < cutoff) continue;
      data[k] = localStorage.getItem(k) ?? '';
    }
  } catch {
    /* no storage: nothing to bring */
  }
  return data;
}

export function moveIfReady(): void {
  if (!MOVED_TO) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  // Only our own server answers this (a parked or half-set-up domain can't), and only to this page.
  fetch(`${MOVED_TO}/moved.json`, { cache: 'no-store', signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((ok: { lettertown?: boolean } | null) => {
      if (!ok?.lettertown) return;
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      const path = location.pathname.startsWith(base) ? location.pathname.slice(base.length) || '/' : '/';
      const data = carriedData();
      const tail = Object.keys(data).length
        ? `#carry=${encodeURIComponent(JSON.stringify({ v: 1, data, hash: location.hash }))}`
        : location.hash;
      location.replace(`${MOVED_TO}${path}${location.search}${tail}`);
    })
    .catch(() => {
      /* not ready or unreachable: play on here */
    })
    .finally(() => clearTimeout(timer));
}
