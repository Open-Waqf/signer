import {expect, test} from '@playwright/test';
import {generateTestPDF} from './utils';

// ---------------------------------------------------------------------------
// 🌍 SHARED STATE
// ---------------------------------------------------------------------------
let aliceSignedBuffer: Buffer | null = null;

test.describe.serial('🛡️ Open Waqf Signer: 360° Audit', () => {

    // --- GROUP 1: THE BASICS ---
    test('1. Baseline: App Loads & Offline UI is ready', async ({page}) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/Open.*Signer/i);
        await expect(page.getByText(/Secure/i)).toBeVisible();
    });

    test('2. Entry Point: Deep Link (Pending File State)', async ({page}) => {
        const testId = 'TEST-LINK-123';
        await page.goto(`/?id=${testId}`);
        const dialog = page.locator('dialog#verify-dialog');
        await expect(dialog).toBeVisible();

        // 🟢 FIX: We no longer falsely show "Record Found". We securely show "Link Detected"
        await expect(dialog.getByText(/Link Detected/i)).toBeVisible();
    });

    test('Scenario 3: Verify Interface Logic', async ({page}) => {
        await page.goto('/');
        await page.getByRole('button', {name: /Verify/i}).click();
        await expect(page.getByText(/Select PDF/i)).toBeVisible();
    });

    // --- GROUP 2: THE WORKFLOW ---

    test('4. Workflow A: Alice Signs & Saves (Happy Path)', async ({page}) => {
        const pdfBuffer = await generateTestPDF();
        await page.goto('/');

        // 1. Open Picker & Upload
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByRole('button', {name: /Select PDF|Select File/i}).click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'contract_alice.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBuffer,
        });

        // 2. Verify Load
        const workspace = page.locator('pdf-workspace');
        await expect(workspace).not.toHaveClass(/hidden/);
        await expect(workspace).toBeVisible();

        // 3. Open Signature Modal
        const signBtn = page.getByRole('button', {name: /sign/i}).first();
        await expect(signBtn).toBeVisible();
        await signBtn.click();

        // 4. Draw Signature
        const canvas = page.locator('canvas#signature-pad');
        await expect(canvas).toBeVisible();

        const box = await canvas.boundingBox();
        if (box) {
            await page.mouse.move(box.x + 50, box.y + 50);
            await page.mouse.down();
            await page.mouse.move(box.x + 150, box.y + 100);
            await page.mouse.up();
        }

        await page.getByRole('button', {name: 'Done'}).click();

        // 5. Save & Download
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', {name: /save/i}).click();
        const download = await downloadPromise;

        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        aliceSignedBuffer = Buffer.concat(chunks);

        expect(aliceSignedBuffer.length).toBeGreaterThan(0);

        await expect(page.getByRole('heading', { name: /Document Saved!/i })).toBeVisible();
        await expect(page.getByText(/Internal Ref ID/i)).toBeVisible();
        await expect(page.getByText(/Integrity Hash/i)).toBeVisible();

        // Close the receipt modal
        await page.getByRole('button', {name: /Close/i}).click();
    });

    test('5. Workflow B: Handover (Bob Signs Alice\'s File)', async ({page}) => {
        test.skip(!aliceSignedBuffer, 'Skipping: Alice failed to produce a file.');
        await page.goto('/');

        // 1. Upload Alice's Signed File
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByRole('button', {name: /Select PDF|Select File/i}).click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'alice_signed.pdf',
            mimeType: 'application/pdf',
            buffer: aliceSignedBuffer!,
        });

        // 2. Assert Handover Modal Appears and Dismiss it
        await expect(page.getByRole('heading', {name: /Previous signature/i})).toBeVisible();
        await page.getByRole('button', {name: /Skip|Close/i}).click();

        // 3. Bob Signs
        await page.getByRole('button', {name: /sign/i}).first().click();

        const canvas = page.locator('canvas#signature-pad');
        await expect(canvas).toBeVisible();
        const box = await canvas.boundingBox();
        if (box) {
            await page.mouse.move(box.x + 20, box.y + 20);
            await page.mouse.down();
            await page.mouse.move(box.x + 80, box.y + 80);
            await page.mouse.up();
        }

        await page.getByRole('button', {name: 'Done'}).click();

        // 4. Bob Saves
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', {name: /save/i}).click();
        const download = await downloadPromise;
        expect(await download.path()).toBeTruthy();

        await expect(page.getByRole('heading', { name: /Document Saved!/i })).toBeVisible();
        await page.getByRole('button', {name: /Close/i}).click();
    });

    test('6. Verification: Green Success State', async ({page}) => {
        test.skip(!aliceSignedBuffer, 'Skipping: No file to verify.');
        await page.goto('/');
        await page.getByRole('button', {name: /Verify/i}).click();

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByRole('button', {name: /Select PDF|Select File/i}).click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'check_me.pdf',
            mimeType: 'application/pdf',
            buffer: aliceSignedBuffer!,
        });

        await expect(page.getByText(/Record Found/i)).toBeVisible();
    });

    // --- GROUP 3: PLATFORM CHECKS ---
    test('7. Responsive: Mobile Viewport Check', async ({page}) => {
        await page.setViewportSize({width: 390, height: 844});
        await page.goto('/');
        await expect(page.getByText(/Sign/i).first()).toBeVisible();
    });
});