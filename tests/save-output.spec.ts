// save-output.spec.ts: what the saved file contains.
import {expect, test, type Page} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
import {tid} from './support/ui';

async function open(page: Page, pdf: Buffer, name = 'doc.pdf') {
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('btn-select-file').click();
    (await chooser).setFiles({name, mimeType: 'application/pdf', buffer: pdf});
    await expect(page.getByTestId('btn-exit')).toBeVisible();
}

async function save(page: Page): Promise<Buffer> {
    const download = page.waitForEvent('download');
    await tid(page, 'btn-save').click();
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    await expect(page.getByTestId('proof-modal')).toBeVisible();
    return Buffer.concat(chunks);
}

const imageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;

test.describe('26. Saved file @phone', () => {
    test('26.1 "Apply to all pages" stores the picture once, not once per page', async ({page}) => {
        const doc = await PDFDocument.create();
        for (let i = 0; i < 10; i++) doc.addPage([595, 842]);
        await open(page, Buffer.from(await doc.save()));
        await tid(page, 'btn-add-date').click();
        await page.getByTestId('btn-apply-all').click();
        await expect(page.locator('.toast.show')).toContainText('9');
        const pdf = await save(page);
        // One date picture (plus at most its transparency mask), whatever the page count.
        expect(imageCount(pdf)).toBeLessThanOrEqual(2);
        expect(imageCount(pdf)).toBeGreaterThan(0);
    });

    test('26.2 A second signer\'s footer does not print over the first', async ({page}) => {
        const footerOn = async () => {
            const footer = page.getByTestId('btn-toggle-footer');
            if (!(await footer.isVisible())) await tid(page, 'btn-toggle-advanced').click(); // "More tools" is remembered
            if ((await footer.getAttribute('aria-pressed')) !== 'true') await footer.click();
            await tid(page, 'btn-add-date').click();
        };
        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await footerOn();
        const first = await save(page);
        await open(page, first, 'first.pdf');
        await footerOn();
        const second = await save(page);

        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const doc = await pdfjs.getDocument({data: new Uint8Array(second)}).promise;
        const items = (await (await doc.getPage(1)).getTextContent()).items as any[];
        const ys = items.filter((it) => String(it.str).startsWith('Signed via Open Waqf')).map((it) => it.transform[5]);
        await doc.loadingTask.destroy();
        expect(ys).toHaveLength(2);
        expect(Math.abs(ys[0] - ys[1]), 'footers on separate lines').toBeGreaterThan(5);
    });
});
