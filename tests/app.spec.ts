import {expect, test} from '@playwright/test';
import {generateTestPDF} from './utils';

// ---------------------------------------------------------------------------
// 🌍 SHARED STATE
// ---------------------------------------------------------------------------
let aliceSignedBuffer: Buffer | null = null;

test.describe.serial('🛡️ Open Waqf Signer: robust UX & Navigation Audit', () => {

    test('1. Navigation: Landing Page & Mode Toggles', async ({page}) => {
        await page.goto('/');

        const signModeBtn = page.getByTestId('btn-sign-mode');
        const verifyModeBtn = page.getByTestId('btn-verify-mode');

        await expect(signModeBtn).toBeVisible();
        await expect(verifyModeBtn).toBeVisible();

        await verifyModeBtn.click();
        await expect(verifyModeBtn).toHaveClass(/active/);

        await signModeBtn.click();
        await expect(signModeBtn).toHaveClass(/active/);
    });

    test('2. Navigation: Privacy Dialog & Language Switching', async ({page}) => {
        await page.goto('/');

        // Open Privacy
        await page.getByTestId('link-privacy').click();
        await expect(page.getByRole('dialog', {name: /privacy/i})).toBeVisible();
        await page.getByTestId('btn-close-privacy').click();
        await expect(page.getByRole('dialog', {name: /privacy/i})).not.toBeVisible();

        // Language toggle persistence check (UI side)
        const langSelect = page.getByTestId('select-lang-home');
        await langSelect.selectOption('ar');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

        // Reset to en for subsequent tests
        await page.getByTestId('select-lang-home').selectOption('en');
        await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    });

    test('3. Diagnostics: Secret Tap Logic', async ({page}) => {
        await page.goto('/');
        const logo = page.getByTestId('logo-img');

        // 5 taps to open diagnostics
        for (let i = 0; i < 5; i++) {
            await logo.click();
        }

        await expect(page.getByTestId('diagnostics-modal')).toBeVisible();
        await page.getByTestId('btn-close-diagnostics').click();
        await expect(page.getByTestId('diagnostics-modal')).not.toBeVisible();
    });

    test('4. Workflow: Full Signing Loop with Annotation controls', async ({page}) => {
        const pdfBuffer = await generateTestPDF();
        await page.goto('/');

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'test_doc.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBuffer,
        });

        const workspace = page.locator('pdf-workspace');
        await expect(workspace).toBeVisible();

        // Add Date
        await page.getByTestId('btn-add-date').click();
        const annotation = page.locator('[data-testid^="annotation-"]').first();
        await expect(annotation).toBeVisible();

        // Test Menu Clickability (The fix verification)
        await annotation.click();
        const stylePopup = page.getByTestId('style-popup');
        await expect(stylePopup).toBeVisible();

        // Action within menu
        await page.getByTestId('btn-font-up').click();
        await page.getByTestId('btn-apply-all').click();

        // Signature Modal
        await page.getByTestId('btn-add-sig').click();
        const sigPad = page.getByTestId('signature-pad');
        await expect(sigPad).toBeVisible();

        const box = await sigPad.boundingBox();
        if (box) {
            await page.mouse.move(box.x + 20, box.y + 20);
            await page.mouse.down();
            await page.mouse.move(box.x + 100, box.y + 100);
            await page.mouse.up();
        }

        await page.getByTestId('btn-save-sig').click();

        // Save
        const downloadPromise = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const download = await downloadPromise;
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        aliceSignedBuffer = Buffer.concat(chunks);

        // Proof modal
        await expect(page.getByTestId('proof-modal')).toBeVisible();
        const savedId = await page.getByTestId('saved-doc-id').innerText();
        expect(savedId.length).toBeGreaterThan(5);
        await page.getByTestId('btn-close-proof').click();

        await expect(page.getByTestId('btn-exit')).toBeVisible();
    });

    test('5. Robustness: Exit Confirmation (Dirty State)', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('btn-sample').click();

        // Exit without changes - no modal
        await page.getByTestId('btn-exit').click();
        await expect(page.getByTestId('btn-select-file')).toBeVisible();

        // Re-enter and make changes
        await page.getByTestId('btn-sample').click();
        await page.getByTestId('btn-add-date').click();

        // Exit with changes - should show confirmation
        await page.getByTestId('btn-exit').click();
        await expect(page.getByTestId('exit-confirm-modal')).toBeVisible();

        // Cancel exit
        await page.getByTestId('btn-cancel-exit').click();
        await expect(page.getByTestId('exit-confirm-modal')).not.toBeVisible();
        await expect(page.locator('pdf-workspace')).toBeVisible();

        // Confirm exit
        await page.getByTestId('btn-exit').click();
        await page.getByTestId('btn-confirm-exit').click();
        await expect(page.getByTestId('btn-select-file')).toBeVisible();
    });

    test('6. Strong Navigation: Multi-page & History', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('btn-sample').click();

        const pageIndicator = page.getByTestId('page-indicator');
        // Handle "1 / X" or localized "1 of X"
        await expect(pageIndicator).toHaveText(/1\s*(?:\/|of)\s*\d+/);

        // Toggle Thumbnails
        await page.getByTestId('btn-toggle-thumbs').click();
        const thumbPanel = page.locator('.thumb-panel');
        await expect(thumbPanel).toBeVisible();

        const thumb2 = page.getByTestId('thumb-page-2');
        if (await thumb2.count() > 0) {
            await thumb2.click();
            await expect(pageIndicator).toHaveText(/2\s*(?:\/|of)\s*\d+/);
        }

        // Toggle Thumbnails off
        await page.getByTestId('btn-toggle-thumbs').click();
        await expect(thumbPanel).not.toBeVisible();

        // Undo/Redo Test
        await page.getByTestId('btn-add-date').click();
        await expect(page.locator('[data-testid^="annotation-"]')).toHaveCount(1);

        await page.getByTestId('btn-undo').click();
        await expect(page.locator('[data-testid^="annotation-"]')).toHaveCount(0);

        await page.getByTestId('btn-redo').click();
        await expect(page.locator('[data-testid^="annotation-"]')).toHaveCount(1);
    });

    test('7. Workflow: Verification Logic', async ({page}) => {
        if (!aliceSignedBuffer) return test.skip();

        await page.goto('/');
        await page.getByTestId('btn-verify-mode').click();

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'alice_signed.pdf',
            mimeType: 'application/pdf',
            buffer: aliceSignedBuffer,
        });

        // Verification success
        await expect(page.getByTestId('verify-success-title')).toBeVisible();

        // Hash check (fail)
        await page.getByTestId('input-verify-hash').fill('wrong_hash');
        await page.getByTestId('btn-check-hash').click();
        await expect(page.getByTestId('integrity-fail')).toBeVisible();

        await page.getByTestId('btn-close-verify').click();
    });

    test('8. Accessibility: Keyboard Shortcuts', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('btn-sample').click();

        // Add annotation
        await page.getByTestId('btn-add-text').click();
        const ann = page.locator('[data-testid^="annotation-"]').first();
        await ann.click();

        // Delete via keyboard
        await page.keyboard.press('Delete');
        await expect(page.locator('[data-testid^="annotation-"]')).toHaveCount(0);

        // Undo via keyboard (Ctrl+Z)
        await page.keyboard.press('Control+z');
        await expect(page.locator('[data-testid^="annotation-"]')).toHaveCount(1);
    });

    test('9. Workflow: Batch Operations (Multi-select & Delete)', async ({page}) => {
        await page.goto('/');
        
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        const fileChooser = await fileChooserPromise;
        
        const pdfBuffer = await generateTestPDF(1);
        await fileChooser.setFiles({
            name: 'batch_test.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from(pdfBuffer)
        });
        
        await expect(page.locator('pdf-workspace')).toBeVisible();

        const ws = page.locator('pdf-workspace');

        // Add 3 dates
        for (let i=0; i<3; i++) {
            await ws.getByTestId('btn-add-date').click();
            await page.waitForTimeout(100);
        }

        await expect(ws.locator('[data-testid^="annotation-"]')).toHaveCount(3);

        const annotations = ws.locator('[data-testid^="annotation-"]');
        const ann1 = annotations.nth(0);
        const ann2 = annotations.nth(1);

        await ann1.evaluate((el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
        await ann2.evaluate((el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true })));

        await expect(ann1).toHaveClass(/selected/);
        await expect(ann2).toHaveClass(/selected/);

        await page.keyboard.press('Delete');
        await expect(ws.locator('[data-testid^="annotation-"]')).toHaveCount(1);
    });
});
