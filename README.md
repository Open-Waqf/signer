# ✒️ Open Waqf Signer

> **Secure. Offline. Free.**
> A privacy-first PDF signer and form-filler.

Open Waqf Signer allows users to visually sign and edit PDF documents directly in their browser or on their mobile
device without uploading data to any server. It is built on the principles of **Amanah** (Trust) and **Privacy**.

## 🌟 Key Features

* **Offline First (PWA):** Works without internet. Installable as a native app on Android, iOS, and Desktop.
* **Professional Tools:**
    * ✍️ **Signatures:** Smooth, pressure-sensitive pen strokes (simulates real ink).
    * 📝 **Text Tool:** Add Names, Titles, or fill out forms.
    * 📅 **Date Stamp:** One-click auto-date with editing capabilities.
    * 🔤 **Initials:** Quick insertion for multi-page contracts.
* **Advanced Editing:**
    * **Undo / Redo** (Ctrl+Z / Ctrl+Y) history support.
    * Drag-and-drop positioning.
    * Resize handles for all elements.
    * Font styling (Bold, Size adjustment).
* **Mobile Optimized:**
    * Responsive toolbar (icons-only on small screens).
    * Thicker pen for touch screens.
    * Native Android back-button handling.
* **Global:** Fully localized in **English**, **Arabic (RTL)**, and **French**.

---

## 🏗️ Architecture

* **Stack:** TypeScript, Vite, Lit (Web Components), Capacitor.
* **PDF Engine:** `pdf-lib` (modification) & `pdfjs-dist` (rendering).
* **Privacy:** Zero analytics, zero remote dependencies (fonts & scripts are embedded locally).
* **Storage:** Zero-knowledge. Files are processed in RAM and saved back to the user's device.
* **License:** Polyform Noncommercial 1.0.0.

---

## 🚀 Getting Started

### Prerequisites

* Node.js 20+
* Android Studio (required only for building the APK)

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

## 🤖 Workflow Commands

**"INIT [Name]" Routine**

When preparing for a release or device sync:

1. **Run** `npm run build`: Always regenerate `dist` before syncing to ensure the latest code is used.
2. **Run** `npx cap sync`: Update native plugins and copy the built web assets to the Android layer.

---

## 📦 Deployment

The project uses **GitHub Actions** to deploy to GitHub Pages (PWA).

1. **Develop:** Push changes to the `develop` branch.
2. **Action:** The "Deploy Open Waqf Signer" action runs automatically.

* It compiles TypeScript.
* It cleans comments and optimizes code.
* It pushes the result to the `deploy` branch.


3. **Live:** The site updates at `https://sign.open-waqf.org`.

## 📱 Android Release

The GitHub Action does **not** build the APK to the store automatically. To release an APK:

1. Run `npm run build`.
2. Run `npx cap sync`.
3. Open **Android Studio** -> **Build** -> **Generate Signed Bundle / APK**.
4. Copy the resulting APK to `public/app/signer.apk` manually if distributing via the website.

## ⚠️ Important Disclaimers

### Visual vs. Digital Signatures

Open Waqf Signer applies a **visual electronic signature** (drawing an image on a PDF page).

* ✅ **Good for:** Contracts, internal approvals, invoices, waivers, and general business use where visual consent is
  sufficient.
* ❌ **Not for:** Scenarios requiring legally mandated **PKI / Digital Certificates** (e.g., eIDAS Qualified Electronic
  Signatures) that require a cryptographic USB token or Smart Card.

### Privacy & Security

* **No Uploads:** Your documents **never** leave your device. All processing is done in the browser's memory.
* **Audit Trail:** The app generates a local "Event Log" page attached to the end of your PDF to track when signatures
  were applied.

### Performance Limits

* **Recommended:** Files under **25MB**.
* **Large Files:** Since everything runs in your RAM (memory), opening files larger than 50MB-100MB on mobile devices
  may cause the browser tab to crash. This is a security feature of the browser sandbox.

---

*Built with ❤️ for the Ummah and Humanity.*