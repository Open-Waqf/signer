// playwright.config.ts
import {defineConfig, devices} from '@playwright/test';

// TEST_BUILD=1 (npm run test:build, and CI) tests the production build in dist/ through
// `vite preview`, so build-only bugs are caught before deploy. Default: the dev server.
const testBuild = !!process.env.TEST_BUILD;

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
        baseURL: 'http://localhost:5173',

        // 2. Trace: Record a video/trace on failure so you can see what happened
        trace: 'on-first-retry',
    },

    // 3. Web Server: Start the app before running tests
    webServer: {
        command: testBuild ? 'npx vite preview --port 5173 --strictPort' : 'npm run dev',
        url: 'http://localhost:5173',
        // Never reuse a running dev server when the build is what must be tested.
        reuseExistingServer: !process.env.CI && !testBuild,
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