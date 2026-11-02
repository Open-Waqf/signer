// trust.spec.ts: the app only claims what it can show (round 1 of the October audit).
import fs from 'node:fs';
import {expect, test} from '@playwright/test';
import {signAndRead} from './support/audit';
import {tid} from './support/ui';

test.describe('17. Honest trust messages @phone', () => {
    test('17.1 A passed handover check is not printed as a SECURITY ALERT', async ({page}) => {
        const first = await signAndRead(page);
        const second = await signAndRead(page, first.pdf, first.code);
        expect(second.text).toContain('Handover check:');
        expect(second.text).not.toContain('SECURITY ALERT');
    });

    test('17.2 A skipped handover check is still a SECURITY ALERT', async ({page}) => {
        const first = await signAndRead(page);
        const second = await signAndRead(page, first.pdf);
        expect(second.text).toContain('SECURITY ALERT');
    });

    test('17.3 Verify: the signer history is shown as information, not as proof', async ({page}) => {
        const {pdf} = await signAndRead(page);
        await page.goto('/');
        await page.getByTestId('btn-verify-mode').click();
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({name: 'signed.pdf', mimeType: 'application/pdf', buffer: pdf});
        const chain = page.getByTestId('chain-success');
        await expect(chain).toBeVisible();
        await expect(chain).toContainText('not proof');
        await expect(chain).not.toHaveClass(/alert-success/);
    });

    test('17.4 The identity stamp says "Signed by", not "Digitally Signed by"', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await tid(page, 'btn-toggle-advanced').click();
        await tid(page, 'btn-add-identity').click();
        await page.getByTestId('input-custom-prompt').fill('Amina Haddad');
        await page.getByTestId('btn-save-prompt').click();
        const stamp = page.locator('[data-testid^="annotation-"]').first();
        await expect(stamp).toContainText('Signed by: Amina Haddad');
        await expect(stamp).not.toContainText('Digitally');
    });
});

test.describe('18. Safety', () => {
    test('18.1 Save still finishes when the hashing worker crashes', async ({page}) => {
        // Replace only the hash worker with one that crashes; pdf.js keeps its real worker.
        await page.addInitScript(() => {
            const RealWorker = window.Worker;
            (window as any).Worker = function (url: string | URL, options?: WorkerOptions) {
                if (String(url).includes('hash.worker')) {
                    const fake: any = {onmessage: null, onerror: null, terminate() {}, addEventListener() {}, removeEventListener() {}};
                    fake.postMessage = () => setTimeout(() => fake.onerror?.({message: 'simulated crash', preventDefault() {}}), 10);
                    return fake;
                }
                return new RealWorker(url, options);
            };
        });
        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await tid(page, 'btn-add-date').click();
        const download = page.waitForEvent('download', {timeout: 15000});
        await tid(page, 'btn-save').click();
        await download;
        await expect(page.getByTestId('proof-modal')).toBeVisible();
        await page.getByTestId('btn-saved-details').click();
        expect((await page.getByTestId('saved-doc-hash').innerText()).trim()).toMatch(/^[0-9a-f]{64}$/);
    });

    test('18.2 Android: no cloud backup and no phone-to-phone transfer of app data', () => {
        const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
        expect(manifest).toContain('android:allowBackup="false"');
        expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
        const rules = fs.readFileSync('android/app/src/main/res/xml/data_extraction_rules.xml', 'utf8');
        for (const section of ['cloud-backup', 'device-transfer']) {
            const block = rules.split(`<${section}>`)[1]?.split(`</${section}>`)[0] ?? '';
            expect(block, section).toContain('<exclude domain="root" path="."/>');
            expect(block, section).toContain('<exclude domain="file" path="."/>');
            expect(block, section).toContain('<exclude domain="database" path="."/>');
        }
    });
});
