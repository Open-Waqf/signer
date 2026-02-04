# ✒️ Open Waqf Signer (الموقّع)

> **Secure. Offline. Verifiable.**
> A privacy-first PDF signer with cryptographic integrity.

<div align="center">
<a href="[https://sign.open-waqf.org](https://sign.open-waqf.org)">
<img src="public/icons/icon-512.webp" alt="Logo" width="100" height="100" style="border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
</a>






</div>

Open Waqf Signer allows users to sign, edit, and **verify** PDF documents directly in their browser. It is built on the principles of **Amanah** (Trust) and **Privacy**.

Unlike other free tools, **no data is ever uploaded to a server**. All cryptographic processing happens locally on your device.

---

## 🌟 Key Features

### 🛡️ Security & Trust

* **Zero-Knowledge:** Documents never leave your device (RAM-only processing).
* **Cryptographic Hashing:** Every saved document is stamped with a unique SHA-256 fingerprint.
* **🆔 Identity Verification:** innovative "Self-Sovereign" verification. Link your email to a document hash to prove ownership without a central server.
* **Tamper Detection:** Drag & drop a signed PDF to instantly verify if it has been altered since signing.
* **Audit Trail:** Automatically appends a verification page with a QR code and event log.

### ✍️ Professional Tools

* **Natural Ink:** Smooth, pressure-sensitive signature drawing.
* **Smart Annotation:** Add Names, Dates, Initials, and Free Text.
* **Custom Stamps:** Upload company seals or logos.
* **History:** Full Undo/Redo support (`Ctrl+Z`, `Ctrl+Y`).
* **Layout Control:** Drag, resize, and position elements with precision.

### 🌍 Universal Access

* **Offline First (PWA):** Installs as a native app on Android, iOS, Windows, and Mac.
* **Multilingual:** Native support for **English**, **Arabic (RTL)**, and **French**.
* **Mobile Optimized:** Touch-friendly interface with native back-button handling on Android.

---

## 🏗️ Architecture

* **Core:** TypeScript, Vite, Lit (Web Components).
* **Native Layer:** Capacitor (for Android/iOS).
* **PDF Engine:** `pdf-lib` (modification) & `pdfjs-dist` (rendering).
* **State Management:** Reactive Controllers (MobX-like pattern with Lit).
* **Storage:** `IndexedDB` (for preferences only). Files are transient.

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

### 3. Build for Production (PWA)

Compiles TypeScript to optimized, offline-ready JS in `dist/`.

```bash
npm run build

```

### 4. Android Local Test

Syncs the `dist/` folder to the Android project and opens Android Studio.

```bash
# 1. Build web assets
npm run build

# 2. Sync to Native
npx cap sync

# 3. Open IDE
npx cap open android

```

---

## 🔒 The Trust Model (How it works)

We use a **"Triangulated Proof"** system to ensure document integrity without storing your data:

1. **The PDF Hash:** When you save, we calculate a SHA-256 hash of the document content + annotations. This ID is embedded in the PDF metadata.
2. **The Visual Audit:** This ID is printed on the footer of every page and the final Audit Page.
3. **The Identity Loop:** If you use the Identity tool, the app generates a pre-filled email containing this ID. You send this email to the recipient.
* *Result:* The Recipient has the PDF (with ID `XYZ`) and an Email from you (referencing ID `XYZ`). This proves **You** signed **That File**.



---

## 📦 Deployment

The project uses **GitHub Actions** to deploy to GitHub Pages (PWA).

1. **Push:** Commit changes to the `main` branch.
2. **Build:** The Action compiles TypeScript and optimizes assets.
3. **Deploy:** The site updates automatically at `https://sign.open-waqf.org`.

---

## ⚠️ Disclaimers

### Visual vs. Digital Signatures

Open Waqf Signer applies a **Cryptographically Linked Electronic Signature**.

* ✅ **Valid for:** Business contracts, invoices, internal approvals, waivers, and general agreements.
* ❌ **Not for:** Scenarios requiring **eIDAS Qualified Electronic Signatures (QES)** that mandate a specific hardware token (Smart Card/USB) issued by a government authority.

### Performance Limits

* **Recommended:** Files under **25MB**.
* **Large Files:** Since processing occurs in your browser's RAM, files larger than 50MB may cause the tab to crash on older mobile devices.

---

<div align="center">
<p><em>Built with ❤️ for the Ummah and Humanity.</em></p>
<p><small>Released under Polyform Noncommercial License 1.0.0</small></p>
</div>