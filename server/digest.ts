// Groups the owner's "someone played" pings into one summary, sent about once an
// hour instead of a ping per player.
export type DigestEvent =
  | { kind: 'new'; who?: string; place?: string; today: number }
  | { kind: 'back'; who?: string; days: number; place?: string; today: number }
  | { kind: 'joined'; who: string }
  | { kind: 'renamed'; from: string; who: string }
  | { kind: 'device'; who: string }
  | { kind: 'blitz'; who: string; score: number; best: boolean }
  | { kind: 'allwords'; who: string; words: number; score: number };

export interface Notification {
  title: string;
  message: string;
  tags?: string[];
  /** Structured form of the ping, for the digest. */
  event?: DigestEvent;
  /** Send right away instead of waiting for the digest (e.g. a reported name). */
  urgent?: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "NYC ×3, Denver, CO" — most common places first. */
function places(list: (string | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const raw of list) {
    const p = raw?.replace(/^🇺🇸\s*/u, ''); // US flags on every place are just noise
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => (n > 1 ? `${p} ×${n}` : p))
    .join(', ');
}

/** One notification summing up a batch of pings, or null if there's nothing to say. */
export function buildDigest(batch: Notification[]): Notification | null {
  if (!batch.length) return null;
  if (batch.length === 1) return { title: batch[0].title, message: batch[0].message, tags: batch[0].tags };
  const events = batch.map((n) => n.event);
  const of = <K extends DigestEvent['kind']>(kind: K) =>
    events.filter((e): e is Extract<DigestEvent, { kind: K }> => e?.kind === kind);
  const lines: string[] = [];

  const stars = of('allwords');
  for (const e of stars) lines.push(`🏆 ${e.who} found all ${e.words} words (${e.score} pts)`);
  const fresh = of('new');
  if (fresh.length) {
    const named = fresh.flatMap((e) => (e.who ? [e.who] : []));
    const where = places(fresh.map((e) => e.place));
    lines.push(`🎉 ${plural(fresh.length, 'new player')}${where ? ` from ${where}` : ''}${named.length ? ` (${named.join(', ')})` : ''}`);
  }
  const back = of('back');
  if (back.length) {
    const named = back.flatMap((e) => (e.who ? [`${e.who} (day ${e.days})`] : []));
    const unnamed = back.length - named.length;
    lines.push(`👋 ${plural(back.length, 'returning player')}: ${[...named, ...(unnamed ? [`${unnamed} without a name`] : [])].join(', ')}`);
  }
  const joined = of('joined');
  if (joined.length) lines.push(`🏷️ New names: ${joined.map((e) => e.who).join(', ')}`);
  const blitz = of('blitz');
  if (blitz.length) {
    const top = new Map<string, number>();
    for (const e of blitz) top.set(e.who, Math.max(top.get(e.who) ?? 0, e.score));
    lines.push(`⚡ ${plural(blitz.length, 'Blitz game')}: ${[...top].map(([w, s]) => `${w} ${s}`).join(', ')}`);
  }
  for (const e of of('renamed')) lines.push(`✏️ ${e.from} is now ${e.who}`);
  const moved = of('device');
  if (moved.length) lines.push(`📱 Picked up on another device: ${[...new Set(moved.map((e) => e.who))].join(', ')}`);
  for (const n of batch) if (!n.event) lines.push(`${n.title}: ${n.message}`);

  const today = Math.max(0, ...[...fresh, ...back].map((e) => e.today));
  const title = today ? `Lettertown: ${plural(today, 'player')} today` : 'Lettertown update';
  return { title, message: lines.join('\n'), tags: stars.length ? ['trophy'] : ['bar_chart'] };
}
