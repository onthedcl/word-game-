// Light haptic feedback: the Taptic Engine in the iPhone app, vibration in browsers that support it.
import { isNativeApp, nativeHaptic } from './native';

const vibrate = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
};

const web = {
  tap: () => vibrate(8),
  error: () => vibrate([30, 40, 30]),
  success: () => vibrate(20),
  pangram: () => vibrate([20, 30, 20, 30, 60]),
};

const app = {
  tap: () => void nativeHaptic('light'),
  error: () => void nativeHaptic('error'),
  success: () => void nativeHaptic('success'),
  pangram: () => void nativeHaptic('heavy'),
};

export const haptics = isNativeApp ? app : web;
