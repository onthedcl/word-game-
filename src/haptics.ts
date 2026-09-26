// Light haptic feedback where supported (mostly Android browsers).
const vibrate = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
};

export const haptics = {
  tap: () => vibrate(8),
  error: () => vibrate([30, 40, 30]),
  success: () => vibrate(20),
  pangram: () => vibrate([20, 30, 20, 30, 60]),
};
