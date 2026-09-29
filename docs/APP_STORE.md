# Getting DPIYF Lettertown into the App Store

The iPhone app is a native shell (Capacitor) around the same game as the website. It
bundles the game files, uses the same leaderboard server, and adds native haptics, the
iOS share sheet and a daily 9 AM "new board" reminder. The website keeps running exactly
as before: app-only work lives in `ios/`, `capacitor.config.ts`, `src/native.ts` and `docs/`.

## Done in the repo

**In the game (live on the website too)**
- [x] No other games' trademarks in the rules, store text or project files
- [x] Privacy policy: https://onthedcl.github.io/word-game-/privacy.html, linked from
      **How to play → Privacy policy**
- [x] In-app account deletion: **Leaderboard → delete my data** (Guideline 5.1.1(v))
- [x] User-generated names (Guideline 1.2): offensive-word filter, **tap a name → Report /
      Hide this player**, reports ping the owner immediately, and the **Moderate** workflow
      (Actions tab) renames a name everywhere
- [x] Contact link (GitHub issues), credits for the word lists, CC BY-SA notice in `public/dict/LICENSE.txt`
- [x] Layout respects the iPhone notch and home bar (safe areas)

**The app project**
- [x] Capacitor iOS project in `ios/` (Swift Package Manager, no CocoaPods needed)
- [x] `npm run build:app` builds the game for the app and copies it into the Xcode project
- [x] Native haptics, share sheet, daily reminder notification (asked for after the first word)
- [x] App icon (1024×1024, opaque) and launch screen from the Lettertown board art
- [x] Leaderboard server accepts requests from the app (`capacitor://localhost`)
- [x] The website's "new version, tap to update" check is off in the app
- [x] **iOS build** workflow (Actions tab) compiles the app on a GitHub Mac on every app change

**The store listing**
- [x] Name, subtitle, description, keywords, age rating, privacy answers, review notes:
      `docs/app-store/LISTING.md`
- [x] Screenshots at both required iPhone sizes: `docs/app-store/screenshots/`

## Your steps

1. **Join the Apple Developer Program** ($99/year) at https://developer.apple.com/programs/enroll.
   Enrol as an individual (quickest) or as a company (needs a D-U-N-S number; the seller name
   shown in the store is the company's).
2. **Trademark check** on the store name ("DPIYF Lettertown"): search https://tmsearch.uspto.gov
   and the App Store. Closest existing brand found so far: *Letterland* (children's phonics).
3. **Confirm the artwork is yours to use** (the logo and board art you supplied).
4. **Register the bundle ID** in Certificates, Identifiers & Profiles → Identifiers → "+" →
   App IDs → App. Use `com.dpiyf.lettertown`, or tell me a different one and I'll update
   `capacitor.config.ts` and the Xcode project.
5. **Create the app** in App Store Connect (https://appstoreconnect.apple.com → Apps → "+"):
   pick the bundle ID, name "DPIYF Lettertown", primary language English, SKU `lettertown`.
   Paste everything from `docs/app-store/LISTING.md` and upload the screenshots.
6. **Get the build to Apple**. Either:
   - *With a Mac*: install Xcode, then `npm ci && npm run build:app && npx cap open ios`. In
     Xcode choose your team under Signing & Capabilities, run it on your iPhone, then
     Product → Archive → Distribute App → App Store Connect.
   - *Without a Mac*: create an App Store Connect API key (Users and Access → Integrations →
     App Store Connect API) and add it as GitHub secrets; I can then make the iOS workflow
     sign and upload builds for you.
7. **TestFlight**: once the build appears in App Store Connect, add yourself and a few friends
   as testers and play for a day or two.
8. **Submit for review** with the review notes from `LISTING.md`. Reviews usually take a day or two.

## Worth deciding before launch

- **Gold centre tile**: the required gold centre hexagon is the signature look of a well-known
  word game. Restyling the key tile (colour or shape) would lower the risk of a look-and-feel complaint.
- **Name protection**: names can currently be picked up on another device by typing them.
  An optional player-chosen code would stop others playing as you.
- **Rerolled boards** (`src/engine/rerolls.ts`) only reach the app with an app update, since
  the app bundles its files. Avoid rerolls once the app is out, or ship an update.
