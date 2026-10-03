import { useEffect, useState } from 'react';
import { appleAvailable, preloadSignIn, sendEmailLink, signInWith, type Provider } from '../auth';

interface Props {
  /** A sign-in finished in place (popup): hand its token over. */
  onToken(idToken: string): Promise<void>;
}

/** Continue with Apple, Google or a one-tap email link. */
export function SignIn({ onToken }: Props) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(preloadSignIn, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      // Closing the sign-in window isn't an error worth showing.
      if (!/popup-closed|cancelled-popup|user-cancelled/.test(code)) {
        setError(err instanceof Error && !code ? err.message : 'Couldn’t sign in. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const provider = (p: Provider) =>
    run(async () => {
      const token = await signInWith(p);
      if (token) await onToken(token); // null: the page is moving to the sign-in screen
    });

  const btn = 'flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 font-semibold disabled:opacity-50';
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Save your name, scores and streak to an account, so you can play on any device and nobody else can use your
        name. We never post anything or send you emails, apart from sign-in links.
      </p>
      {appleAvailable && (
        <button type="button" disabled={busy} onClick={() => provider('apple')} className={`${btn} border-ink bg-ink text-bg`}>
           Continue with Apple
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => provider('google')} className={`${btn} border-line bg-surface`}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8h-4v3.1A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z" />
        </svg>
        Continue with Google
      </button>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      {sent ? (
        <p className="rounded-lg bg-bg p-3 text-sm">
          Check <b>{sent}</b> for a sign-in link and tap it on this device. (It can take a minute; check spam too.)
        </p>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const to = email.trim();
            run(async () => {
              await sendEmailLink(to);
              setSent(to);
            });
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            aria-label="Email"
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-base"
          />
          <button type="submit" disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())} className="rounded-lg bg-ink px-3 py-2 font-semibold text-bg disabled:opacity-50">
            Email me a link
          </button>
        </form>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
