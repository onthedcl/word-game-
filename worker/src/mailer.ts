// The parts of sign-in emails that talk to Google and Resend. A Firebase service account (a
// Worker secret) lets the server ask Firebase for a sign-in link without sending Firebase's own
// email; Resend (another secret) sends ours.
import type { Mailer } from '../../server/signInEmail';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

const b64url = (bytes: Uint8Array | string) =>
  btoa(typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let token: { value: string; until: number } | null = null;

/** A Google access token for the service account (good for an hour; kept for 50 minutes). */
async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (token && token.until > now) return token.value;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google sign-in token (${res.status})`);
  const { access_token } = (await res.json()) as { access_token: string };
  token = { value: access_token, until: now + 50 * 60 };
  return access_token;
}

/** The service account from its secret, forgiving curly quotes and stray text around the braces. */
function readServiceAccount(raw: string): ServiceAccount | string {
  const text = raw.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let sa: Partial<ServiceAccount>;
  try {
    sa = JSON.parse(json) as Partial<ServiceAccount>;
  } catch {
    return 'The Firebase key isn’t complete JSON (paste the whole .json file, from { to })';
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) return 'The Firebase key is missing client_email, private_key or project_id';
  return sa as ServiceAccount;
}

/**
 * The mailer, or why there isn't one (the game then uses Firebase's own email): undefined when
 * the secrets aren't set, a reason when one can't be read.
 */
export function makeMailer(serviceAccountJson: string | undefined, resendKey: string | undefined): Mailer | string | undefined {
  if (!serviceAccountJson && !resendKey) return undefined;
  if (!resendKey) return 'The Resend key is missing';
  if (!serviceAccountJson) return 'The Firebase key is missing';
  if (!resendKey.trim().startsWith('re_')) return 'The Resend key doesn’t look right (it starts with re_)';
  const sa = readServiceAccount(serviceAccountJson);
  if (typeof sa === 'string') return sa;
  const key = resendKey.trim();
  return {
    async signInLink(email, continueUrl) {
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:sendOobCode`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email, continueUrl, canHandleCodeInApp: true, returnOobLink: true }),
      });
      if (!res.ok) throw new Error(`Sign-in link (${res.status})`);
      return ((await res.json()) as { oobLink: string }).oobLink;
    },
    async send({ to, subject, html, text }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'DPIYF Lettertown <hello@dpiyf.com>', reply_to: 'dpiyfsupport@gmail.com', to, subject, html, text }),
      });
      if (!res.ok) throw new Error(`Sending email (${res.status})`);
    },
  };
}
