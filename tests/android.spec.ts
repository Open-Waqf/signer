// android.spec.ts: the app's Android logic, run in Playwright with a fake Android bridge
// (tests/support/native-fake.ts). Phone screen only (@phone).
import {expect, test} from '@playwright/test';
import {generateTestPDF} from './utils';
import {fakeAndroid, nativeCalls, fireNative, pressBack, openDialogs} from './support/native-fake';
import {tid} from './support/ui';

async function openSample(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.getByTestId('btn-sample').click();
    await expect(page.getByTestId('btn-exit')).toBeVisible();
}

async function finish(page: import('@playwright/test').Page) {
    await tid(page, 'btn-save').click();
    await expect(page.getByTestId('proof-modal')).toBeVisible();
}

test.describe('12. Android app (fake Android bridge) @phone', () => {
    test('12.1 Finish saves into Documents; the share sheet opens only from Share', async ({page}) => {
        await fakeAndroid(page);
        await openSample(page);
        expect(await page.evaluate(() => (window as any).Capacitor.getPlatform())).toBe('android');

        await tid(page, 'btn-add-date').click();
        await finish(page);

        const writes = await nativeCalls(page, 'Filesystem');
        const write = writes.find((c) => c.method === 'writeFile');
        expect(write?.options.directory).toBe('DOCUMENTS');
        expect(write?.options.path).toMatch(/_signed_.*\.pdf$/);
        await expect(page.getByTestId('saved-where')).toContainText('in Documents');

        // No share sheet by itself (it used to open 0.2 s after saving).
        await page.waitForTimeout(500);
        expect(await nativeCalls(page, 'Share')).toHaveLength(0);

        await page.getByTestId('btn-share-saved').click();
        await expect.poll(async () => (await nativeCalls(page, 'Share')).length).toBe(1);
        const share = (await nativeCalls(page, 'Share'))[0];
        expect(share.options.url).toBe(`file:///storage/emulated/0/Documents/${write?.options.path}`);
    });

    test('12.2 A failed save (storage full) shows an error and no Saved sheet', async ({page}) => {
        await fakeAndroid(page, {failWrite: true});
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        await tid(page, 'btn-save').click();
        await expect(page.locator('.toast.show')).toContainText('Could not save file to device');
        await expect(page.getByTestId('proof-modal')).toBeHidden();
        await expect(tid(page, 'btn-save')).toBeEnabled();
    });

    test('12.3 "Open with": a PDF the app was launched with opens in the editor', async ({page}) => {
        const url = 'content://com.android.providers.downloads.documents/document/contract.pdf';
        const pdf = Buffer.from(await generateTestPDF()).toString('base64');
        await fakeAndroid(page, {launchUrl: url, files: {[url]: pdf}});
        await page.goto('/');
        await expect(page.getByTestId('btn-exit')).toBeVisible();

        // The opened file keeps its name: saving produces contract_signed_….pdf
        await tid(page, 'btn-add-date').click();
        await finish(page);
        const write = (await nativeCalls(page, 'Filesystem')).find((c) => c.method === 'writeFile');
        expect(write?.options.path).toMatch(/^contract_signed_.*\.pdf$/);
    });

    test('12.4 "Open with" while the app is already open switches to the new PDF', async ({page}) => {
        const url = 'content://media/external/file/42/invoice.pdf';
        const pdf = Buffer.from(await generateTestPDF()).toString('base64');
        await fakeAndroid(page, {files: {[url]: pdf}});
        await page.goto('/');
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
        expect(await fireNative(page, 'App', 'appUrlOpen', {url})).toBe(1);
        await expect(page.getByTestId('btn-exit')).toBeVisible();
    });

    test('12.5 Back on the home screen closes the app', async ({page}) => {
        await fakeAndroid(page);
        await page.goto('/');
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
        expect(await pressBack(page)).toBe(1);
        await expect.poll(async () => (await nativeCalls(page, 'App')).some((c) => c.method === 'exitApp')).toBe(true);
    });

    test('12.6 Back in the editor with unsaved changes asks before leaving', async ({page}) => {
        await fakeAndroid(page);
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        await pressBack(page);
        await expect(page.getByTestId('exit-confirm-modal')).toBeVisible();
        expect((await nativeCalls(page, 'App')).some((c) => c.method === 'exitApp')).toBe(false);
    });

    test('12.7 Back with the signature pad open closes the pad and stays in the editor', async ({page}) => {
        await fakeAndroid(page);
        await openSample(page);
        await tid(page, 'btn-add-sig').click();
        await expect(page.getByTestId('signature-pad')).toBeVisible();
        await pressBack(page);
        await expect(page.getByTestId('signature-pad')).toBeHidden();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        expect(await openDialogs(page)).toEqual([]);
    });

    test('12.8 Back with the Saved sheet open closes the sheet and stays in the editor', async ({page}) => {
        await fakeAndroid(page);
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        await finish(page);
        await pressBack(page);
        await expect(page.getByTestId('proof-modal')).toBeHidden();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        expect(await openDialogs(page)).toEqual([]);
    });

    test('12.9 Back with the stamp library open closes it and stays in the editor', async ({page}) => {
        await fakeAndroid(page);
        await openSample(page);
        await tid(page, 'btn-add-stamp').click();
        await expect(page.getByTestId('stamp-library-modal')).toBeVisible();
        await pressBack(page);
        await expect(page.getByTestId('stamp-library-modal')).toBeHidden();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        expect(await openDialogs(page)).toEqual([]);
    });
    test('12.17 Both system bars get dark icons (the app is light, even with the phone in dark mode)', async ({page}) => {
        await fakeAndroid(page);
        await page.goto('/');
        await expect.poll(async () => (await nativeCalls(page, 'SystemBars'))
            .some((c) => c.method === 'setStyle' && c.options.style === 'LIGHT' && !c.options.bar)).toBe(true);
    });

    test('12.14 Share App opens the Android share sheet with the website link, no toast', async ({page}) => {
        await fakeAndroid(page);
        await page.goto('/');
        await page.getByTestId('btn-share-app').click();
        await expect.poll(async () => (await nativeCalls(page, 'Share')).length).toBe(1);
        expect((await nativeCalls(page, 'Share'))[0].options.url).toBe('https://sign.open-waqf.org/?lang=en');
        await page.waitForTimeout(400);
        // Count once, no retrying: a toast disappears by itself after ~3 s.
        expect(await page.locator('.toast.show').count()).toBe(0);
    });

    test('12.15 A file left by an earlier install does not block saving: the new file gets "(2)" (S1)', async ({page}) => {
        // Names go down to the minute: work out the name this save will use.
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
        const taken = `sample_document_signed_${stamp}.pdf`;
        await fakeAndroid(page, {foreignFiles: [taken]});
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        test.skip(new Date().getMinutes() !== now.getMinutes(), 'the minute changed during the test');
        await finish(page);

        const fs = await nativeCalls(page, 'Filesystem');
        expect(fs.some((c) => c.method === 'deleteFile' && c.options.path === taken)).toBe(false);
        const write = fs.filter((c) => c.method === 'writeFile').pop();
        expect(write?.options.path).toBe(taken.replace('.pdf', ' (2).pdf'));
        await expect(page.getByTestId('saved-where')).toContainText('(2).pdf');
    });

    test('12.16 Saving twice in the same minute keeps both files (S1)', async ({page}) => {
        await fakeAndroid(page);
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        await finish(page);
        await page.keyboard.press('Escape'); // close the sheet, keep editing
        await tid(page, 'btn-add-date').click();
        await finish(page);

        const fs = await nativeCalls(page, 'Filesystem');
        expect(fs.filter((c) => c.method === 'deleteFile')).toHaveLength(0);
        const paths = fs.filter((c) => c.method === 'writeFile').map((c) => c.options.path);
        expect(paths).toHaveLength(2);
        expect(new Set(paths).size).toBe(2);
    });

    test('12.10 Back with the leave-without-saving question open closes the question', async ({page}) => {
        await fakeAndroid(page);
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        await pressBack(page);
        await expect(page.getByTestId('exit-confirm-modal')).toBeVisible();
        await pressBack(page);
        await expect(page.getByTestId('exit-confirm-modal')).toBeHidden();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        expect(await openDialogs(page)).toEqual([]);
    });

    test('12.11 Back with a text box open closes it and stays in the editor', async ({page}) => {
        await fakeAndroid(page);
        await openSample(page);
        await tid(page, 'btn-toggle-advanced').click();
        await tid(page, 'btn-add-identity').click();
        await expect(page.getByTestId('custom-prompt')).toBeVisible();
        await pressBack(page);
        await expect(page.getByTestId('custom-prompt')).toBeHidden();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        expect(await openDialogs(page)).toEqual([]);
    });

    test('12.12 After Back leaves the editor, the home screen still responds', async ({page}) => {
        await fakeAndroid(page);
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        await finish(page);
        await pressBack(page); // closes the Saved sheet
        await pressBack(page); // nothing unsaved: back to home
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
        expect(await openDialogs(page)).toEqual([]);
        await page.getByTestId('btn-sample').click({timeout: 3000});
        await expect(page.getByTestId('btn-exit')).toBeVisible();
    });

    test('12.13 A PDF arriving with "Open with" while the Saved sheet is open shows no old sheet', async ({page}) => {
        const url = 'content://media/external/file/7/next.pdf';
        const pdf = Buffer.from(await generateTestPDF()).toString('base64');
        await fakeAndroid(page, {files: {[url]: pdf}});
        await openSample(page);
        await tid(page, 'btn-add-date').click();
        await finish(page);
        await fireNative(page, 'App', 'appUrlOpen', {url});
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await expect(page.getByTestId('proof-modal')).toBeHidden();
        expect(await openDialogs(page)).toEqual([]);
    });
});
