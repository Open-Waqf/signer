// draft.spec.ts: unfinished work is kept on the device (draft autosave, step 3).
// A reload stands in for Android closing the app in the background.
import {expect, test, type Page} from '@playwright/test';
import {tid} from './support/ui';
import {signAndRead} from './support/audit';

const items = (page: Page) => page.locator('pdf-workspace [data-testid^="annotation-"]');

async function openSampleAndAddDate(page: Page) {
    await page.goto('/');
    await page.getByTestId('btn-sample').click();
    await expect(page.getByTestId('btn-exit')).toBeVisible();
    await tid(page, 'btn-add-date').click();
    await expect(items(page)).toHaveCount(1);
}

/** Wait until the draft is stored (autosave runs half a second after the last change). */
async function draftStored(page: Page) {
    await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve) => {
        const req = indexedDB.open('owq-signer-draft');
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('draft')) { db.close(); resolve(false); return; }
            const get = db.transaction('draft').objectStore('draft').get('state');
            get.onsuccess = () => { db.close(); resolve(!!get.result); };
            get.onerror = () => { db.close(); resolve(false); };
        };
    }))).toBe(true);
}

/** Reload the page; the web asks "leave this page?" when there are unsaved changes. */
async function reload(page: Page) {
    page.once('dialog', (d) => d.accept());
    await page.reload();
    await expect(page.getByTestId('btn-select-file')).toBeVisible();
}

test.describe('19. Unfinished work is kept (draft)', () => {
    test('19.1 After a reload in the middle of an edit, Continue brings the work back @rtl', async ({page}) => {
        await openSampleAndAddDate(page);
        await draftStored(page);
        await reload(page);

        const card = page.getByTestId('draft-card');
        await expect(card).toBeVisible();
        await expect(card).toContainText('sample_document.pdf');
        await expect(card).toContainText('1');
        const box = (await card.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

        await page.getByTestId('btn-draft-continue').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await expect(items(page)).toHaveCount(1);
        await expect(tid(page, 'btn-save')).toBeEnabled();

        // The restored work can be finished like any other.
        const download = page.waitForEvent('download');
        await tid(page, 'btn-save').click();
        await download;
        await expect(page.getByTestId('proof-modal')).toBeVisible();
    });

    test('19.2 Discard removes the draft for good', async ({page}) => {
        await openSampleAndAddDate(page);
        await draftStored(page);
        await reload(page);
        await page.getByTestId('btn-draft-discard').click();
        await expect(page.getByTestId('draft-card')).toBeHidden();
        await page.reload();
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
        await page.waitForTimeout(300);
        expect(await page.getByTestId('draft-card').count()).toBe(0);
    });

    test('19.3 Finish removes the draft', async ({page}) => {
        await openSampleAndAddDate(page);
        await draftStored(page);
        const download = page.waitForEvent('download');
        await tid(page, 'btn-save').click();
        await download;
        await expect(page.getByTestId('proof-modal')).toBeVisible();
        await page.waitForTimeout(300); // let the delete finish
        await page.reload();
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
        await page.waitForTimeout(300);
        expect(await page.getByTestId('draft-card').count()).toBe(0);
    });

    test('19.4 "Leave without saving" removes the draft', async ({page}) => {
        await openSampleAndAddDate(page);
        await draftStored(page);
        await page.getByTestId('btn-exit').click();
        await page.getByTestId('btn-confirm-exit').click();
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
        await page.waitForTimeout(300);
        expect(await page.getByTestId('draft-card').count()).toBe(0);
        await page.reload();
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
        await page.waitForTimeout(300);
        expect(await page.getByTestId('draft-card').count()).toBe(0);
    });

    test('19.5 Nothing placed, nothing kept: opening a file alone makes no draft', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await page.waitForTimeout(800);
        await page.reload();
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
        await page.waitForTimeout(300);
        expect(await page.getByTestId('draft-card').count()).toBe(0);
    });

    test('19.6 A file from another signer: the passed handover check is kept, not asked again', async ({page}) => {
        const first = await signAndRead(page);
        await page.goto('/');
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({name: 'signed.pdf', mimeType: 'application/pdf', buffer: first.pdf});
        await page.getByTestId('btn-handover-check').click();
        await page.getByTestId('input-handover-hash').fill(first.code);
        await page.getByTestId('btn-verify-handover').click();
        await expect(page.getByTestId('handover-modal')).toBeHidden({timeout: 5000});
        await tid(page, 'btn-add-date').click();
        await draftStored(page);
        await reload(page);

        await page.getByTestId('btn-draft-continue').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await expect(items(page)).toHaveCount(1);
        await expect(page.getByTestId('handover-modal')).toBeHidden();

        // The saved file still records the passed check, not a SECURITY ALERT.
        const download = page.waitForEvent('download');
        await tid(page, 'btn-save').click();
        const stream = await (await download).createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const doc = await pdfjs.getDocument({data: new Uint8Array(Buffer.concat(chunks))}).promise;
        const last = await doc.getPage(doc.numPages);
        const text = (await last.getTextContent()).items.map((i: any) => i.str).join(' ');
        await doc.loadingTask.destroy();
        expect(text).toContain('Handover check:');
        expect(text).not.toContain('SECURITY ALERT');
    });
});
