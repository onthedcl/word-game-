// Sign-in emails in Lettertown's own design. Firebase makes the one-time sign-in link; the game
// server wraps it in this email and sends it (through Resend). When that isn't set up, or the
// day's sending allowance is used up, the game falls back to Firebase's plain email.
import { ApiError, type Deps } from './leaderboard';
import { rateLimit } from './ratelimit';

export interface Mailer {
  /** Firebase's one-time sign-in link for this address, coming back to `continueUrl`. */
  signInLink(email: string, continueUrl: string): Promise<string>;
  send(mail: { to: string; subject: string; html: string; text: string }): Promise<void>;
}

/** Where a sign-in link may lead back to: the game, and its preview. */
const RETURN_TO = [/^https:\/\/dpiyf\.com\//, /^https:\/\/onthedcl\.github\.io\/word-game-\//];
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;
/** Resend's free plan sends 100 a day; past this the game uses Firebase's email instead. */
export const DAILY_EMAILS = 90;

const dayOf = (now: number) => new Date(now - 4 * 3600_000).toISOString().slice(0, 10);

/**
 * Email a sign-in link. Limited per connection and per address, so the server can't be used to
 * flood someone's inbox. Throws 503 when the game should send Firebase's email instead.
 */
export async function sendSignInEmail(deps: Deps, mailer: Mailer | string | undefined, body: Record<string, unknown>) {
  if (!mailer) throw new ApiError(503, 'Not set up');
  if (typeof mailer === 'string') throw new ApiError(503, mailer);
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const continueUrl = typeof body.continueUrl === 'string' ? body.continueUrl : '';
  if (!EMAIL.test(email)) throw new ApiError(400, 'That email doesn’t look right');
  if (!RETURN_TO.some((r) => r.test(continueUrl))) throw new ApiError(400, 'Bad return address');
  const now = deps.now();
  if (typeof body.client === 'string') rateLimit(`mail:c:${body.client}`, 3, now);
  rateLimit(`mail:e:${email.toLowerCase()}`, 2, now);
  const countKey = `sign-in-emails/${dayOf(now)}`;
  const sent = ((await deps.kv.get(countKey, { type: 'json' })) as number | null) ?? 0;
  if (sent >= DAILY_EMAILS) throw new ApiError(503, 'Daily allowance used');
  try {
    const link = await mailer.signInLink(email, continueUrl);
    await mailer.send({ to: email, ...signInEmail(link) });
  } catch (err) {
    // Only ever a service name and status code, e.g. "Sending email (403)". The game then sends
    // Firebase's email instead.
    throw new ApiError(502, err instanceof Error ? err.message : 'Email service');
  }
  await deps.kv.setJSON(countKey, sent + 1);
  return { ok: true };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const tile = (letter: string, key = false) =>
  `<td style="width:44px;height:48px;background:${key ? '#6a45b8' : '#efe9fa'};border-radius:12px;text-align:center;` +
  `font-size:22px;font-weight:900;color:${key ? '#ffffff' : '#1f1a2b'};${key ? 'box-shadow:0 0 0 3px #9b7fe6;' : ''}">${letter}</td>`;

/** The email itself: Lettertown's colors, a row of tiles spelling KEYS, one big button. */
export function signInEmail(link: string) {
  const href = esc(link);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only"><title>Your key to Lettertown</title></head>
<body style="margin:0;padding:0;background:#f8f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f1a2b;">
<span style="display:none;max-height:0;overflow:hidden;">Tap to sign in. Your words, streak and spot on the leaderboard are waiting.</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6fb;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;">
<tr><td style="background-color:#2c2050;background:linear-gradient(180deg,#3f2d6e,#1d1536);padding:28px 24px 24px;text-align:center;">
<div style="font-size:13px;font-weight:800;letter-spacing:.12em;color:#cbb8ff;">DPIYF</div>
<div style="font-size:34px;font-weight:900;color:#ffffff;line-height:1.1;">Lettertown</div>
<table role="presentation" cellpadding="0" cellspacing="6" align="center" style="margin-top:18px;"><tr>${tile('K')}${tile('E')}${tile('Y', true)}${tile('S')}</tr></table>
</td></tr>
<tr><td style="padding:28px 28px 8px;">
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;">Here’s your key to town 🗝️</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;">Tap below to move in. Your words, your streak and your spot on the leaderboard will be right where you left them.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<a href="${href}" style="display:inline-block;background:#6a45b8;color:#ffffff;text-decoration:none;font-weight:800;font-size:17px;padding:14px 28px;border-radius:12px;">Sign in to Lettertown</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6b6478;">The link works once. Open it on the device where you asked for it and you’ll be straight in.</p>
</td></tr>
<tr><td style="padding:20px 28px 28px;"><div style="border-top:1px solid #ece7f3;padding-top:16px;font-size:12px;line-height:1.5;color:#8b8496;">
Didn’t ask to sign in? Ignore this email and nothing happens: nobody gets in without the link.<br>
Questions: <a href="mailto:dpiyfsupport@gmail.com" style="color:#6a45b8;">dpiyfsupport@gmail.com</a> · <a href="https://dpiyf.com/" style="color:#6a45b8;">dpiyf.com</a>
</div></td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    'Here’s your key to Lettertown 🗝️',
    '',
    'Open this link to sign in. Your words, your streak and your spot on the leaderboard will be right where you left them:',
    link,
    '',
    'The link works once. Didn’t ask to sign in? Ignore this email and nothing happens.',
    'Questions: dpiyfsupport@gmail.com · https://dpiyf.com/',
  ].join('\n');
  return { subject: 'Your key to Lettertown 🗝️', html, text };
}
