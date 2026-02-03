# Open Waqf Signer

> A free, offline-first, and private PDF signer for humanity.

Open Waqf Signer allows users to visually sign PDF documents directly in their browser or on their mobile device without
uploading data to any server. It is built on the principles of **Amanah** (Trust) and **Privacy**.

## 🏗️ Architecture

- **Stack:** TypeScript, Vite, Lit (Web Components), Capacitor.
- **Privacy:** Zero analytics, zero remote dependencies (fonts/scripts are local).
- **Offline:** Fully functional offline via Service Worker & Local Logic.
- **License:** Polyform Noncommercial 1.0.0.

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- Android Studio (for APK builds)

### 1. Installation

```bash
npm install
npx cap sync

```

### 2. Development (Browser)

Runs the app in "Web Mode" with hot-reload.

```bash
npm run dev

```

### 3. Build for Production

Compiles TypeScript to optimized JS in `dist/`.

```bash
npm run build

```

### 4. Android Local Test

Syncs the `dist/` folder to the Android project and opens Android Studio.

```bash
npx cap open android

```

---

## 🤖 COMMANDS (Workflow)

**"INIT [Name]"**

1. **Run** `npm run build`: Always regenerate `dist` before syncing.
2. **Run** `npx cap sync`: Update native plugins and copy assets.

## 📦 Deployment

The project uses **GitHub Actions** to deploy to GitHub Pages.

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
3. Open Android Studio -> Build -> Generate Signed Bundle / APK.
4. Copy the resulting APK to `public/app/signer.apk` manually if distributing via the website.

---

*Built with ❤️ for the Ummah and Humanity.*