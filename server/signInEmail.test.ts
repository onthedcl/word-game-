import { beforeEach, describe, expect, it } from 'vitest';
import { DAILY_EMAILS, sendSignInEmail, signInEmail, type Mailer } from './signInEmail';
import type { Deps } from './leaderboard';

let data: Map<string, unknown>;
let deps: Deps;
let sent: { to: string; subject: string; html: string }[];
let clock: number;
const mailer: Mailer = {
  signInLink: async (email, back) => `https://example.firebaseapp.com/__/auth/action?mode=signIn&oobCode=x&e=${email}&continueUrl=${back}`,
  send: async (m) => void sent.push(m),
};
beforeEach(() => {
  data = new Map();
  sent = [];
  clock = Date.parse('2026-10-18T15:00:00Z');
  deps = {
    kv: {
      get: async (key) => structuredClone(data.get(key) ?? null),
      setJSON: async (key, value) => void (value === null ? data.delete(key) : data.set(key, structuredClone(value))),
      list: async () => ({ blobs: [] }),
    },
    answers: async () => null,
    blitzSeeds: async () => [],
    now: () => clock,
    randomId: () => 'id',
    random: () => 0,
  };
});

const send = (email: string, client = 'c1', continueUrl = 'https://dpiyf.com/') => sendSignInEmail(deps, mailer, { email, client, continueUrl });

describe('sign-in emails', () => {
  it('sends the designed email with the sign-in link', async () => {
    await send('Ann@Example.com');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('Ann@Example.com');
    expect(sent[0].subject).toContain('Lettertown');
    expect(sent[0].html).toContain('oobCode=x');
  });

  it('asks for Firebase’s email instead when not set up or the day’s allowance is used', async () => {
    await expect(sendSignInEmail(deps, undefined, { email: 'a@b.co', continueUrl: 'https://dpiyf.com/' })).rejects.toMatchObject({ status: 503 });
    data.set('sign-in-emails/2026-10-18', DAILY_EMAILS);
    await expect(send('a@b.co')).rejects.toMatchObject({ status: 503 });
  });

  it('turns down bad addresses and links leading anywhere but the game', async () => {
    await expect(send('not-an-email')).rejects.toMatchObject({ status: 400 });
    await expect(send('a@b.co', 'c1', 'https://evil.example/')).rejects.toMatchObject({ status: 400 });
    expect(sent).toHaveLength(0);
  });

  it('can’t be used to flood an inbox', async () => {
    await send('v@x.co', 'c1');
    await send('v@x.co', 'c2');
    await expect(send('v@x.co', 'c3')).rejects.toMatchObject({ status: 429 });
    clock += 61_000;
    await send('v@x.co', 'c4');
    expect(sent).toHaveLength(3);
  });

  it('keeps the link safe inside the email', () => {
    const { html } = signInEmail('https://x.example/?a=1&b="2"');
    expect(html).toContain('href="https://x.example/?a=1&amp;b=&quot;2&quot;"');
  });
});

describe('sign-in stats', () => {
  it('sum up the day in one line', async () => {
    const { describeSignIns } = await import('./signInStats');
    expect(describeSignIns({})).toBeNull();
    expect(describeSignIns({ google: 2, email: 1, returning: 1, sent: 3, failed: 1 })).toBe(
      '🔑 Sign-ins today: 3 new accounts (2 Google, 1 email) · 1 signed back in · 3 sign-in emails sent, ⚠️ 1 failed (Firebase\'s plain email went instead)',
    );
  });
});
