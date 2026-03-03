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
* **Modal System:** All dialogs are standardized on `owq-modal` plus shared modal utility classes in
  `src/styles/shared-styles.ts` for consistent layout, focus behavior, and RTL-safe styling.
* **Verification State Flow:** App-shell verification transitions are centralized under `src/features/verify/` (`verify-controller`
  and `verify-state`) to keep UI rendering and state transitions decoupled.

---

## 🚀 Getting Started

### Prerequisites

* Node.js 20+
* Android Studio (only if building the APK)

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

### 3. Verification & Type-checking

Always run these before contributing to ensure stability.

```bash
# Run TypeScript type-check
npm run typecheck

# Run the test suite
npm test
```

### Test Certificate Fixture

For Playwright certificate-signing tests, a dummy self-signed PKCS#12 fixture is committed at:

`tests/fixtures/test-cert.p12`

Fixture password (test-only): `owq-test-1234`

### 4. Build for Production (PWA)

Compiles TypeScript to optimized, offline-ready JS in `dist/`.

```bash
npm run build
```

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
