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

Do not upgrade these, and decline any tool (npm, Dependabot, Android Studio) that offers to.

| What | Kind | Stay on | Why | Status (November 2026) |
|---|---|---|---|---|
| `pdfjs-dist` | Shipped | `5.4.624` (exact) | 5.6.83 up to (not including) 6.2.108 has a JavaScript-execution advisory. 6.x removes `PDFDocumentProxy.destroy()`, needs a `wasmUrl` for JBIG2 and CCITT scans, and raises the minimum browser (Android WebView). | Upgrade to 6.4.299 tested and works (call `loadingTask.destroy()`, ship the jbig2 files in `public/wasm/`). Open question: older phones whose WebView no longer updates. |
| `vite` | Tool | `^7` (7.x only) | Vite 8 reads the default export of CommonJS packages differently, so `@signpdf/signpdf` gave the wrong object and `.p12` signing failed (test 4.5). | Fix found: import the named class `SignPdf`. With it, all tests pass on Vite 8, dev and production build. |
| `typescript` | Tool | `6.0.x` | TypeScript 7 ships no `tsserver`, so IntelliJ loses type checking. Still true for 7.0.2. | Keep. |
| Android Gradle Plugin / Gradle | Tool | AGP `8.13`, Gradle `8.14.3` | AGP 9 rejected `proguard-android.txt`, which the Capacitor 8 plugins used. | The upgraded plugins now use `proguard-android-optimize.txt`. AGP 9.5 + Gradle 9.8.2 build debug and release once the app's own `build.gradle` does the same. Needs a phone check. |

## Traps to keep

- `vite.config.ts` keeps `optimizeDeps: {entries: ['index.html']}`. Without it, a cold
  Vite cache also scans the web copy that `cap sync` puts in
  `android/app/src/main/assets/public`, and the tests fail.
- Node 22 or newer (`.nvmrc`, `engines` in `package.json`): the Capacitor 8 CLI needs it.
- Keep the `@capacitor/*` packages on the same minor version (for example all 8.5.x).

## Other exact versions (no known trap)

`@capacitor/status-bar` `8.0.4`, `lit` `3.3.3`, `node-forge` `1.4.0`, `pdf-lib` `1.17.1`
and `@playwright/test` `1.64.0` are written as exact versions, but nothing is known to
break on newer releases. Update them like any other package, with the full test suite.
`node-forge` parses user certificates, so take its security releases quickly.
