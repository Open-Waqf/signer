# Contributing to Open Waqf Signer

## The "Polyform" License

This project is released under the **Polyform Noncommercial License 1.0.0**.

* **You CAN:** Use this code for personal, educational, or non-profit/Waqf purposes.
* **You CANNOT:** Sell this software or use it for commercial gain without a separate agreement.

## How to Contribute

1. **Security First:** If you find a vulnerability, email security@open-waqf.org. DO NOT open a public issue.
2. **Code Style:** We use TypeScript + Lit. Please run `npm test` before pushing.
3. **No Servers:** Do not submit PRs that add backend dependencies (Firebase, AWS, etc.). This is a Sovereign
   Client-Side app.

## Developer Setup

```bash
npm install
npm run dev
npx playwright test