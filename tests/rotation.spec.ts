// rotation.spec.ts: an item lands in the saved file where it was on screen, also on turned
// (/Rotate) and cropped (CropBox) pages, common in scans (step 4, audit P1-1 and P1-2).
// The saved PDF is read back with pdf.js, which shows pages the same way the editor does.
import {expect, test, type Page} from '@playwright/test';
import {degrees, PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import {tid} from './support/ui';

type Shape = {name: string; rotate?: number; crop?: [number, number, number, number]};

const SHAPES: Shape[] = [
    {name: 'plain'},
    {name: 'turned 90', rotate: 90},
    {name: 'turned 180', rotate: 180},
    {name: 'turned 270', rotate: 270},
    {name: 'cropped', crop: [100, 150, 380, 520]},
    {name: 'cropped and turned 90', rotate: 90, crop: [100, 150, 380, 520]},
];

async function makePdf(shape: Shape): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]); // portrait, unturned
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Top of the page', {x: 120, y: 640, size: 18, font, color: rgb(0, 0, 0)});
    if (shape.crop) page.setCropBox(...shape.crop);
    if (shape.rotate) page.setRotation(degrees(shape.rotate));
    return Buffer.from(await doc.save());
}

async function openPdf(page: Page, pdf: Buffer) {
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('btn-select-file').click();
    (await chooser).setFiles({name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf});
    await expect(page.getByTestId('btn-exit')).toBeVisible();
}

async function saveAndRead(page: Page): Promise<Buffer> {
    const download = page.waitForEvent('download');
    await tid(page, 'btn-save').click();
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

type Box = {left: number; top: number; right: number; bottom: number};

/**
 * Where each image and each text run of page 1 is shown, as fractions of the shown page
 * (0,0 = top left), the way a PDF reader shows it.
 */
async function shownPositions(pdf: Buffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({data: new Uint8Array(pdf)}).promise;
    const p = await doc.getPage(1);
    const vp = p.getViewport({scale: 1});
    const toShown = (x: number, y: number) => {
        const [u, v] = vp.convertToViewportPoint(x, y);
        return [u / vp.width, v / vp.height];
    };

    const images: Box[] = [];
    const ops = await p.getOperatorList();
    type M = number[];
    const mul = (m: M, n: M): M => [ // m then n
        m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
        m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
        m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
    ];
    let ctm: M = [1, 0, 0, 1, 0, 0];
    const stack: M[] = [];
    ops.fnArray.forEach((fn: number, i: number) => {
        if (fn === pdfjs.OPS.save) stack.push(ctm);
        else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === pdfjs.OPS.transform) ctm = mul(ops.argsArray[i] as M, ctm);
        else if (fn === pdfjs.OPS.paintImageXObject) {
            const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) =>
                toShown(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
            // Which corner of the image ends up top left tells if it is shown upright.
            const [tlX, tlY] = toShown(ctm[2] + ctm[4], ctm[3] + ctm[5]); // image's own top-left
            const xs = corners.map((c) => c[0]);
            const ys = corners.map((c) => c[1]);
            const box = {left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys)};
            images.push({...box, upright: Math.abs(tlX - box.left) < 1e-6 && Math.abs(tlY - box.top) < 1e-6} as any);
        }
    });

    const texts = (await p.getTextContent()).items.map((it: any) => {
        const [x, y] = toShown(it.transform[4], it.transform[5]);
        return {str: it.str as string, x, y};
    });
    await doc.loadingTask.destroy();
    return {images: images as Array<Box & {upright: boolean}>, texts};
}

test.describe('20. Turned and cropped pages', () => {
    for (const shape of SHAPES) {
        test(`20.1 The date lands where it was placed, upright: ${shape.name} page`, async ({page}) => {
            await openPdf(page, await makePdf(shape));
            await tid(page, 'btn-add-date').click();
            const ws = page.locator('pdf-workspace');
            await expect(ws.locator('[data-testid^="annotation-"]')).toHaveCount(1);
            const ann = await ws.evaluate((el: any) => el.annotations[0]);

            const {images} = await shownPositions(await saveAndRead(page));
            expect(images).toHaveLength(1);
            const img = images[0];
            expect(img.upright, 'shown upright, not turned').toBe(true);
            expect(img.right - img.left, 'a date is wider than tall').toBeGreaterThan(img.bottom - img.top);
            expect(Math.abs(img.left - ann.xPct), 'left edge').toBeLessThan(0.01);
            expect(Math.abs(img.top - ann.yPct), 'top edge').toBeLessThan(0.01);
        });
    }

    for (const shape of SHAPES.filter((s) => s.rotate || s.crop)) {
        test(`20.2 The footer is at the bottom of the shown page: ${shape.name} page`, async ({page}) => {
            await openPdf(page, await makePdf(shape));
            await tid(page, 'btn-toggle-advanced').click();
            await page.getByTestId('btn-toggle-footer').click();
            await tid(page, 'btn-add-date').click();
            const {texts} = await shownPositions(await saveAndRead(page));
            const footer = texts.find((t) => t.str.startsWith('Signed via Open Waqf'));
            expect(footer).toBeTruthy();
            expect(footer!.y, 'near the bottom').toBeGreaterThan(0.95);
            expect(footer!.y, 'on the page').toBeLessThanOrEqual(1);
            expect(footer!.x, 'starts left of the middle').toBeGreaterThan(0.05);
            expect(footer!.x).toBeLessThan(0.5);
        });
    }
});
