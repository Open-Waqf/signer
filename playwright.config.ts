// playwright.config.ts
import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    // Fail the build on CI if you accidentally left test.only in the source code.
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',

    use: {
        // 1. Base URL: Matches your local Vite dev server
        baseURL: 'http://localhost:5173',

        // 2. Trace: Record a video/trace on failure so you can see what happened
        trace: 'on-first-retry',
    },

    // 3. Web Server: Start the app before running tests
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },

    projects: [
        {
            name: 'chromium',
            use: {...devices['Desktop Chrome']},
        },
        // You can uncomment Firefox/Safari later if you want
    ],
});