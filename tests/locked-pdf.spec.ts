// locked-pdf.spec.ts: a password-protected PDF is refused when it opens, with a clear
// message, instead of failing at Finish after all the work (October audit).
// Fixtures made with pypdf (RC4-128): locked-open.pdf needs "open123" to open;
// locked-owner.pdf opens freely but has an owner password ("owner123").
import fs from 'node:fs';
import {expect, test} from '@playwright/test';

for (const file of ['locked-open.pdf', 'locked-owner.pdf']) {
    test(`25.1 ${file}: stays on the home screen and says the file is password-protected @rtl`, async ({page}) => {
        await page.goto('/');
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({name: file, mimeType: 'application/pdf', buffer: fs.readFileSync(`tests/fixtures/${file}`)});
        await expect(page.locator('.toast.show')).toContainText(/password-protected|محمي بكلمة مرور|protégé par un mot de passe/);
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
        expect(await page.getByTestId('btn-exit').isVisible()).toBe(false);
    });
}
