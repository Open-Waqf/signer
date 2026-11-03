// verify-answer.spec.ts: Verify gives one plain answer: Intact, Changed or Not confirmed yet (step 6).
import {expect, test, type Page} from '@playwright/test';
import {generateTestPDF} from './utils';
import {tid} from './support/ui';
import {verifyAnswer} from '../src/features/verify/verify-state';

/** Sign the sample with a date; returns the saved PDF and its fingerprint. */
async function signSample(page: Page): Promise<{pdf: Buffer; hash: string}> {
    await page.goto('/');
    await page.getByTestId('btn-sample').click();
    await expect(page.getByTestId('btn-exit')).toBeVisible();
    await tid(page, 'btn-add-date').click();
    const download = page.waitForEvent('download');
    await tid(page, 'btn-save').click();
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    await page.getByTestId('btn-saved-details').click();
    const hash = (await page.getByTestId('saved-doc-hash').innerText()).trim();
    return {pdf: Buffer.concat(chunks), hash};
}

async function verify(page: Page, pdf: Buffer, link?: string) {
    await page.goto(link ?? '/');
    const chooser = page.waitForEvent('filechooser');
    if (link) {
        await page.getByTestId('btn-start-verify').click(); // the link opens Verify directly
    } else {
        await page.getByTestId('btn-verify-mode').click();
        await page.getByTestId('btn-select-file').click();
    }
    (await chooser).setFiles({name: 'received.pdf', mimeType: 'application/pdf', buffer: pdf});
    await expect(page.getByTestId('verify-answer')).toBeVisible();
}

async function checkFingerprint(page: Page, hash: string) {
    await page.getByTestId('input-verify-hash').fill(hash);
    await page.getByTestId('btn-check-hash').click();
}

const answer = (page: Page) => page.getByTestId('verify-answer');

test.describe('23. Verify answer @phone', () => {
    test('23.1 A signed file alone is "Not confirmed yet"; with the right fingerprint it is "Intact"', async ({page}) => {
        const {pdf, hash} = await signSample(page);
        await verify(page, pdf);
        await expect(answer(page)).toHaveAttribute('data-answer', 'unconfirmed');
        await expect(answer(page)).toContainText('does not prove');
        // The record is shown, but not as a green success.
        await expect(page.getByTestId('verify-success-title')).not.toHaveClass(/verify-success-title/);

        await checkFingerprint(page, hash);
        await expect(answer(page)).toHaveAttribute('data-answer', 'intact');
        await expect(answer(page)).toContainText('Intact');
    });

    test('23.2 A file changed after signing is "Changed", even with its old fingerprint', async ({page}) => {
        const {pdf, hash} = await signSample(page);
        // A small edit after signing: an extra comment at the end still opens in any reader.
        const edited = Buffer.concat([pdf, Buffer.from('\n% edited after signing\n')]);
        await verify(page, edited);
        await checkFingerprint(page, hash);
        await expect(answer(page)).toHaveAttribute('data-answer', 'changed');
        await expect(answer(page)).toContainText('does not match');
    });

    test('23.3 A file with no Signer record says so, and is not confirmed', async ({page}) => {
        await verify(page, Buffer.from(await generateTestPDF()));
        await expect(answer(page)).toHaveAttribute('data-answer', 'unconfirmed');
        await expect(answer(page)).toContainText('no Open Waqf Signer record');
    });

    test('23.4 A verify link opened with another file is "Changed": not the file the link was made for', async ({page}) => {
        const {pdf} = await signSample(page);
        await verify(page, pdf, '/?id=0000000000000000');
        await expect(answer(page)).toHaveAttribute('data-answer', 'changed');
        await expect(answer(page)).toContainText('not the file');
    });
});

test('23.5 verifyAnswer: only a matching fingerprint gives "Intact"', () => {
    expect(verifyAnswer({status: 'success', id: 'x'}, 'idle').kind).toBe('unconfirmed');
    expect(verifyAnswer({status: 'success', id: 'x'}, 'success').kind).toBe('intact');
    expect(verifyAnswer({status: 'success', id: 'x'}, 'fail').kind).toBe('changed');
    expect(verifyAnswer({status: 'fail'}, 'idle')).toEqual({kind: 'unconfirmed', reason: 'noRecord'});
    expect(verifyAnswer({status: 'fail', fromLink: true}, 'idle')).toEqual({kind: 'changed', reason: 'otherFile'});
    expect(verifyAnswer({status: 'fail'}, 'success').kind).toBe('intact');
});
