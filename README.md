# ✒️ Open Waqf Signer (الموقّع)

> **Secure. Offline. Verifiable.** > A privacy-first PDF signer with cryptographic integrity checks and a unified,
> responsive design.

<div align="center">
<a href="https://sign.open-waqf.org">
<img src="public/icons/icon-512.webp" alt="Logo" width="100" height="100" style="border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
</a>
</div>

Open Waqf Signer allows users to sign, edit, and **verify** PDF documents directly in their browser. It is built on the
principles of **Amanah** (Trust) and **Privacy**.

Unlike other free tools, **no data is ever uploaded to a server**. All cryptographic processing happens locally in your
device's RAM.

---

## 🌟 Key Features

### 🛡️ Security & Trust

* **Zero-Knowledge Architecture:** Documents never leave your device.
* **Hardware-Backed Signing (WebAuthn):** Sign using **FaceID, TouchID, or YubiKey**. Generates a local cryptographic proof (FIDO2) embedded in the PDF for superior non-repudiation.
* **Dual-Layer Verification:**
    1. **Metadata Check (Internal):** Instantly identifies files processed by the app via hidden metadata markers.
    2. **Strict Integrity Check (External):** Uses military-grade `crypto.subtle` SHA-256 hashing to prove
       mathematically that a document has not been tampered with since signing.
* **Audit Trail:** Automatically appends a verification page with a **QR code**, Event Log, and Digital Fingerprint.
* **RFC 3161 Timestamp Proof (Best-Effort):** When online, Signer sends only an abstract SHA-256 fingerprint query to a TSA relay endpoint and records returned timestamp token metadata; when offline or timed out, it falls back to local device time with explicit unverified labeling.
* **Certificate-Based CMS Signatures (.p12/.pfx):** Optionally sign with your own certificate file. Parsing and signing are performed locally in-memory, and certificate credentials are cleared after each save.

### 🤝 Multi-Party Workflows

* **The "Handover" Protocol:** Securely pass documents between multiple signers.
* **Pre-Sign Validation:** When you open a document signed by someone else, the app automatically detects it and
  asks for the previous signer's **6-digit handover code** before you add yours (with an explicit skip flag if unavailable).
* **Sequential Hash Chaining:** Each signer payload stores the opened document hash, manual-verification status, and
  chain metadata so verification can validate the signer chain locally in reverse order.
* **Single Accumulated Audit Page:** When enabled, the app renders one final audit page listing all signers in history
  and warning labels for any skipped manual handover checks.

### ✍️ Professional UX & Tools

* **Responsive Unified Design:** A meticulously crafted UI using Web Components (Lit) that seamlessly adapts to desktop
  displays and mobile screens (respecting iOS/Android safe areas and navigation bars).
* **Enhanced Accessibility:** Full ARIA label support, keyboard navigation (Tab/Shift+Tab), and focus traps for all
  modal
  dialogs to ensure a professional experience for all users.
* **Large Touch Targets:** Optimised for mobile with large (44px+) interactive targets for all critical actions.
* **Smart Layout Control:** Drag, resize, and position elements with exact mathematical center-to-center snapping and
  viewport collision detection to prevent UI clipping.
* **Natural Ink & Custom Prompts:** Smooth signature drawing with saved presets and native-feeling custom modal prompts
  for text/identity inputs.
* **Beginner-Friendly Editing:** Workspace opens in **Basic Mode** (signature/date/save first), with **More Tools** to
  reveal advanced controls.
* **History:** Full Undo/Redo support (`Ctrl+Z`, `Ctrl+Y`).

### 🌍 Universal Access

* **Offline First (PWA):** Installs as a native app on Android, iOS, Windows, and Mac. Fully functional without an
  internet connection.
* **Native "Open With" / Share-In:** PDFs can be opened directly into Signer from Android file managers/apps (APK) and
  from installed Android/Windows PWAs through OS share targets.
* **Share Target Reliability:** A custom Workbox `injectManifest` service worker intercepts Web Share Target `POST`
  uploads, prevents static-host 404 navigation issues, and safely hands shared PDFs to the running app.
* **Air-Gapped QR Transfer:** Share signed PDFs between fully offline devices using animated **UR** fountain QR frames
  with local reconstruction, progress tracking, and no network/Bluetooth/USB dependency.
* **Multilingual:** Native support for **English**, **Arabic (RTL)**, and **French** with dynamic UI mirroring.

---

## 🛡️ Privacy & "No Tracking" Promise

We believe in **Data Sovereignty**.

* **No Uploads:** Your PDF never touches our cloud.
* **Cryptographic Identifiers:** We use native `crypto.randomUUID()` for secure, collision-resistant document and
  annotation tracking—never insecure random numbers.
* **No Profiling:** We do not use cookies or trackers to build user profiles.
* **Usage Counting:** We use privacy-preserving telemetry solely to count aggregate usage (e.g., "100 documents signed
  today") to ensure the project remains sustainable. No personal data is ever collected.

---

## 🧪 Engineering & Stability

We don't just "hope" the code works; we prove it before every release.

* **Automated Audit (The Robot):** We use **Playwright** to run end-to-end tests simulating real user behavior.
* **Stable Selectors:** Tests rely on unique `data-testid` attributes rather than fragile translated text, ensuring
  reliability across all languages.
* **Comprehensive Coverage:**
    * ✅ **Cryptography:** Verifies that SHA-256 hashes are calculated and matched correctly.
    * ✅ **Workflows:** Simulates Alice signing, Bob verifying, and complex multi-page interactions.
    * ✅ **Navigation:** Full audit of landing page modes, privacy dialogs, and exit confirmation logic.
    * ✅ **Robustness:** Tests for RTL mirroring, dirty-state detection, and keyboard shortcuts.
    * ✅ **Certificate Flow:** E2E coverage for `.p12` load/unlock, incorrect-password handling, and CMS `/ByteRange` output.
* **Type Safety:** The entire codebase is strictly typed. We run `tsc --noEmit` to ensure zero regression in logic or
  data structures.
* **CI/CD Guardrails:** Deployment is physically blocked by GitHub Actions if any test fails or type-check fails,
  ensuring
  no broken code ever reaches production.

---

## 🚀 Workflows: How to Sign & Verify

We use an **"External Key"** model to ensure document integrity without storing your data on a central server.

### Scenario A: The "Handover" (Two Parties Signing)

1. **Person A (Alice)** signs the document and saves it.
    * *System generates a Strict Hash and provides a Receipt.*
    * Alice sends the PDF + Hash to **Person B (Bob)** via a secure channel (e.g., WhatsApp/Signal).
2. **Person B (Bob)** opens the PDF in Open Waqf Signer.
    * 🚨 **Auto-Detection:** The app detects Alice's metadata marker immediately.
    * **Verify:** Bob enters Alice's hash. The app confirms the file wasn't tampered with during transit.
3. **Bob Signs:** Once verified, Bob adds his signature and saves, generating a NEW Hash that secures both signatures.

### Scenario B: Verification (The Receiver)

Anyone receiving a signed document can verify it:

1. Scan the **QR Code** on the last page or click the **Verification Link**.
2. The app opens in **Verify Mode** ("Link Detected").
3. Drop the signed PDF into the app.
4. The app confirms **"Metadata Found"**.
5. Paste the **Security Hash** provided by the sender.
    * Metadata confirms provenance only.
    * ✅ **"Integrity Verified":** The document is 100% authentic.
    * ❌ **"Integrity Failure":** The document has been altered (even by 1 pixel).

---

## 🏗️ Architecture

* **Core:** TypeScript (Strict Mode), Vite, Lit (Web Components).
* **Native Layer:** Capacitor (for Android/iOS distribution).
* **Styling:** CSS variables, dynamic viewport units (`100dvh`), and Shadow DOM isolation.
* **Testing:** Playwright (End-to-End & Workflow logic).
* **PDF Engine:** `pdf-lib` (modification) & `pdfjs-dist` (rendering).
* **Cryptography:** Native `crypto.subtle` API for SHA-256 and `crypto.randomUUID()` for identifiers.
* **Refactor Docs:** See `docs/architecture/` for app shell, workspace, and PDF pipeline boundaries.
* **Internal PDF Services:** Hashing, metadata, audit-page rendering, and chain verification are split into focused modules
  under `src/lib/pdf/`.
* **Modal System:** All dialogs are standardized on native HTML `<dialog>` via `owq-modal`, with shared utility
  classes in `src/styles/shared-styles.ts` and normalized `::backdrop` styling for iOS Safari and Android Chrome parity.
* **Verification State Flow:** App-shell verification transitions are centralized under `src/features/verify/` (`verify-controller`
  and `verify-state`) to keep UI rendering and state transitions decoupled.

---

## 🚀 Getting Started

### Prerequisites

* Node.js 22+ (the Capacitor 8 CLI needs it)
* Android Studio (only if building the APK)

TypeScript is pinned to 6.0.x on purpose. Read [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)
before upgrading anything.

### 1. Installation

```bash
npm install
# Install Capacitor dependencies for Android
npx cap sync
```

### 2. Development (Browser)

Runs the app in "Web Mode" with Hot Module Replacement (HMR).

```bash
npm run dev
```

### 3. Check before every commit

```bash
npm run check
```

It runs the typecheck, the translation check (every language has every text, and every
text is used) and all Playwright tests, in that order, and stops at the first failure with
a plain message. The parts also run alone: `npm run typecheck`, `npm run check-i18n`,
`npm test`. Tests use at most 4 browsers at once (1 on CI). After a failure,
`npx playwright show-report` opens the details.

On Ubuntu 26.04, Playwright needs `export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64`
(put it in `~/.bashrc`).

### Test Certificate Fixture

For Playwright certificate-signing tests, a dummy self-signed PKCS#12 fixture is committed at:

`tests/fixtures/test-cert.p12`

Fixture password (test-only): `owq-test-1234`

### 4. Build for Production (PWA)

Compiles TypeScript to optimized, offline-ready JS in `dist/`.

```bash
npm run build
```

### 5. Test on your phone

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

### 6. Phone tests (Maestro)

The flows in `maestro/android/` tap through the real app on your phone. They always
target Signer Dev, never the Play Store app.

```bash
npm run test:android                      # install a fresh Signer Dev, then run all flows
npm run test:android -- --no-install      # use the Signer Dev already on the phone
npm run test:android -- maestro/android/flows/08-sample-save-cycle.yaml   # one flow
```

Keep the phone unlocked while the flows run. Maestro is installed once with
`curl -Ls "https://get.maestro.mobile.dev" | bash`; the command tells you if it is missing.

### 7. Android release build

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

### 8. Release a new version

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
4. Runs the production build, `npm run check` and the Android unit tests. If anything fails,
   every file is put back and nothing is committed.
5. Commits `Release X`, tags `vX` and pushes both together.
6. Builds the signed `.aab` (`npm run android:release`) for you to upload in Play Console.

If the push fails (no internet), the release stays committed and tagged on your computer,
and the script prints the one command that finishes it.

### Cloudflare Worker Relay (GitHub Pages Hosting)

If the app is hosted on GitHub Pages, deploy the TSA relay as a separate Cloudflare Worker:

* Worker source: `workers/tsa-relay/src/index.ts`
* Worker config: `workers/tsa-relay/wrangler.toml`
* Recommended route: `https://tsa.open-waqf.org/api/tsa`

Runtime behavior:

* Browser sends RFC 3161 query bytes to `VITE_TSA_RELAY_URL`.
* Relay forwards only timestamp-query bytes to FreeTSA (`https://freetsa.org/tsr`).
* PDF bytes are never uploaded.

Required app env var:

* `VITE_TSA_RELAY_URL=https://tsa.open-waqf.org/api/tsa`

Required CSP update (already included in `index.html`):

* `connect-src 'self' data: https://tsa.open-waqf.org`

GitHub Actions deploy workflow for relay:

* `.github/workflows/deploy-tsa-relay.yml`
* Requires secrets:
  * `CLOUDFLARE_API_TOKEN`
  * `CLOUDFLARE_ACCOUNT_ID`

---

## ⚠️ Disclaimers

### Visual vs. Digital Signatures

Open Waqf Signer applies a **Cryptographically Linked Electronic Signature**.

* ✅ **Valid for:** Business contracts, invoices, internal approvals, waivers, and general agreements.
* ❌ **Not for:** Scenarios requiring **eIDAS Qualified Electronic Signatures (QES)** that mandate a specific hardware
  token (Smart Card/USB) issued by a government authority.

### Performance Limits

* **Recommended:** Files under **25MB**.
* **Large Files:** Since processing occurs in your browser's RAM to protect your privacy, extremely large files may
  cause memory exhaustion on older mobile devices.

---

<div align="center">
<p><em>Built with ❤️ for the Ummah and Humanity.</em></p>
<p><small>Released under Polyform Noncommercial License 1.0.0</small></p>
</div>
