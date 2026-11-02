// timestamp.spec.ts: what the audit page says about the timestamp (O5).
import {expect, test, type Page} from '@playwright/test';
import {tid} from './support/ui';

// A minimal RFC 3161 reply (status 0 = granted, plus a token), as FreeTSA sends through the relay.
async function tsaReply(): Promise<Buffer> {
    const mod = await import('node-forge');
    const forge = (mod as any).default ?? (mod as any);
    const asn1 = forge.asn1;
    const reply = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(0x00)),
        ]),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(0x01)),
        ]),
    ]);
    return Buffer.from(asn1.toDer(reply).getBytes(), 'binary');
}

// Sign (the sample, or a given signed PDF) with the audit page on. Returns the saved PDF
// and the text of its audit page (the last page).
async function signAndRead(page: Page, signedPdf?: Buffer): Promise<{pdf: Buffer; text: string}> {
    await page.goto('/');
    if (signedPdf) {
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({name: 'signed.pdf', mimeType: 'application/pdf', buffer: signedPdf});
        await page.getByTestId('btn-skip-handover').click(); // no handover code in this test
    } else {
        await page.getByTestId('btn-sample').click();
    }
    await expect(page.getByTestId('btn-exit')).toBeVisible();
    if (!(await page.getByTestId('btn-toggle-audit').isVisible())) await tid(page, 'btn-toggle-advanced').click();
    const audit = page.getByTestId('btn-toggle-audit');
    if ((await audit.getAttribute('aria-pressed')) !== 'true') await audit.click();
    await tid(page, 'btn-add-date').click();
    const download = page.waitForEvent('download');
    await tid(page, 'btn-save').click();
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const pdf = Buffer.concat(chunks);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({data: new Uint8Array(pdf)}).promise;
    const last = await doc.getPage(doc.numPages);
    const text = (await last.getTextContent()).items.map((i: any) => i.str).join(' ');
    await doc.loadingTask.destroy();
    return {pdf, text};
}

const NOW = 'Requested when signing; the result is stored in the file, not on this page';
const TOKEN = 'RFC 3161 token from FreeTSA (stored, not checked by this app)';
const CLOCK = 'Device clock (no timestamp token)';

test.describe('16. Timestamp on the audit page (O5) @phone', () => {
    test('16.1 With a token: the earlier signer shows it came from FreeTSA, unchecked', async ({page}) => {
        const reply = await tsaReply();
        await page.route('**/api/tsa', (route) => route.fulfill({status: 200, contentType: 'application/timestamp-reply', body: reply}));
        const first = await signAndRead(page);
        expect(first.text).toContain(NOW); // the signer being added: result not known yet
        const second = await signAndRead(page, first.pdf);
        expect(second.text).toContain(TOKEN); // signer 1, now known
        expect(second.text).toContain(NOW); // signer 2
        expect(second.text).toContain('Device Time:');
        expect(second.text).not.toContain('(Verified)');
    });

    test('16.2 Without a token: the earlier signer shows the device clock', async ({page}) => {
        await page.route('**/api/tsa', (route) => route.abort());
        const first = await signAndRead(page);
        const second = await signAndRead(page, first.pdf);
        expect(second.text).toContain(CLOCK);
        expect(second.text).not.toContain(TOKEN);
        expect(second.text).not.toContain('(Verified)');
    });
});
