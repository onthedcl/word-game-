import { describe, expect, it } from 'vitest';
import { inAppBrowser } from './auth';

describe('in-app browsers', () => {
  it('are recognized, so Google sign-in (which they block) isn’t offered', () => {
        expect(inAppBrowser('Mozilla/5.0 (iPhone) AppleWebKit Mobile/15E148 Instagram 300.0')).toBe(true);
    expect(inAppBrowser('Mozilla/5.0 (iPhone) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]')).toBe(true);
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) Chrome/120 Mobile')).toBe(true);
    expect(inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36')).toBe(false);
  });
});
