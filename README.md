# ✒️ Open Waqf Signer (الموقّع)

> **Secure. Offline. Verifiable.**
> A privacy-first PDF signer with cryptographic integrity checks.

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
* **Dual-Layer Verification:**
1. **Metadata Check (Internal):** Instantly identifies files signed by the app.
2. **Strict Integrity Check (External):** Uses SHA-256 hashing to prove mathematically that a document has not been tampered with since signing.


* **🆔 Identity Linking:** Optionally link an email address to a signature for audit trails.
* **Tamper Detection:** Drag & drop a signed PDF to instantly verify its integrity.
* **Audit Trail:** Automatically appends a verification page with a QR code and event log.

### ✍️ Professional Tools

* **Natural Ink:** Smooth, pressure-sensitive signature drawing.
* **Smart Annotation:** Add Names, Dates, Initials, Stamps, and Free Text.
* **History:** Full Undo/Redo support (`Ctrl+Z`, `Ctrl+Y`).
* **Layout Control:** Drag, resize, and position elements with precision.

### 🌍 Universal Access

* **Offline First (PWA):** Installs as a native app on Android, iOS, Windows, and Mac.
* **Multilingual:** Native support for **English**, **Arabic (RTL)**, and **French**.
* **Mobile Optimized:** Touch-friendly interface with native back-button handling.

---

## 🚀 How to Verify a Document (The Trust Model)

We use an **"External Key"** model to ensure document integrity without storing your data on a central server.

### Step 1: Signing & Sending

1. **Sign:** The user signs the PDF.
2. **Hash Generation:** The app generates a **Security Hash** (e.g., `a1b2c3...`) representing the final file state.
3. **Send:** The user emails the **PDF** (attachment) + the **Hash** (in the email body) to the recipient.

### Step 2: Verifying (The Receiver)

The recipient opens the "Verify" tool in the app:

1. **Drop:** Upload the signed PDF.
* *Result:* ✅ **"Record Found"** (Confirms the file metadata is present).


2. **Strict Check:** Paste the **Security Hash** from the email.
* *Result:* ✅ **"SECURE VERIFIED"** (Proves the file is 100% authentic and unmodified).
* *Result:* ❌ **"MISMATCH"** (Detects if even a single byte was altered).



---

## 🏗️ Architecture

* **Core:** TypeScript, Vite, Lit (Web Components).
* **Native Layer:** Capacitor (for Android/iOS).
* **PDF Engine:** `pdf-lib` (modification) & `pdfjs-dist` (rendering).
* **Cryptography:** Native `crypto.subtle` API for SHA-256 hashing (no external libraries).
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