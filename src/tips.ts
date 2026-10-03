// The tip jar: a quiet link shown at good moments (a high rank today, the podium) and in How to
// play. Never a popup. Websites only: inside the iPhone app Apple requires its own in-app
// purchase for tips, so the link is hidden there until that's built.
import { isAppPreview, isNativeApp } from './native';

const url = (import.meta.env.VITE_TIP_URL as string | undefined) || '';

/** Where the tip link goes, or null when there's no tip jar (or inside the app). */
export const tipUrl: string | null = isNativeApp ? null : url || (isAppPreview ? '#tip-jar-preview' : null);
