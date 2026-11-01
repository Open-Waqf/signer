// rtl.spec.ts: right-to-left layout checks, on a phone screen in Arabic.
// Tagged @rtl-only: they run only in the phone-ar project (Pixel 5, locale ar).
import {expect, test, type Locator, type Page} from '@playwright/test';
import {tid} from './support/ui';

test.use({permissions: ['clipboard-read', 'clipboard-write']});

async function expectOnScreen(page: Page, locator: Locator) {
    const box = await locator.boundingBox();
    const width = page.viewportSize()!.width;
    expect(box, 'element should be rendered').not.toBeNull();
    expect(box!.x, 'left edge on screen').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, 'right edge on screen').toBeLessThanOrEqual(width);
}

const noSidewaysScroll = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function openSample(page: Page) {
    await page.goto('/');
    await page.getByTestId('btn-sample').click();
    await expect(page.getByTestId('btn-exit')).toBeVisible();
}

test.describe('13. Arabic, right to left @rtl-only', () => {
    test('13.1 Home is right-to-left and nothing sticks out sideways', async ({page}) => {
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
        expect(await noSidewaysScroll(page)).toBe(true);
        await expectOnScreen(page, page.getByTestId('btn-select-file'));
        await expectOnScreen(page, page.getByTestId('btn-share-app'));
    });

    test('13.2 Editor: Finish and the main tools are on screen', async ({page}) => {
        await openSample(page);
        expect(await noSidewaysScroll(page)).toBe(true);
        await expectOnScreen(page, tid(page, 'btn-save'));
        await expectOnScreen(page, tid(page, 'btn-add-sig'));
        await expectOnScreen(page, page.getByTestId('btn-exit'));
    });

    test('13.3 The Saved sheet is fully on screen', async ({page}) => {
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        const download = page.waitForEvent('download');
        await tid(page, 'btn-save').click();
        await download;
        await expect(page.getByTestId('proof-modal')).toBeVisible();
        await expectOnScreen(page, page.getByTestId('btn-close-proof'));
        await page.getByTestId('btn-saved-details').click();
        await expectOnScreen(page, page.getByTestId('btn-copy-hash'));
        await expectOnScreen(page, page.getByTestId('saved-doc-hash'));
    });

    test('13.4 A toast (Share App, "link copied") is on screen', async ({page}) => {
        // Known bugs O4 / P1: in Arabic the toast is placed mostly off the left edge.
        test.fixme(true, 'Bug O4/P1: toasts are off-screen in Arabic');
        await page.goto('/');
        await page.getByTestId('btn-share-app').click();
        const toast = page.locator('.toast.show');
        await expect(toast).toBeVisible();
        await page.waitForTimeout(400); // let the slide-in finish
        await expectOnScreen(page, toast);
    });
});
