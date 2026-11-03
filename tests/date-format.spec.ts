// date-format.spec.ts: a placed date in three formats, with Hijri (step 5).
import {devices, expect, test, type Page} from '@playwright/test';
import {tid} from './support/ui';

async function openSample(page: Page) {
    await page.goto('/');
    await page.getByTestId('btn-sample').click();
    await expect(page.getByTestId('btn-exit')).toBeVisible();
}

const dates = (page: Page) => page.locator('pdf-workspace [data-testid^="annotation-"] .text-content');

/** What the browser's own calendar says for today, in the page's language. */
const expected = (page: Page, format: 'long' | 'hijri') => page.evaluate((f) => {
    const lang = document.documentElement.lang || 'en';
    const loc = lang.startsWith('en') ? 'en-GB' : lang.slice(0, 2);
    return new Intl.DateTimeFormat(`${loc}${f === 'hijri' ? '-u-ca-islamic-umalqura' : ''}`,
        {day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn'}).format(new Date());
}, format);

test.describe('22. Date formats', () => {
    test('22.1 The date is day/month/year numbers by default', async ({page}) => {
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        await expect(dates(page)).toHaveCount(1);
        expect((await dates(page).textContent())!.replace(/‎/g, '').trim()).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    });

    test('22.2 Written-out and Hijri dates; the choice is remembered for the next date @rtl', async ({page}) => {
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        const menu = page.getByTestId('select-date-format');
        await expect(menu).toBeVisible();

        await menu.selectOption('long');
        await expect(dates(page).first()).toContainText(await expected(page, 'long'));

        await menu.selectOption('hijri');
        const hijri = await expected(page, 'hijri');
        await expect(dates(page).first()).toContainText(hijri);
        expect(hijri).toMatch(/AH|هـ/);

        // The next date uses Hijri straight away, also after a reload.
        page.once('dialog', (d) => d.accept());
        await page.reload();
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await tid(page, 'btn-add-date').click();
        await expect(dates(page).first()).toContainText(hijri);
    });

    test('22.3 Undo brings the previous format back', async ({page}) => {
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        const before = (await dates(page).textContent())!.trim();
        await page.getByTestId('select-date-format').selectOption('long');
        await expect(dates(page).first()).not.toHaveText(before);
        await page.getByTestId('btn-undo').click();
        await expect(dates(page).first()).toHaveText(before);
    });

    test('22.4 "Add text" has no date format menu', async ({page}) => {
        await openSample(page);
        await tid(page, 'btn-toggle-advanced').click();
        await tid(page, 'btn-add-text').click();
        await expect(page.getByTestId('style-popup')).toBeVisible();
        expect(await page.getByTestId('select-date-format').count()).toBe(0);
    });

    test('22.5 A Hijri date can still be corrected by hand (a local moon sighting can differ by a day)', async ({page}) => {
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        await page.getByTestId('select-date-format').selectOption('hijri');
        await page.getByTestId('btn-edit-text').click();
        await page.getByTestId('input-custom-prompt').fill('22 Jumada I 1448 AH');
        await page.getByTestId('btn-save-prompt').click();
        await expect(dates(page).first()).toContainText('22 Jumada I 1448 AH');
    });

    test('22.6 On a small phone the style bar never covers the date, in the middle or near the top', async ({browser}) => {
        for (const locale of ['en', 'ar']) {
            const ctx = await browser.newContext({...devices['Pixel 5'], viewport: {width: 360, height: 740}, locale});
            const page = await ctx.newPage();
            await openSample(page);
            await page.getByTestId('m-btn-add-date').click();
            for (const yPct of [0.4, 0.02]) {
                await page.locator('pdf-workspace').evaluate((el: any, y) => {
                    el.annotations = el.annotations.map((a: any) => ({...a, yPct: y}));
                }, yPct);
                await page.waitForTimeout(300);
                const bar = (await page.getByTestId('style-popup').boundingBox())!;
                const date = (await dates(page).boundingBox())!;
                const overlaps = bar.y < date.y + date.height && date.y < bar.y + bar.height;
                expect(overlaps, `${locale}, date at ${yPct}: bar and date overlap`).toBe(false);
            }
            await ctx.close();
        }
    });

    test('22.7 Arabic dates read right to left on the page, and the saved PDF shows the ink @rtl', async ({page}) => {
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        await page.getByTestId('select-date-format').selectOption('hijri');
        const text = dates(page).first();
        const isArabic = await page.evaluate(() => document.documentElement.lang === 'ar');
        await expect.poll(() => text.evaluate((el) => getComputedStyle(el).direction)).toBe(isArabic ? 'rtl' : 'ltr');
        // The delete button covers none of the text.
        const covered = await text.evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const ink = range.getBoundingClientRect();
            const del = el.closest('.draggable')!.querySelector('.delete-btn')!.getBoundingClientRect();
            return Math.max(0, Math.min(ink.right, del.right) - Math.max(ink.left, del.left));
        });
        expect(covered, 'pixels of text under the delete button').toBe(0);

        const download = page.waitForEvent('download');
        await tid(page, 'btn-save').click();
        const stream = await (await download).createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const doc = await pdfjs.getDocument({data: new Uint8Array(Buffer.concat(chunks))}).promise;
        const p = await doc.getPage(1);
        const ops = await p.getOperatorList();
        const i = ops.fnArray.indexOf(pdfjs.OPS.paintImageXObject);
        expect(i).toBeGreaterThan(-1);
        const name = ops.argsArray[i][0];
        const img: any = await new Promise((resolve) => p.objs.get(name, resolve));
        // Count pixels with ink (RGBA: visible and dark).
        const step = img.kind === 3 ? 4 : 3;
        let ink = 0;
        for (let k = 0; k + step - 1 < img.data.length; k += step) {
            const visible = step === 4 ? img.data[k + 3] > 64 : true;
            if (visible && img.data[k] < 128) ink++;
        }
        await doc.loadingTask.destroy();
        expect(ink, 'the date image is not blank').toBeGreaterThan(100);
    });
});
