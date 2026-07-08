# Playmist — Living Architecture Document

> **How to use this doc:** read top-to-bottom once to build a mental model, then use it as a map when you need to trace a specific flow. **Keep it alive:** whenever a feature ships, update the relevant section (or ask Claude to — "update ARCHITECTURE.md for the change we just made"). A stale architecture doc is worse than none.
>
> Last full review: **2026-07-08**

Playmist is a mobile gaming platform: one Android app containing a catalog of web-technology games, glued together by a shared identity, a credits economy, daily engagement loops, and a developer portal that lets external studios submit games. Two codebases:

| Codebase | Path | GitHub | What it is |
|---|---|---|---|
| **Backend** (`play_mist`) | `gaming_backend/play_mist` | `starxweb610/play_mist` | Node/Express monolith: mobile API, public website, developer portal, admin panel, MySQL, R2 storage |
| **Mobile app** (`gaming_app`) | `gaming_app` | `starxweb610/playmist_app` | React 18 + Vite web app wrapped in Capacitor 6 for Android, with custom Kotlin plugins for game playback |

---

## 1. System overview

```
                        ┌─────────────────────────────────────────────┐
                        │                PRODUCTION VPS               │
   Android app          │  (Ubuntu · ssh cgpixels-vps · 69.62.75.88)  │
  ┌────────────┐        │                                             │
  │ React UI   │ HTTPS  │  nginx (80/443, playmist.app)               │
  │ Capacitor  ├────────┼──► pm2 app "playmist" · Node/Express :3798  │
  │ Kotlin     │        │        │            │                       │
  │ plugins    │        │        ▼            ▼                       │
  └─────┬──────┘        │   MySQL 8        cron (deploy user)         │
        │               │  playmist_db      hourly smoke monitor      │
        │  game ZIPs,   └─────────┬───────────────────────────────────┘
        │  thumbnails             │ S3 API
        ▼                         ▼
  ┌──────────────────────────────────────────┐     External services:
  │ Cloudflare R2 bucket "playmist" (public) │     · Firebase FCM (push)
  │  games/ images/ developers/              │     · AdMob (interstitial + rewarded SSV)
  │  developer-submissions/ -previews/       │     · Google Play Games Services (identity)
  │  playmist_data_backup/ (DB dumps)        │     · Hostinger SMTP (support@playmist.app)
  └──────────────────────────────────────────┘
```

The backend is a **single Express process** serving four distinct surfaces (§3). The app is a **single-page React app** rendered inside an Android WebView; games themselves are separate WebGL builds downloaded from R2 and served locally on the device (§6.4).

---

## 2. Production topology & environments

- **Domain:** `https://playmist.app` → nginx → `localhost:3798`.
- **Process:** pm2 app **`playmist`** running as the **`deploy`** user in `/var/www/play_mist`, tracking `origin/main` of `github.com/starxweb610/play_mist`.
- **Database:** MySQL 8.0, prod DB name **`playmist_db`** (local dev DB is `playmist` — the name comes from `.env`).
- **Storage:** one Cloudflare R2 bucket `playmist`, publicly readable via `R2_PUBLIC_URL` (a `pub-….r2.dev` URL). All game builds, thumbnails, screenshots, and DB backups live here (backups use random URL suffixes since the bucket is public).
- **Local dev:** `npm run dev` (nodemon) on port `3002`; the app's Vite dev server points at it via `VITE_DEV_HOST`.

---

## 3. Backend: the four surfaces

Everything routes through `server.js`, which mounts four routers. Knowing which surface you're in tells you the auth model and where to find the code.

| Surface | Mount | Router | Controllers | Auth | Consumers |
|---|---|---|---|---|---|
| **Mobile API** | `/api` (+`/api/v1`) | `routes/api.js` | `controllers/api/*` | JWT Bearer (`middleware/auth.js`) | Android app |
| **Public website** | `/` | `routes/index.js` | `controllers/publicController.js` | none | visitors, SEO |
| **Developer portal** | `/developer` | `routes/developer.js` | `controllers/developer/*` | session (`middleware/developerAuth.js`) | external game studios |
| **Admin panel** | `/sitehandler` | `routes/sitehandler.js` | `controllers/sitehandler/*` | session (admins table) | you |

**Boot sequence** (`server.js`): load `.env` → register crash handlers (append to `crash.log`, process keeps running) → helmet/CORS/sessions/flash/static → mount the four routers → `runMigrations()` from `utils/migrate.js` (all idempotent `CREATE TABLE IF NOT EXISTS` / add-column-if-missing — **restarting the app IS the migration step**) → `listen(3798)` → start the daily DB backup scheduler (`utils/backupScheduler.js`).

**Directory map:**

```
server.js               boot + middleware + router mounts
routes/                 api.js · index.js · developer.js · sitehandler.js
controllers/
  api/                  mobile API: authApi, gamesApi, streakApi, challengeApi,
                        dailyPickApi, achievementsApi, adsApi, analyticsApi,
                        notificationsApi, ticketsApi
  developer/            portal: auth, dashboard, projects, submissions, knowledge…
  sitehandler/          admin: games, users, developers, submissions, tickets,
                        analytics, notifications, genres/tags, settings…
  publicController.js   website pages
middleware/             auth.js (JWT verify) · developerAuth.js (session gate)
config/                 database.js (mysql2 pool) · r2.js (S3 client + helpers)
                        · upload.js (multer) · schema.sql
utils/                  achievements.js (XP/levels/grants) · gpgs.js (Google verify)
                        · fcm.js (push) · gameLive.js (publish announcements)
                        · mailer.js + emailTemplates.js · migrate.js · dates.js
                        · images.js · format.js · backupScheduler.js
scripts/                deploy.sh · smoke-test.js · smoke-monitor.js · backup-db.js
                        · sync-db.js · create-admin.js · check-db.js
views/                  EJS: site pages, developer portal, sitehandler admin
db/playmist.sql         ⚠ historical snapshot — the live schema is defined by
                        utils/migrate.js + /api/health migrations, not this file
```

---

## 4. Identity, auth & the database

### 4.1 Player identity (mobile app users)

- **Registration is username-only** (`POST /api/v1/auth/register`) — no password, no email. The app auto-generates/asks for a handle on first run. Response includes a 1h **access token** and 7d **refresh token** (JWT, secrets in `.env`).
- **Durable identity via Google Play Games** (`POST /api/v1/auth/gpgs`): the app exchanges a PGS server auth code; `utils/gpgs.js` verifies it with Google and anchors the account to `gpgs_player_id`, so users survive reinstalls/device changes. (Built June 2026; needs Play Console OAuth config to be fully live.)
- **Web QR pairing** (`/auth/web-link/*`): a browser requests a short-lived code, shows a QR; the phone app scans and approves it; the browser polls until it receives the same user's tokens.
- A dead refresh token (4xx) means "re-register"; network/5xx means "keep session, retry" — the app distinguishes these deliberately.

### 4.2 Developer & admin identity

Classic email+password with bcrypt, stored server-side in express-session. Developers verify email via a code (`utils/mailer.js` → Hostinger SMTP). Admins are created via `scripts/create-admin.js`. Developers can be banned by admins.

### 4.3 Database tables (grouped by purpose)

| Group | Tables | Notes |
|---|---|---|
| Players | `users` | username, email stub, `credits` (default 1000), `xp`, `level`, `current_streak`, `longest_streak`, `last_streak_date`, avatar, `gpgs_player_id` |
| Economy | `credit_transactions` | every credit movement; `source` ∈ game/ad/streak/achievement/challenge/welcome/other; negative `credits_used` = credits granted |
| Catalog | `games`, `genres`, `tags`, `game_tags`, `game_screenshots`, `game_ratings` | `games.type` ∈ webgl (mini) / premium; `credits_cost`, `zip_url`, `size_bytes` auto-computed from the uploaded ZIP |
| Engagement | `daily_picks`, `daily_challenges`, `user_challenge_completions`, `achievements`, `user_achievements` | challenge auto-generated per weekday; achievements seeded in `/api/health` |
| Developers | `developers`, developer games/submissions, knowledge notes | submission lifecycle in §5.3 |
| Comms | notifications, push tokens, `tickets`, `ticket_replies`, `feedbacks`, `newsletter_signups` | |
| Analytics | `analytics_app` (app opens), `analytics_games` (game plays) | play counts and DAU derive from these |

---

## 5. Backend: core flows

### 5.1 The daily engagement loop (why users come back)

1. **App open** → `POST /api/analytics/app-open` (DAU) and `POST /api/v1/user/daily-checkin` (idempotent per day).
2. **Check-in** (`streakApi.js`) pays **50 credits + 30 XP**, multiplied at streak milestones: ×1.5 at 3 days, ×2 at 7, ×4 at 30. Grants streak achievements. Missing a day resets `current_streak`.
3. **Daily challenge** (`challengeApi.js`): auto-created per weekday from 7 templates ("play 2 mini games", "play 1 premium + 1 mini"…). Progress is computed from `credit_transactions` with `source='game'` — i.e. real game launches. Claim pays 100–250 credits + XP. *Deliberately cross-game: it routes players between titles.*
4. **Daily pick** (`dailyPickApi.js`): admin-curated free game of the day; `deductCredits` consults `isTodaysDailyPick()` server-side and charges 0.

### 5.2 Game launch & the credits economy

`POST /api/v1/user/deduct-credits { gameId }` (`authApi.deductCredits`) is the heart of the platform:

1. Look up the game's cost (`credits_cost`, defaulting to 25 for premium / 5 otherwise); override to 0 if it's today's daily pick.
2. **Atomic conditional UPDATE** (`WHERE credits >= cost`) prevents double-spend; failure returns 400 "Insufficient credits" with the balance.
3. Insert a `credit_transactions` row (`source='game'`).
4. Grant play-count achievements (first_game, games_5, games_25, first_premium, daily_pick) — each pays XP + credits *in the same response* (`newAchievements[]`, camelCase fields like `creditsReward`).
5. Return `{ success, balance, cost, freeToday, xp, level, newAchievements }`.

**Faucets & sinks:** credits enter via welcome bonus (1000), streaks, challenges, achievements, and rewarded ads; they exit only via game launches. XP has no sink — every 500 XP = 1 level (`utils/achievements.js`).

**Rewarded ads** (`adsApi.js`): AdMob **server-side verification** — Google's servers call `GET /api/v1/ads/ssv-callback` with a signature; `ad_transaction_id` is UNIQUE for idempotency. The client never grants itself credits.

### 5.3 Developer submission pipeline (the supply side)

```
signup + email verification → create project → upload game ZIP
   → ZIP stored in R2 developer-submissions/ → status: pending review
   → admin reviews in /sitehandler (preview build in developer-previews/)
   → approve: ZIP extracted/published to games/ in R2, games row created/updated,
     size/version auto-computed → status emails to the developer at every step
   → game goes live → push notification + email announce (utils/gameLive.js)
```

Rejections carry a reason (emailed). Admins can ban developers. Knowledge-sphere notes written by developers also go through admin approval. Real stats flow back: plays from `analytics_games`, rating from `game_ratings`, size from the ZIP.

### 5.4 Ratings, notifications, support

- **Ratings:** the app prompts every 6th launch of a game; `POST /api/v1/games/:id/rate` (1–5, one per user per game); averages surface in the catalog and to developers.
- **Push:** app registers its FCM token (`POST /api/v1/push-token`); `utils/fcm.js` + `firebase-service-account.json` send pushes (e.g. new game live); `GET /api/v1/notifications` is the in-app inbox.
- **Support:** `POST /api/tickets` from the app; admins reply in `/sitehandler`; `GET /api/v1/user/tickets` shows the thread.

---

## 6. Mobile app (`gaming_app`)

### 6.1 Stack

React 18 + Vite, **no router library and no state library** — navigation is plain conditional rendering driven by one context. Capacitor 6 wraps the build (`dist/`) into an Android app (`com.playmist.app`), with three **custom Kotlin plugins** in `android/app/src/main/java/com/playmist/app/`:

| Plugin | Purpose |
|---|---|
| `WebGLPlayerPlugin` | manages downloaded game files; starts a **local HTTP server on :8765** serving an extracted game build |
| `GameViewerPlugin` (+ `GameViewerActivity`) | opens a fullscreen native WebView pointed at the local server, with orientation lock |
| `GamesSignInPlugin` | Google Play Games sign-in → server auth code for §4.1 |

### 6.2 Screen & state model

`src/context/AppContext.jsx` (~1200 lines) is the single source of truth: session/tokens, user profile + credits, games catalog, downloads, modals, toasts. `App.jsx` renders by precedence:

```
SplashScreen → SetupUserScreen (auto-registration) → OnboardingScreen
  → GamePlayerScreen (if a game is active, fullscreen)
  → active tab: Dashboard | PremiumTab | MiniTab | MyGamesTab   (BottomNav)
      + overlay: GameDetailScreen
      + modals: profile, wallet, search, support, launch-confirm, web-link,
        rate-game, download, out-of-credits, no-internet, welcome-bonus,
        transactions-history, see-all lists
      + achievement-unlock banner, Toast
```

First run: auto-register a username → welcome-bonus modal (unless the account was *recovered* via PGS) → app-open analytics + daily check-in fire on every open thereafter.

### 6.3 Services (`src/services/`)

| File | Role |
|---|---|
| `api.js` | every backend call; `API_BASE` from `VITE_API_BASE_NATIVE`/`_WEB` (prod: `https://playmist.app`); catalog cached in localStorage for 24h; images in a CacheStorage bucket |
| `storage.js` | Capacitor Preferences on device / localStorage on web (tokens, flags) |
| `ads.js` | AdMob: interstitial every **2nd** free-game launch; rewarded ads for credits |
| `gpgs.js` | Play Games sign-in wrapper |
| `pushNotifications.js` | FCM token registration + permission |
| `webLink.js` | QR pairing client (§4.1) |

### 6.4 Game launch flow (the critical path, `components/LaunchModal.jsx`)

```
tap Play → confirm modal (skippable after first success)
  → deductCredits() server-side  ── insufficient → out-of-credits paywall
  │                              └─ network fail → no-internet screen
  → free game? maybe show interstitial ad (every 2nd launch)
  → downloaded already?
      no  → download ZIP from R2 (g.zipurl) with progress screen, store version
      yes → if online, compare version; re-download if stale
  → native: WebGLPlayer serves the extracted build at localhost:8765,
    orientation locked, GameViewer opens fullscreen WebView
    (web dev fallback: built-in canvas Snake in GamePlayerScreen)
  → log analytics game-play · add to library · every 6th launch queues
    the rating prompt for app resume
```

Key invariant: **there is no offline entitlement** — a launch always requires a live server-side deduction.

---

## 7. Operations (how this stays alive)

### 7.1 Deploy — one command, always the same steps

```
ssh cgpixels-vps 'bash /var/www/play_mist/scripts/deploy.sh'
```

`scripts/deploy.sh`: lock → show incoming commits → **DB backup to R2 (abort if it fails)** → tag current commit `deploy-YYYYMMDD-HHMMSS` (rollback target, last 15 kept) → `git reset --hard origin/main` → `npm install` only if the lockfile changed → `pm2 restart playmist` → wait for `/api/health` → **run the full smoke test** → on any failure, **auto-rollback** to the tag and re-verify. Log: `/var/www/play_mist/deploy.log`. Rollback path was rehearsed live 2026-07-08 (≈64s outage worst-case).

⚠ deploy.sh runs from a self-copy, so **changes to deploy.sh itself take effect on the *next* deploy**.

### 7.2 Verification & monitoring

- **Smoke test** (`scripts/smoke-test.js`, `npm run smoke-test`): 14 checks across every critical path — health (parses `body.status`; note `/api/health` returns HTTP 200 even on DB errors), site pages, register → refresh → catalog → profile → check-in → daily pick/challenge → **credit deduction with exact balance math** → thumbnail from R2 → notifications. Uses a throwaway `smoketest_*` user, deleted afterwards. On the VPS it targets `https://playmist.app` (full nginx/TLS path).
- **Hourly monitor** (`scripts/smoke-monitor.js`, cron `17 * * * *` in the deploy user's crontab): runs the smoke test; a failure is confirmed by a 30s-later retry, then emailed to `ALERT_EMAIL` (default i.motionveda@gmail.com) with one recovery email when it passes again. Log: `smoke-monitor.log`.

### 7.3 Backups & restore

- **Automatic:** daily 03:30 server time + catch-up on every restart if the newest backup is >20h old (`utils/backupScheduler.js` → `scripts/backup-db.js`). Gzipped `mysqldump` → R2 `playmist_data_backup/`, 30-day retention. Every deploy also snapshots (step 3 above).
- **Restore:** download the dump from R2 (Cloudflare dashboard → R2 → playmist → playmist_data_backup), then on the VPS: `gunzip < file.sql.gz | mysql -u root -p playmist_db`.

### 7.4 Logs & artifacts on the VPS (`/var/www/play_mist`)

| File | What |
|---|---|
| `deploy.log` | every deploy, timestamped, incl. smoke results |
| `smoke-monitor.log` | hourly monitor history |
| `crash.log` | uncaught exceptions/rejections from the app process |
| `play_log.txt` | app runtime log (tracked in git but treated as disposable) |
| `pm2 logs playmist` | live stdout/stderr |

### 7.5 Environment variables (names only — values live in `.env` on each machine)

- **Server:** `PORT`, `NODE_ENV`, `APP_NAME`, `BASE_URL` (prod: `https://playmist.app`; used by the smoke test)
- **DB:** `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- **Auth:** `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`
- **R2:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`
- **Email:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- **Ops:** `ALERT_EMAIL`, `DB_BACKUP_ENABLED`, `DB_BACKUP_RETENTION_DAYS`, `MYSQLDUMP_PATH`
- **Push:** `firebase-service-account.json` (file, never committed)
- **App (Vite, build-time):** `VITE_DEV_HOST`, `VITE_API_BASE_NATIVE`, `VITE_API_BASE_WEB`, `VITE_ADMOB_INTERSTITIAL_ID`, `VITE_ADMOB_REWARDED_ID`

---

## 8. Reading guide: "I want to understand / change X"

| I want to… | Start here |
|---|---|
| change what a game costs / launch behavior | `controllers/api/authApi.js` (`deductCredits`) + app `components/LaunchModal.jsx` |
| tune streak / challenge / achievement rewards | `controllers/api/streakApi.js`, `challengeApi.js`, `utils/achievements.js` (+ seeds in `routes/api.js` health) |
| add/modify a mobile API endpoint | `routes/api.js` → controller in `controllers/api/` → client call in app `src/services/api.js` |
| change the app's screens/flow | `src/App.jsx` (render precedence) + `src/context/AppContext.jsx` (state) |
| touch the developer portal or admin panel | `routes/developer.js` / `routes/sitehandler.js` + matching controllers + `views/` |
| change the DB schema | add an idempotent step in `utils/migrate.js`; restart applies it (never edit `db/playmist.sql` and expect effect) |
| change deploys / monitoring / backups | `scripts/deploy.sh`, `scripts/smoke-test.js`, `scripts/smoke-monitor.js`, `scripts/backup-db.js` — see §7 gotchas first |
