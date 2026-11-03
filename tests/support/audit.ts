// audit.ts: sign a PDF with the audit page on and read the audit page back.
import {expect, type Page} from '@playwright/test';
import {tid} from './ui';

// Sign the sample, or a given signed PDF (skipping the handover check, or passing it with
// `handoverCode`), with the audit page on. Returns the saved PDF, the text of its audit page
// (the last page) and the code for the next signer.
export async function signAndRead(page: Page, signedPdf?: Buffer, handoverCode?: string): Promise<{pdf: Buffer; text: string; code: string}> {
    await page.goto('/');
    if (signedPdf) {
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({name: 'signed.pdf', mimeType: 'application/pdf', buffer: signedPdf});
        // A file from another signer shows a banner; the code check opens from it.
        await expect(page.getByTestId('handover-banner')).toBeVisible();
        if (handoverCode) {
            await page.getByTestId('btn-handover-check').click();
            await page.getByTestId('input-handover-hash').fill(handoverCode);
            await page.getByTestId('btn-verify-handover').click();
            await expect(page.getByTestId('handover-modal')).toBeHidden({timeout: 5000});
        }
        // No code: just go on signing (it counts as "not checked").
    } else {
        await page.getByTestId('btn-sample').click();
    }
    await expect(page.getByTestId('btn-exit')).toBeVisible();
    if (!(await tid(page, 'btn-toggle-audit').isVisible())) await tid(page, 'btn-toggle-advanced').click();
    const audit = tid(page, 'btn-toggle-audit');
    if ((await audit.getAttribute('aria-pressed')) !== 'true') await audit.click();
    await tid(page, 'btn-add-date').click();
    const download = page.waitForEvent('download');
    await tid(page, 'btn-save').click();
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const pdf = Buffer.concat(chunks);
    await page.getByTestId('btn-saved-details').click();
    const code = (await page.getByTestId('saved-handover-code').innerText()).trim();

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({data: new Uint8Array(pdf)}).promise;
    const last = await doc.getPage(doc.numPages);
    const text = (await last.getTextContent()).items.map((i: any) => i.str).join(' ');
    await doc.loadingTask.destroy();
    return {pdf, text, code};
}

