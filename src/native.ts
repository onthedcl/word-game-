// Native iPhone app features (Capacitor). On the website these are no-ops or fall
// back to web APIs; the plugins are only loaded inside the app.
import { Capacitor } from '@capacitor/core';

export const isNativeApp = Capacitor.isNativePlatform();

type Impact = 'light' | 'medium' | 'heavy';

/** Taptic Engine feedback in the app (web browsers on iPhone can't vibrate). */
export async function nativeHaptic(kind: Impact | 'success' | 'error') {
  if (!isNativeApp) return;
  const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
  if (kind === 'success') return Haptics.notification({ type: NotificationType.Success });
  if (kind === 'error') return Haptics.notification({ type: NotificationType.Error });
  return Haptics.impact({ style: { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[kind] });
}

/** The system share sheet in the app. Returns false when not in the app. */
export async function nativeShare(text: string): Promise<boolean> {
  if (!isNativeApp) return false;
  const { Share } = await import('@capacitor/share');
  await Share.share({ text });
  return true;
}

const REMINDER_ID = 1;

/**
 * A daily "new board is ready" reminder at 9 AM local time. Asked for once, after
 * the player's first word, so the permission prompt makes sense.
 */
export async function scheduleDailyReminder() {
  if (!isNativeApp) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  let { display } = await LocalNotifications.checkPermissions();
  if (display === 'prompt' || display === 'prompt-with-rationale') display = (await LocalNotifications.requestPermissions()).display;
  if (display !== 'granted') return;
  const { notifications } = await LocalNotifications.getPending();
  if (notifications.some((n) => n.id === REMINDER_ID)) return;
  await LocalNotifications.schedule({
    notifications: [
      {
        id: REMINDER_ID,
        title: 'A new Lettertown board is ready',
        body: 'Can you find every word today?',
        schedule: { on: { hour: 9, minute: 0 }, allowWhileIdle: true },
      },
    ],
  });
}
