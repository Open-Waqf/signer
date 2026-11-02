// playwright.config.ts
import {defineConfig, devices} from '@playwright/test';

// TEST_BUILD=1 (npm run test:build, and CI) tests the production build in dist/ through
// `vite preview`, so build-only bugs are caught before deploy. Default: the dev server.
const testBuild = !!process.env.TEST_BUILD;

// Tests always start their own fresh server on their own port, never one already running.
// A dev server left running for hours kept serving an old copy of a removed package, so
// local checks passed while CI failed (certificate signing, Nov 2026). A separate port also
// lets `npm run dev` or `npm run android:live` (port 5173) keep running during a check.
const PORT = 5174;

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    // Fail the build on CI if you accidentally left test.only in the source code.
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // At most 4 browsers at once locally: more crash pages on a 14 GB machine. One on CI.
    workers: process.env.CI ? 1 : 4,
    // List in the terminal; the HTML report is written but never opens by itself
    // (it would block `npm run check`). Open it with `npx playwright show-report`.
    reporter: [['list'], ['html', {open: 'never'}]],

    use: {
        // 1. Base URL: Matches your local Vite dev server
        baseURL: `http://localhost:${PORT}`,

        // 2. Trace: Record a video/trace on failure so you can see what happened
        trace: 'on-first-retry',
    },

    // 3. Web Server: Start the app before running tests
    webServer: {
        command: testBuild ? `npx vite preview --port ${PORT} --strictPort` : `npx vite --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 120 * 1000,
    },

    // Three ways to run the same tests (tags in test titles choose who runs what):
    //   phone     every test on a phone screen (Pixel 5, touch), except @desktop and @rtl-only
    //   phone-ar  the @rtl and @rtl-only tests on a phone screen in Arabic (right-to-left)
    //   desktop   every test on a desktop screen, except @phone and @rtl-only
    // `npm run check` runs phone + phone-ar (about as fast as one run). GitHub runs all three.
    projects: [
        {
            name: 'phone',
            use: {...devices['Pixel 5'], locale: 'en-US'},
            grepInvert: /@desktop|@rtl-only/,
        },
        {
            name: 'phone-ar',
            use: {...devices['Pixel 5'], locale: 'ar'},
            grep: /@rtl/,
        },
        {
            name: 'desktop',
            use: {...devices['Desktop Chrome'], locale: 'en-US'},
            grepInvert: /@phone|@rtl-only/,
        },
    ],
});