// Signing in (Firebase Authentication): Apple, Google or a one-tap email link. The Firebase code
// is only downloaded when someone actually signs in, so the game itself stays light.
import type { Auth } from 'firebase/auth';
import { isNativeApp } from './native';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** Sign-in is offered once a Firebase project is configured (the iPhone app gets native sign-in later). */
export const signInAvailable = !!config.apiKey && !isNativeApp;
/** Sign in with Apple needs the Apple Developer account; it's switched on separately. */
export const appleAvailable = signInAvailable && import.meta.env.VITE_SIGN_IN_APPLE === '1';

const EMAIL_KEY = 'hexicon:signin-email';

type AuthModule = typeof import('firebase/auth');
let loaded: { auth: Auth; m: AuthModule } | null = null;
let authPromise: Promise<Auth> | null = null;
async function auth(): Promise<Auth> {
  authPromise ??= (async () => {
    const [{ initializeApp }, m] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    const a = m.getAuth(initializeApp(config));
    loaded = { auth: a, m };
    return a;
  })();
  return authPromise;
}

/** Load sign-in ahead of the tap (Safari only allows a sign-in popup opened right at the tap). */
export function preloadSignIn(): void {
  if (signInAvailable) auth().catch(() => {});
}

/**
 * A popup (opened straight from the tap) works in browsers, phones included; Safari's privacy
 * rules break Firebase's full-page redirect there. Home-screen apps can't open popups, so they
 * redirect (the email link always works as a fallback).
 */
const useRedirect = () => matchMedia('(display-mode: standalone)').matches;

export type Provider = 'google' | 'apple';

/** Sign in with Google or Apple. Resolves with an ID token, or null if the page is redirecting. */
export async function signInWith(provider: Provider): Promise<string | null> {
  // Already loaded: nothing is awaited before the popup opens, so it counts as part of the tap.
  const { auth: a, m } = loaded ?? { auth: await auth(), m: await import('firebase/auth') };
  const p = provider === 'google' ? new m.GoogleAuthProvider() : new m.OAuthProvider('apple.com');
  if (provider === 'apple') (p as InstanceType<typeof m.OAuthProvider>).addScope('email');
  if (useRedirect()) {
    sessionStorage.setItem('hexicon:signin-redirect', '1');
    await m.signInWithRedirect(a, p);
    return null;
  }
  const result = await m.signInWithPopup(a, p);
  return result.user.getIdToken();
}

/** Email a one-tap sign-in link that comes back to this page. */
export async function sendEmailLink(email: string): Promise<void> {
  const a = await auth();
  const { sendSignInLinkToEmail } = await import('firebase/auth');
  const url = new URL(location.href);
  url.hash = '';
  await sendSignInLinkToEmail(a, email, { url: url.toString(), handleCodeInApp: true });
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    /* they'll be asked for it when they come back */
  }
}

/** True when this page was opened from a sign-in email or is coming back from a redirect. */
export function returningFromSignIn(): boolean {
  const q = new URLSearchParams(location.search);
  return (q.get('mode') === 'signIn' && q.has('oobCode')) || sessionStorage.getItem('hexicon:signin-redirect') === '1';
}

/**
 * Finish a sign-in that left the page (email link or redirect). Returns an ID token, or null if
 * there was nothing to finish. `askEmail` is used when the link was opened on another device.
 */
export async function finishSignIn(askEmail: () => string | null): Promise<string | null> {
  if (!signInAvailable) return null;
  const a = await auth();
  const m = await import('firebase/auth');
  if (m.isSignInWithEmailLink(a, location.href)) {
    let email: string | null = null;
    try {
      email = localStorage.getItem(EMAIL_KEY);
    } catch {
      /* ask */
    }
    email ??= askEmail();
    if (!email) return null;
    const result = await m.signInWithEmailLink(a, email, location.href);
    try {
      localStorage.removeItem(EMAIL_KEY);
    } catch {
      /* fine */
    }
    // Tidy the address so a reload doesn't try the used link again.
    history.replaceState(history.state, '', location.pathname + location.hash);
    return result.user.getIdToken();
  }
  sessionStorage.removeItem('hexicon:signin-redirect');
  const result = await m.getRedirectResult(a);
  return result ? result.user.getIdToken() : null;
}

export async function signOutAccount(): Promise<void> {
  if (!signInAvailable) return;
  const a = await auth();
  const { signOut } = await import('firebase/auth');
  await signOut(a);
}

/** Remove the sign-in itself too (Apple requires that deleting your data deletes the account). */
export async function deleteSignIn(): Promise<void> {
  if (!signInAvailable) return;
  const a = await auth();
  await a.authStateReady();
  try {
    await a.currentUser?.delete();
  } catch {
    // Firebase asks for a recent sign-in before deleting; signing out still unlinks this device,
    // and the server has already forgotten the account.
    const { signOut } = await import('firebase/auth');
    await signOut(a);
  }
}
