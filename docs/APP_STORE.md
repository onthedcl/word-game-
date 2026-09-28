# Getting DPIYF Lettertown into the App Store

The iPhone app is a native shell (Capacitor) around the same game as the website. It
bundles the game files, uses the same leaderboard server, and adds native haptics, the
iOS share sheet and a daily 9 AM "new board" reminder.

## Stage 1: in the game (done, live on the website too)

- [x] No other games' trademarks in the rules, store text or project files
- [x] Privacy policy: `public/privacy.html` (https://onthedcl.github.io/word-game-/privacy.html),
      linked from **How to play → Privacy policy**
- [x] In-app account deletion: **Leaderboard → delete my data** (Guideline 5.1.1(v))
- [x] User-generated names (Guideline 1.2): offensive-word filter on names, **tap a name →
      Report / Hide this player**, reports ping the owner immediately, and the **Moderate**
      workflow (Actions tab) renames a name everywhere
- [x] Contact link (GitHub issues) and credits for the word lists; CC BY-SA notice in `public/dict/LICENSE.txt`

## Stage 2: the app project (done in the repo)

- [x] Capacitor iOS project in `ios/` (Swift Package Manager, no CocoaPods needed)
- [x] `npm run build:app` builds the game for the app and copies it into the Xcode project
- [x] Native haptics, share sheet, daily reminder notification (asked for after the first word)
- [x] Leaderboard server accepts requests from the app (`capacitor://localhost`)
- [x] The website's "new version, tap to update" check is off in the app (updates come from the App Store)

## Stage 3: needs you (Apple account + a Mac)

1. **Apple Developer Program** ($99/year) at developer.apple.com, under your name or a company.
2. **Pick the bundle ID** (e.g. `com.dpiyf.lettertown`), register it in the developer
   portal, and set the same `appId` in `capacitor.config.ts`.
3. **Trademark check** on the store name ("Lettertown", and "DPIYF" if it's in the name):
   search https://tmsearch.uspto.gov and the App Store. The closest existing brand found
   so far is *Letterland* (children's phonics).
4. **Confirm the artwork is yours to use** (logo, board art, icon), and make a 1024×1024 app
   icon with no transparency.
5. On the Mac: `npm ci && npm run build:app && npx cap open ios`. In Xcode, set your team
   under Signing & Capabilities, add the app icon, and run it on your iPhone.
6. **App Store Connect**: create the app, then fill in:
   - Privacy policy URL: https://onthedcl.github.io/word-game-/privacy.html
   - App Privacy answers (suggested; data is not used for tracking):
     - *User ID* (leaderboard name and random player ID): App Functionality, linked to the user
     - *Gameplay Content* (words found, scores): App Functionality, linked to the user
     - *Coarse Location* (city/region from the connection): Analytics, not linked to the user's identity
   - Age rating questionnaire (no objectionable content; user-generated names are filtered and reportable)
   - Screenshots (6.9" and 6.5" iPhone), description, keywords, support URL (the GitHub issues link works)
7. **TestFlight**: Product → Archive → upload, invite friends to test, then submit for review.

## Worth deciding before launch

- **Gold centre tile**: the required gold centre hexagon is the signature look of a well-known
  word game. Restyling the key tile (colour or shape) would lower the risk of a look-and-feel complaint.
- **Name protection**: names can currently be picked up on another device by typing them.
  An optional player-chosen code would stop others playing as you.
- **Rerolled boards** (`src/engine/rerolls.ts`) only reach the app with an app update, since
  the app bundles its files. Avoid rerolls once the app is out, or ship an update.
