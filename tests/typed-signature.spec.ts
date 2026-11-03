// typed-signature.spec.ts: sign by typing your name in a handwriting font (step 5).
import fs from 'node:fs';
import {expect, test, type Page} from '@playwright/test';
import {tid} from './support/ui';

async function openPad(page: Page) {
    await page.goto('/');
    await page.getByTestId('btn-sample').click();
    await expect(page.getByTestId('btn-exit')).toBeVisible();
    await tid(page, 'btn-add-sig').click();
    await expect(page.getByTestId('signature-pad')).toBeVisible();
}

/** How many pixels of the pad have ink, and the inked area's width and height. */
const padInk = (page: Page) => page.getByTestId('signature-pad').evaluate((c: HTMLCanvasElement) => {
    const {data, width, height} = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let count = 0, minX = width, maxX = -1, minY = height, maxY = -1;
    for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
        if (data[(y * width + x) * 4 + 3] > 8) {
            count++;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
    }
    return {count, w: maxX - minX, h: maxY - minY};
});

const items = (page: Page) => page.locator('pdf-workspace [data-testid^="annotation-"]');

test.describe('21. Typed signature', () => {
    test('21.1 Typing a name signs the document; the saved PDF carries it', async ({page}) => {
        await openPad(page);
        await page.getByTestId('btn-sig-type').click();
        await page.getByTestId('input-typed-sig').fill('Amina Haddad');
        await expect.poll(async () => (await padInk(page)).count).toBeGreaterThan(200);
        const ink = await padInk(page);
        expect(ink.w, 'a name is wider than tall').toBeGreaterThan(ink.h * 2);

        await page.getByTestId('btn-save-sig').click();
        await expect(items(page)).toHaveCount(1);

        const download = page.waitForEvent('download');
        await tid(page, 'btn-save').click();
        const stream = await (await download).createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        // The saved page has exactly one picture more than the sample (whose text lines are
        // pictures too, so Arabic is shaped right): the typed signature.
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const images = async (data: Uint8Array) => {
            const doc = await pdfjs.getDocument({data}).promise;
            const ops = await (await doc.getPage(1)).getOperatorList();
            await doc.loadingTask.destroy();
            return ops.fnArray.filter((f: number) => f === pdfjs.OPS.paintImageXObject).length;
        };
        const sample = new Uint8Array(fs.readFileSync('public/sample_document.en.pdf'));
        expect(await images(new Uint8Array(Buffer.concat(chunks)))).toBe((await images(sample)) + 1);
    });

    test('21.2 Every handwriting style loads (the font files ship with the app, offline)', async ({page}) => {
        await openPad(page);
        await page.getByTestId('btn-sig-type').click();
        for (const [id, family] of [['script', 'OWQ Script'], ['ruqaa', 'OWQ Ruqaa'], ['amiri', 'Amiri']]) {
            await page.getByTestId(`btn-sig-font-${id}`).click();
            await expect(page.getByTestId(`btn-sig-font-${id}`)).toHaveAttribute('aria-pressed', 'true');
            await expect.poll(() => page.evaluate((f) => document.fonts.check(`20px "${f}"`), family),
                `${family} is loaded`).toBe(true);
        }
    });

    test('21.3 An Arabic name in Ruqaa style @rtl', async ({page}) => {
        await openPad(page);
        await page.getByTestId('btn-sig-type').click();
        await page.getByTestId('btn-sig-font-ruqaa').click();
        await page.getByTestId('input-typed-sig').fill('أمينة الحداد');
        await expect.poll(async () => (await padInk(page)).count).toBeGreaterThan(200);
        await page.getByTestId('btn-save-sig').click();
        await expect(items(page)).toHaveCount(1);
    });

    test('21.4 A typed signature can be saved as a preset and is offered next time', async ({page}) => {
        await openPad(page);
        await page.getByTestId('btn-sig-type').click();
        await page.getByTestId('input-typed-sig').fill('Amina');
        await expect.poll(async () => (await padInk(page)).count).toBeGreaterThan(100);
        await page.getByTestId('btn-save-preset').click();
        await page.getByTestId('btn-confirm-preset').click();
        await expect(page.locator('[data-testid^="preset-"] img')).toHaveCount(1);
        await page.getByTestId('btn-save-sig').click();
        await expect(items(page)).toHaveCount(1);

        // Next time: Type is still chosen, and the preset is there.
        await tid(page, 'btn-add-sig').click();
        await expect(page.getByTestId('btn-sig-type')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-testid^="preset-"] img')).toHaveCount(1);
    });

    test('21.5 Drawing still works, and Type does not draw on the pad', async ({page}) => {
        await openPad(page);
        await page.getByTestId('btn-clear-sig').click();
        await page.getByTestId('btn-sig-type').click();
        const box = (await page.getByTestId('signature-pad').boundingBox())!;
        const stroke = async () => {
            await page.mouse.move(box.x + 30, box.y + 40);
            await page.mouse.down();
            await page.mouse.move(box.x + 120, box.y + 80, {steps: 8});
            await page.mouse.up();
        };
        await stroke();
        expect((await padInk(page)).count, 'no ink in Type mode').toBe(0);
        await page.getByTestId('btn-sig-draw').click();
        await stroke();
        await expect.poll(async () => (await padInk(page)).count).toBeGreaterThan(20);
    });
});
