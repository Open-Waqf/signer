// languages.spec.ts: every language in the picker switches the app (Spanish and Italian added).
import {expect, test} from '@playwright/test';

for (const [lang, select] of [['es', 'Seleccionar PDF'], ['it', 'Seleziona PDF']]) {
    test(`27.1 ${lang}: the app opens in that language and keeps left-to-right @phone`, async ({page}) => {
        await page.goto(`/?lang=${lang}`);
        await expect(page.getByTestId('btn-select-file')).toHaveText(select);
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    });
}

for (const lang of ['en', 'ar', 'fr', 'es', 'it']) {
    test(`27.2 ${lang}: the sample PDF opens in that language`, async ({page}) => {
        await page.goto(`/?lang=${lang}`);
        const request = page.waitForResponse((r) => r.url().endsWith(`/sample_document.${lang}.pdf`) && r.ok());
        await page.getByTestId('btn-sample').click();
        await request;
        await expect(page.getByTestId('btn-exit')).toBeVisible();
    });
}
