# Dependencies: what ships, what is a tool, and what is pinned

## Two kinds of dependencies

| Kind | Where in package.json | Reaches users? | Examples |
|---|---|---|---|
| **Shipped** | `dependencies` | Yes: bundled into the web app or built into the Android app | lit, pdf-lib, pdfjs-dist, node-forge, @signpdf/*, qrcode, fflate, @capacitor/core and plugins, @capacitor/android |
| **Tools** | `devDependencies` | No: they only run on your machine or in CI | vite, vite-plugin-pwa, typescript, @playwright/test, @capacitor/cli, @types/* |

Rule: if a package is not imported by `src/` and not compiled into the Android app, it is a
tool and belongs in `devDependencies`.

## Security alerts: which ones matter

- `npm audit --omit=dev` lists alerts in **shipped** code. These reach users. Fix them quickly,
  with the full test suite.
- `npm audit` (no flag) also lists alerts in **tools**. They run only on your machine with your
  own files, so they are not urgent. Take the fixes when Dependabot offers them, never with
  `npm audit fix --force` (it downgrades major versions).

## Pinned versions and why

Do not upgrade these, and decline any tool (npm, Dependabot) that offers to.

| What | Kind | Stay on | Why | Before moving on |
|---|---|---|---|---|
| `typescript` | Tool | `6.0.x` | TypeScript 7 ships no `tsserver` (still true for 7.0.2), so IntelliJ loses type checking. | IntelliJ supports TypeScript 7. |

## Upgrade notes (things that broke once, and how they were fixed)

- **Vite 8** reads the `default` export of CommonJS packages as the whole module. The app
  now imports the named class `SignPdf` from `@signpdf/signpdf`. Test 4.5 (certificate
  signing) fails if this comes back.
- **pdf.js 6** (`pdfjs-dist`):
  - `PDFDocumentProxy.destroy()` is gone. Call `doc.loadingTask.destroy()`.
  - JBIG2 and CCITT (fax) images, common in scans, are decoded with files in
    `public/wasm/`, passed as `wasmUrl`. Without them those pages render blank, with no
    error. Test 11.1 catches this.
  - After each pdf.js upgrade, copy `cmaps/`, `standard_fonts/` and the four jbig2 files
    from `node_modules/pdfjs-dist/` into `public/`. Never ship `quickjs-eval.*` (it runs
    JavaScript from PDFs).
  - Versions 5.6.83 up to (not including) 6.2.108 have a JavaScript-execution advisory.
    Never go back into that range.
  - pdf.js 6 needs a newer browser engine. Phones whose Android System WebView no longer
    updates (mostly Android 7) may fail to show PDFs.
- **Android Gradle Plugin 9 / Gradle 9**: the app's `build.gradle` uses
  `proguard-android-optimize.txt` (AGP 9 rejects `proguard-android.txt`). Upgrade Gradle
  with `./gradlew wrapper --gradle-version <x>` from the `android/` folder.
- **AGP must not be newer than Android Studio supports**, or Studio refuses to sync.
  Android Studio 2025.3 supports AGP up to 9.2 (we use 9.2.1). Update Studio first
  (JetBrains Toolbox), then take the AGP version its upgrade assistant offers.

## Traps to keep

- `vite.config.ts` keeps `optimizeDeps: {entries: ['index.html']}`. Without it, a cold
  Vite cache also scans the web copy that `cap sync` puts in
  `android/app/src/main/assets/public`, and the tests fail.
- Node 22 or newer (`.nvmrc`, `engines` in `package.json`): the Capacitor 8 CLI needs it.
- Keep the `@capacitor/*` packages on the same minor version (for example all 8.5.x).

## Other exact versions (no known trap)

`@capacitor/status-bar` `8.0.4`, `lit` `3.3.3`, `node-forge` `1.4.2`, `pdf-lib` `1.17.1`
and `@playwright/test` `1.64.0` are written as exact versions, but nothing is known to
break on newer releases. Update them like any other package, with the full test suite.
`node-forge` parses user certificates, so take its security releases quickly.
`pdfjs-dist` is exact on purpose: the files copied into `public/` (cmaps, fonts, wasm) must
match its version, so upgrade it by hand following the notes above.
