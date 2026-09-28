// Native iPhone app (Capacitor). The app bundles the same web build as the site,
// built with `npm run build:app`, and talks to the same leaderboard server.
// Change appId to the bundle ID registered in your Apple Developer account.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dpiyf.lettertown',
  appName: 'Lettertown',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#e0a526',
    },
  },
};

export default config;
