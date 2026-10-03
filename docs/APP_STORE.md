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

**Legal and safety (on the `app-store` branch)**
- [x] Terms of Use with a zero-tolerance clause and Apple's required EULA terms: `public/terms.html`
- [x] App-only "I agree" screen on first launch (the website doesn't show it)
- [x] App-only: chat only in private, invite-only rooms (Apple 1.2: no chat between strangers)
- [x] Privacy policy covers codes, wrong tries, kept rough location; links to the Terms
- [x] Owner tools to act on reports within 24 hours (Moderate workflow: rename, block, message, look up)

**The store listing**
- [x] Name, subtitle, description, keywords, age rating, privacy answers, review notes:
      `docs/app-store/LISTING.md`
- [x] Screenshots at both required iPhone sizes: `docs/app-store/screenshots/`

## How the website stays safe

App work lives on the **`app-store` branch**. The website only publishes from `main`, so nothing here reaches
players until it's merged, and the app-only parts (Terms screen, private-only chat) switch on only inside the
iPhone app, so merging later still leaves the website the same.

## Decisions made
- **Seller: an LLC** (protects you personally; the store shows the LLC as the seller)
- **Free**, no ads, no purchases
- **Chat in the app: private rooms only**
- **Key tile restyled**: dark plum with light text and a shimmer; purple and green premium tiles (no more gold centre tile)

## Your steps

1. **Form an LLC** in your state (online, usually $50–$500 and a few days; a registered-agent service can be
   your public address so your home address stays private). Then:
   - Get a free **EIN** from the IRS (irs.gov, 10 minutes online).
   - Open a business bank account (not needed for a free app, but keeps things separate).
   - Get a free **D-U-N-S number** for the LLC (Apple's lookup page: developer.apple.com/enroll/duns-lookup).
     This can take up to a week or two.
2. **Get a support email** on a domain (e.g. support@yourdomain) for the store listing and Terms.
3. **Trademark check** on "DPIYF Lettertown": search tmsearch.uspto.gov (class 9 and 41) and the App Store.
   A quick web search found no app or game called "Lettertown". Optional: file your own trademark later
   (about $350 per class).
4. **Join the Apple Developer Program as the LLC** ($99/year) at developer.apple.com/programs/enroll.
5. **Register the bundle ID** `com.dpiyf.lettertown` (Certificates, Identifiers & Profiles → Identifiers).
6. **Create the app** in App Store Connect: name "DPIYF Lettertown", SKU `lettertown`, then paste everything
   from `docs/app-store/LISTING.md` and upload the screenshots.
7. **Create an App Store Connect API key** (Users and Access → Integrations → App Store Connect API, role
   App Manager) and add four GitHub secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the whole .p8 file),
   `APPLE_TEAM_ID`.
8. **Upload a build**: Actions → **iOS release (TestFlight)** → Run workflow. No Mac needed.
9. **TestFlight**: add yourself and friends as testers; play for a few days.
10. **Submit for review** with the review notes from `LISTING.md`.

## Before submitting
- Merge `app-store` into `main` (I'll check the website is unchanged first).
- **Rerolled boards** (`src/engine/rerolls.ts`) only reach the app with an app update, since the app bundles its
  files. Avoid rerolls once the app is out, or ship an update.
- Re-take the screenshots after the key tile restyle.
