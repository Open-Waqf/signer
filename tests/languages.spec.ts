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
