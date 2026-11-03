// handover-banner.spec.ts: a file from another signer shows a banner, never a blocking
// question; the code can still be checked from the banner (step 6).
import {expect, test, type Page} from '@playwright/test';
import {signAndRead} from './support/audit';
import {tid} from './support/ui';
import {openDialogs} from './support/native-fake';

async function openSigned(page: Page, pdf: Buffer) {
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('btn-select-file').click();
    (await chooser).setFiles({name: 'signed.pdf', mimeType: 'application/pdf', buffer: pdf});
    await expect(page.getByTestId('btn-exit')).toBeVisible();
}

test.describe('24. Handover banner @phone', () => {
    test('24.1 Nothing blocks signing: a banner, no question, and the date can be added at once', async ({page}) => {
        const first = await signAndRead(page);
        await openSigned(page, first.pdf);
        const banner = page.getByTestId('handover-banner');
        await expect(banner).toBeVisible();
        await expect(banner).toHaveAttribute('data-checked', 'false');
        expect(await openDialogs(page)).toEqual([]);
        await tid(page, 'btn-add-date').click();
        await expect(page.locator('pdf-workspace [data-testid^="annotation-"]')).toHaveCount(1);
    });

    test('24.2 Checking the code from the banner turns it green', async ({page}) => {
        const first = await signAndRead(page);
        await openSigned(page, first.pdf);
        await page.getByTestId('btn-handover-check').click();
        await page.getByTestId('input-handover-hash').fill(first.code);
        await page.getByTestId('btn-verify-handover').click();
        await expect(page.getByTestId('handover-modal')).toBeHidden({timeout: 5000});
        await expect(page.getByTestId('handover-banner')).toHaveAttribute('data-checked', 'true');
        expect(await page.getByTestId('btn-handover-check').count()).toBe(0);
    });

    test('24.3 The banner can be closed', async ({page}) => {
        const first = await signAndRead(page);
        await openSigned(page, first.pdf);
        await page.getByTestId('btn-handover-banner-close').click();
        await expect(page.getByTestId('handover-banner')).toBeHidden();
    });

    test('24.4 A file signed only by you shows no banner', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        expect(await page.getByTestId('handover-banner').count()).toBe(0);
    });
});
