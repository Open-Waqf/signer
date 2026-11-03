# Contributing to Open Waqf Signer

## The "Polyform" License

This project is released under the **Polyform Noncommercial License 1.0.0**.

* **You CAN:** Use this code for personal, educational, or non-profit/Waqf purposes.
* **You CANNOT:** Sell this software or use it for commercial gain without a separate agreement.

## How to Contribute

1. **Security First:** If you find a vulnerability, email security@open-waqf.org. DO NOT open a public issue.
2. **Checks:** Run `npm run check` (typecheck, translations, all tests) before opening a pull request. GitHub runs
   the same checks on every pull request into `develop`.
3. **Translations:** Every text in `src/i18n/locales.ts` must exist in every language (English, Arabic, French, Spanish, Italian).
   `npm run check-i18n` lists anything missing.
4. **No Servers:** Do not submit PRs that add backend dependencies (Firebase, AWS, analytics, etc.). This is a
   client-side app: documents never leave the device.
5. **Dependencies:** Read [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) before upgrading anything.

## Developer Setup

```bash
npm ci
npm run dev       # http://localhost:5173
npm run check     # before every commit
```

More commands (phone, release): see the Development section of the [README](README.md).
