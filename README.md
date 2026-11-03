# ✒️ Open Waqf Signer (الموقّع)

> **Secure. Offline. Verifiable.**
> A privacy-first PDF signer for your browser and your Android phone.

<div align="center">
<a href="https://sign.open-waqf.org">
<img src="public/icons/icon-512.webp" alt="Logo" width="100" height="100" style="border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
</a>
</div>

Open Waqf Signer lets you sign PDF documents and **verify** signed ones, in your browser or in the Android app. It is
built on the principles of **Amanah** (Trust) and **Privacy**.

Unlike most free tools, **your documents are never uploaded**. Opening, signing, saving and checking all happen on your
device.

---

## 🌟 Key Features

### 🛡️ Security & Trust

* **Nothing is uploaded:** Documents are opened, signed and saved on your device. The only network request is the
  optional timestamp (below), which sends a fingerprint of the file, never the file.
* **File fingerprint (SHA-256):** When you save, the app computes a SHA-256 fingerprint of the exact file. If the
  receiver gets that fingerprint through a separate channel (for example a different message), Verify Mode tells them
  whether the file they hold is byte-for-byte the one you saved.
* **Signer record in the file:** The app writes a document ID and the signer history into the PDF metadata, so it
  recognises files it processed. This shows where a file came from; on its own it does not prove the file is unchanged
  (anyone can edit metadata).
* **Audit page:** Optionally appends a page with a **QR code**, the signer history and the fingerprint.
* **Timestamp (best effort):** When online, the app (web and Android) asks a public Time Stamping Authority
  (FreeTSA, through our relay) to timestamp the fingerprint and stores the reply in the file. The app does not check
  the reply itself (standard tools such as `openssl ts -verify` can). Offline, it uses the device clock, labelled as
  such.
* **Certificate signatures (.p12/.pfx):** Optionally sign with your own certificate. The file and password are used in
  memory for one save and never stored. Adobe Acrobat and other PDF readers can check this kind of signature.

### 🤝 Multi-Party Workflows

* **Handover between signers:** When you open a file signed by someone else, a banner says so and offers to check
  the previous signer's **6-digit handover code**. It never blocks signing. A matching code shows the file was not changed by
  accident on the way. It is short, so it is not protection against deliberate forgery: for that, compare the full
  fingerprint.
* **Signer history:** Each signer's entry records the fingerprint of the file they opened, whether they checked the
  handover code, and the time.
* **One audit page for everyone:** The audit page lists all signers and marks any skipped handover check.

### ✍️ Tools

* **Responsive design:** One interface (Web Components, Lit) for phones and desktops, respecting phone safe areas.
* **Beginner-friendly:** Opens with the essentials (signature, date, stamp, Finish); **More Tools** reveals initials,
  text, certificate signing and the footer and audit-page options.
* **Typed signature:** Type your name instead of drawing it, in a handwriting style (Latin script or Arabic Ruqaa).
  The fonts ship with the app, so it works offline.
* **Dates your way:** Day/month/year numbers, written out in your language, or Hijri (Umm al-Qura calendar; the text
  can be corrected by hand when the local moon sighting differs by a day).
* **Unfinished work is kept:** If the app is closed before Finish (Android often closes apps in the background), the
  home screen offers to continue where you left off.
* **Saved signatures and stamps:** Draw once, reuse offline. Stored only on your device (IndexedDB).
* **Layout help:** Drag, resize, snap guides, multi-select, keyboard nudging.
* **Undo/Redo:** `Ctrl+Z`, `Ctrl+Y`.
* **Accessibility:** Labelled controls, keyboard shortcuts, native dialogs, 44 px touch targets for the main actions,
  and a typed signature for anyone who cannot draw one.
* **Scanned and locked PDFs:** Items land where you placed them on turned (rotated) and cropped pages. A
  password-protected PDF is refused when it opens, with a clear message, instead of failing at Finish.

### 🌍 Universal Access

* **Offline first (PWA):** Installs from the browser on Android, iOS, Windows and Mac, and works without internet.
* **Android app:** On Google Play. PDFs open in Signer from file managers and other apps with **Open with** or
  **Share**.
* **Web share target:** The installed web app accepts PDFs shared from other apps (Android and Windows).
* **Languages:** English, Arabic (right-to-left), French, Spanish and Italian. The Spanish and Italian texts still
  need a review by a native speaker.

---

## 🛡️ Privacy & "No Tracking" Promise

We believe in **Data Sovereignty**.

* **No uploads:** Your PDF never touches a server.
* **No tracking:** No analytics, no telemetry, no cookies, no accounts.
* **Your data stays local:** Saved signatures, stamps and settings live in your browser or app storage, and
  **Forget My Data** deletes them.
* **Unfinished work stays local too:** While you edit, the open PDF and your placed items are kept in the app's
  storage on this device, so they survive the app being closed. They are deleted when you finish, leave without
  saving, or tap the delete button on the home screen. A certificate or its password is never kept.

---

## 🧪 Engineering & Stability

* **End-to-end tests:** About 330 Playwright test runs (on a phone screen, in Arabic where it matters, and on
  desktop) click through the real app: signing, saving, verifying,
  multi-signer handover, certificate signing, right-to-left layout, scanned PDFs, and more. They use stable
  `data-testid` attributes, not translated text.
* **Strict TypeScript** and a translation check (every language has every text) run before the tests:
  `npm run check`.
* **Phone tests:** Maestro flows tap through the Android app on a real phone (`npm run test:android`).
* **Guarded deploys:** GitHub runs all checks on every push. The website is deployed only from a version tag, only
  after the checks pass against the production build.

---

## 🚀 Workflows: How to Sign & Verify

### Scenario A: Two people sign (handover)

1. **Alice** signs and taps **Finish**. The app saves the file and, under **For verification**, shows the file
   fingerprint and a 6-digit **code for the next signer**.
2. Alice sends Bob the PDF, and the code in a separate message.
3. **Bob** opens the PDF in Signer. A banner says Alice signed it before and offers **Check code**.
4. **Bob** checks the code (or not), signs, and taps **Finish**. The new file has a new fingerprint covering both
   signatures.

### Scenario B: Checking a signed file (the receiver)

1. Open Signer in **Verify** mode (or scan the QR code on the audit page).
2. Select the PDF you received. A plain answer sits at the top: **Not confirmed yet** until you paste a fingerprint
   (a Signer record in the file alone proves nothing).
3. Paste the fingerprint the sender gave you in a separate message:
    * ✅ **Intact:** the file is exactly the one the sender saved.
    * ❌ **Changed:** the file is different (even one changed byte), or it is not the file a verify link was made for.

---

## 🏗️ Architecture

* **Core:** TypeScript (strict), Vite, Lit (Web Components).
* **Android:** Capacitor 8 (no iOS app yet; iOS users can install the web app).
* **PDF:** `pdf-lib` (editing and saving) and `pdfjs-dist` (rendering; its fonts, cmaps and image decoders are copied
  into `public/`).
* **Cryptography:** Web Crypto (`crypto.subtle`) for SHA-256, `node-forge` and `@signpdf` for certificate signatures.
* **Offline:** a Workbox service worker (`src/sw.ts`) precaches the app and receives shared files.
* **Module map:** `docs/architecture/` (app shell, workspace, PDF pipeline). Dependency rules: `docs/DEPENDENCIES.md`.

---

## 🛠️ Development

### Setup

* Node.js 22+ (`.nvmrc`; the Capacitor 8 CLI needs it)
* For the Android app: a JDK 21 and the Android SDK (Android Studio installs both)

```bash
npm ci          # install exactly what package-lock.json lists
npm run dev     # the app at http://localhost:5173, reloads on every save
```

TypeScript is pinned to 6.0.x on purpose. Read [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) before upgrading anything.

### Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the app in the browser, with live reload |
| `npm run check` | Typecheck, translations and all tests: run before every commit |
| `npm run test:build` | All tests against the production build |
| `npm run build` | Production build into `dist/` |
| `npm run android:run` | Build and install **Signer Dev** on your USB phone |
| `npm run android:live` | Signer Dev loads from this computer and reloads on every save |
| `npm run test:android` | Maestro flows on your USB phone |
| `npm run android:release` | Signed `.aab` for Play Console |
| `npm run release` | Release a new version (website and Android), see below |

### Check before every commit

```bash
npm run check
```

It runs the typecheck, the translation check (every language has every text, and every
text is used) and the Playwright tests, in that order, and stops at the first failure with
a plain message. The parts also run alone: `npm run typecheck`, `npm run check-i18n`,
`npm test`. Tests use at most 4 browsers at once (1 on CI). After a failure,
`npx playwright show-report` opens the details.

The same tests run on three screens (Playwright projects in `playwright.config.ts`):

| Project | Screen | Runs in |
|---|---|---|
| `phone` | Pixel 5, touch, English: every test | `npm run check`, GitHub |
| `phone-ar` | Pixel 5, Arabic (right to left): tests tagged `@rtl` / `@rtl-only` | `npm run check`, GitHub |
| `desktop` | Desktop Chrome: every test | `npm run check -- --desktop`, GitHub |

Tags in a test title choose where it runs: `@desktop` or `@phone` (one screen only), `@rtl`
(also in Arabic), `@rtl-only` (only in Arabic). `tests/support/ui.ts` clicks the right button
for the screen (`tid(page, 'btn-add-date')`). `tests/android.spec.ts` runs the app as if it
were the Android app, through a fake Android bridge (`tests/support/native-fake.ts`): saving
into Documents, the share sheet, "Open with", the Back button. A test for a known, not yet
fixed bug is marked `test.fixme(…, 'Bug <id>: …')` and switched on with the fix.

`npm run test:build` runs the same tests against the production build (`vite preview`), as
GitHub does before deploying.

GitHub (`.github/workflows/deploy.yml`): every push to `develop` runs the checks and
deploys nothing. Only a version tag (`vX.Y.Z`, pushed by `npm run release`) deploys
sign.open-waqf.org, and only if the tag matches `package.json` and all checks pass.

On Ubuntu 26.04, Playwright needs `export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`
(put it in `~/.bashrc`).

### Test Certificate Fixture

For Playwright certificate-signing tests, a dummy self-signed PKCS#12 fixture is committed at:

`tests/fixtures/test-cert.p12`

Fixture password (test-only): `owq-test-1234`

### Test on your phone

Plug in your phone with USB debugging on. Both commands install **Signer Dev**
(`org.openwaqf.signer.dev`): it has its own name and data, so it sits next to the Play
Store app without touching it.

```bash
npm run android:run    # build, install and open Signer Dev
npm run android:live   # the phone loads the app from this computer and updates on every save (Ctrl+C to stop)
```

After a live session, run `npm run android:run` once so the phone has a normal build again.

First time only: Settings → About phone → tap "Build number" 7 times, then Developer
options → USB debugging on, plug in, tap "Allow".

### App icons

Icons are generated from `assets/` only when they change. The tool is not installed; run it with npx:

```bash
npx @capacitor/assets generate --android
```

### Phone tests (Maestro)

Seven short flows in `maestro/android/` tap through the real app on your phone, for what only a
real phone shows: opening a PDF, saving into Documents and the Android share sheet, the
Android language picker, the Back button closing the Saved sheet, a draft surviving the app being
closed, **Share to Signer** through the real share sheet, and a typed signature with a Hijri date. They always target Signer Dev, never the Play Store app. After the
run, the command checks through adb that a new signed PDF really is in the phone's Documents
folder. A flow that waits for a bug fix goes in `maestro/android/pending/` (not run) until the fix lands.

```bash
npm run test:android                      # install a fresh Signer Dev, then run all flows
npm run test:android -- --no-install      # use the Signer Dev already on the phone
npm run test:android -- maestro/android/flows/02-sign-save-share.yaml     # one flow
```

Keep the phone unlocked while the flows run. Maestro is installed once with
`curl -Ls "https://get.maestro.mobile.dev" | bash`; the command tells you if it is missing.

### Release a new version

```bash
npm run release                 # 0.41.0 -> 0.42.0 (the middle number goes up)
npm run release -- 1.0.0        # an exact version (never lower)
npm run release -- --dry-run    # show what would happen, change nothing
```

One command does it all, and asks before changing anything:

1. Checks you are on `develop`, have nothing uncommitted, and are not behind GitHub.
2. Lists the commits since the last release and opens your editor for an optional
   "What's new" note (max 500 characters, like Google Play), saved in
   `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`.
3. Sets the version in `package.json`, `package-lock.json` and `android/app/build.gradle`
   (`versionName`, and `versionCode` + 1).
4. Runs the production build, `npm run check` and an Android build check. If anything fails,
   every file is put back and nothing is committed.
5. Commits `Release X`, tags `vX` and pushes both together.
6. Builds the signed `.aab` (`npm run android:release`) for you to upload in Play Console.

If the push fails (no internet), the release stays committed and tagged on your computer,
and the script prints the one command that finishes it.

### Android release build only

```bash
npm run android:release
```

Builds the signed `.aab` for Play Console (nothing is uploaded). Unlock the Cryptomator vault
first. Signing comes from `android/keystore.properties` (git-ignored: `storeFile`,
`storePassword`, `keyAlias`, `keyPassword`), else from `SIGNER_KEYSTORE`, `SIGNER_KS_PASS`,
`SIGNER_KEY_ALIAS` [`SIGNER_KEY_PASS`], else it asks. Signer uses the same Open Waqf upload key
as wird. The script checks the bundle is signed with the key Play Console expects
(SHA-1 `BB:7B:A6:…:8A:08`) and stops if not. Without any signing setup, Gradle still builds an
unsigned bundle, so Android Studio and CI keep working.

### Timestamp relay (Cloudflare Worker)

If the app is hosted on GitHub Pages, deploy the TSA relay as a separate Cloudflare Worker:

* Worker source: `workers/tsa-relay/src/index.ts`
* Worker config: `workers/tsa-relay/wrangler.toml`
* Recommended route: `https://tsa.open-waqf.org/api/tsa`

Runtime behavior:

* Browser sends RFC 3161 query bytes to `VITE_TSA_RELAY_URL`.
* Relay forwards only timestamp-query bytes to FreeTSA (`https://freetsa.org/tsr`).
* PDF bytes are never uploaded.

Required app env var (set only in the GitHub build, `.github/workflows/deploy.yml`):

* `VITE_TSA_RELAY_URL=https://tsa.open-waqf.org/api/tsa`

Local builds, `npm run android:release` and the Android app do not set it yet, so their timestamps fall back to the
device clock. The relay also only accepts requests from `https://sign.open-waqf.org`.

Required CSP update (already included in `index.html`):

* `connect-src 'self' data: https://tsa.open-waqf.org`

GitHub Actions deploy workflow for relay:

* `.github/workflows/deploy-tsa-relay.yml`
* Requires secrets:
  * `CLOUDFLARE_API_TOKEN`
  * `CLOUDFLARE_ACCOUNT_ID`

---

## ⚠️ Disclaimers

### What kind of signature is this?

* By default, Signer adds a **simple electronic signature**: your drawn signature (or stamp) on the page, plus a
  record and a fingerprint of the file. Many everyday agreements accept this, but whether it is enough depends on your
  country and the document. This is not legal advice.
* With your own certificate (.p12/.pfx), Signer adds a standard **digital signature** that PDF readers such as Adobe
  Acrobat can check. It is as trustworthy as the certificate you use.
* Signer is **not** a qualified signature service (such as eIDAS QES), which some documents legally require.
* Saving with Signer changes the file, so a digital signature that was already in the PDF (from another tool) will
  show as broken afterwards.

### Performance Limits

* **Recommended:** Files under **25MB**.
* **Large Files:** Since processing occurs in your browser's RAM to protect your privacy, extremely large files may
  cause memory exhaustion on older mobile devices.

---

<div align="center">
<p><em>Built with ❤️ for the Ummah and Humanity.</em></p>
<p><small>Released under Polyform Noncommercial License 1.0.0</small></p>
</div>
