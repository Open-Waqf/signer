import {expect, test} from '@playwright/test';
import {generateTestPDF} from './utils';
import {PDFDocument} from 'pdf-lib';

// ---------------------------------------------------------------------------
// 🌍 SHARED STATE
// ---------------------------------------------------------------------------
let aliceSignedBuffer: Buffer | null = null;
let signerABuffer: Buffer | null = null;
let signerBBuffer: Buffer | null = null;
let signerCSingleAuditBuffer: Buffer | null = null;

async function readPdfSignatures(buffer: Buffer): Promise<any[]> {
    const pdf = await PDFDocument.load(buffer, {updateMetadata: false});
    const subject = pdf.getSubject() || '';
    if (!subject.startsWith('OWQ_CHAIN:')) return [];
    const parsed = JSON.parse(subject.slice('OWQ_CHAIN:'.length));
    return Array.isArray(parsed?.signatures) ? parsed.signatures : [];
}

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

    test('2.5 RTL: Modal direction follows selected language', async ({page}) => {
        await page.goto('/');

        await page.getByTestId('select-lang-home').selectOption('ar');
        await page.getByTestId('link-privacy').click();
        const rtlModal = await page.locator('owq-modal[open]').first().evaluate((el) => {
            const root = (el as HTMLElement).shadowRoot;
            const card = root?.querySelector('.modal-card') as HTMLElement | null;
            return {
                overlayDir: root?.querySelector('.modal-overlay')?.getAttribute('dir') || '',
                cardDir: card?.getAttribute('dir') || '',
                cardDirection: card ? getComputedStyle(card).direction : '',
            };
        });
        expect(rtlModal.overlayDir).toBe('rtl');
        expect(rtlModal.cardDir).toBe('rtl');
        expect(rtlModal.cardDirection).toBe('rtl');
        await page.getByTestId('btn-close-privacy').click();

        await page.getByTestId('select-lang-home').selectOption('en');
        await page.getByTestId('link-privacy').click();
        const ltrModal = await page.locator('owq-modal[open]').first().evaluate((el) => {
            const root = (el as HTMLElement).shadowRoot;
            const card = root?.querySelector('.modal-card') as HTMLElement | null;
            return {
                overlayDir: root?.querySelector('.modal-overlay')?.getAttribute('dir') || '',
                cardDir: card?.getAttribute('dir') || '',
                cardDirection: card ? getComputedStyle(card).direction : '',
            };
        });
        expect(ltrModal.overlayDir).toBe('ltr');
        expect(ltrModal.cardDir).toBe('ltr');
        expect(ltrModal.cardDirection).toBe('ltr');
    });

    test('2.6 RTL: Workspace exit confirm modal uses RTL direction', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('select-lang-home').selectOption('ar');
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await page.getByTestId('btn-add-date').click();
        await page.getByTestId('btn-exit').click();

        const modalDir = await page.locator('owq-modal[open][data-testid=\"exit-confirm-modal\"]').evaluate((el) => {
            const root = (el as HTMLElement).shadowRoot;
            const card = root?.querySelector('.modal-card') as HTMLElement | null;
            return {
                overlayDir: root?.querySelector('.modal-overlay')?.getAttribute('dir') || '',
                cardDir: card?.getAttribute('dir') || '',
                cardDirection: card ? getComputedStyle(card).direction : '',
            };
        });
        expect(modalDir.overlayDir).toBe('rtl');
        expect(modalDir.cardDir).toBe('rtl');
        expect(modalDir.cardDirection).toBe('rtl');
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

    test('3.5 Arabic: Sample and PDF open still work', async ({page}) => {
        const pdfBuffer = await generateTestPDF();
        await page.goto('/');
        const homeCard = page.locator('.drop-card');
        await expect(homeCard).toBeVisible();
        const widthEn = await homeCard.evaluate((el) => Math.round(el.getBoundingClientRect().width));

        await page.getByTestId('select-lang-home').selectOption('fr');
        const widthFr = await homeCard.evaluate((el) => Math.round(el.getBoundingClientRect().width));
        expect(Math.abs(widthFr - widthEn)).toBeLessThanOrEqual(2);

        await page.getByTestId('select-lang-home').selectOption('ar');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        const widthAr = await homeCard.evaluate((el) => Math.round(el.getBoundingClientRect().width));
        expect(Math.abs(widthAr - widthEn)).toBeLessThanOrEqual(2);

        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        const exitArrowRtlClass = await page.getByTestId('btn-exit').locator('svg').first()
            .evaluate((el) => el.getAttribute('class') || '');
        expect(String(exitArrowRtlClass)).toContain('exit-icon-rtl');
        const canvasDirectionRtl = await page.locator('pdf-workspace').evaluate((el) => {
            const root = (el as HTMLElement).shadowRoot;
            const canvas = root?.querySelector('#pdf-canvas') as HTMLCanvasElement | null;
            return canvas ? getComputedStyle(canvas).direction : '';
        });
        expect(canvasDirectionRtl).toBe('ltr');
        await page.getByTestId('btn-exit').click();
        await expect(page.getByTestId('btn-select-file')).toBeVisible();

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'arabic_test.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBuffer,
        });

        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await page.getByTestId('btn-exit').click();
        await page.getByTestId('select-lang-home').selectOption('en');
        await page.getByTestId('btn-sample').click();
        const exitArrowLtrClass = await page.getByTestId('btn-exit').locator('svg').first()
            .evaluate((el) => el.getAttribute('class') || '');
        expect(String(exitArrowLtrClass)).not.toContain('exit-icon-rtl');
    });

    test('4. Workflow: Share Target handoff opens PDF on app start', async ({page}) => {
        const pdfBuffer = await generateTestPDF();
        const pdfBase64 = pdfBuffer.toString('base64');

        await page.goto('/');
        await page.evaluate(async ({base64}) => {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            const cache = await caches.open('owq-share-target');
            await cache.put(
                '/__owq_shared_pdf__',
                new Response(bytes, {
                    headers: {
                        'content-type': 'application/pdf',
                        'x-owq-file-name': encodeURIComponent('shared_test.pdf')
                    }
                })
            );
        }, {base64: pdfBase64});

        await page.reload();
        await expect(page.getByTestId('btn-exit')).toBeVisible({timeout: 15000});
    });

    test('4. Workflow: Air-Gap sender initializes without runtime crash', async ({page}) => {
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await page.getByTestId('btn-add-date').click();
        await page.getByTestId('btn-airgap-transfer').click();

        const errorBlock = page.locator('.info-panel').filter({hasText: /Failed to prepare|تعذر تجهيز|Échec de préparation/i});
        await page.waitForTimeout(1000);
        const errorCount = await errorBlock.count();
        if (errorCount > 0) {
            const errorText = await errorBlock.first().innerText();
            throw new Error(`Air-Gap prepare failed: ${errorText}\nConsole errors:\n${consoleErrors.join('\n')}\nPage errors:\n${pageErrors.join('\n')}`);
        }
        await expect(page.getByTestId('airgap-send-canvas')).toBeVisible({timeout: 15000});

        const combinedErrors = `${pageErrors.join('\n')}\n${consoleErrors.join('\n')}`;
        expect(combinedErrors).not.toContain('process is not defined');
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

        // Basic mode by default: advanced tools hidden until expanded
        await expect(page.getByTestId('btn-add-text')).toHaveCount(0);
        await page.getByTestId('btn-toggle-advanced').click();
        await expect(page.getByTestId('btn-add-text')).toBeVisible();

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
        const toggleBtn = page.getByTestId('btn-toggle-thumbs');
        const isActive = await toggleBtn.evaluate((el) => el.classList.contains('active'));
        if (!isActive) {
            await toggleBtn.click();
        }
        const thumbPanel = page.locator('.thumb-panel');
        await expect(thumbPanel).toBeVisible();

        const thumb2 = page.getByTestId('thumb-page-2');
        if (await thumb2.count() > 0) {
            await thumb2.click();
            await expect(pageIndicator).toHaveText(/2\s*(?:\/|of)\s*\d+/);
        }

        // Clicking selected thumbnail toggle collapses panel
        await toggleBtn.click();
        await expect(toggleBtn).not.toHaveClass(/active/);
        await expect(thumbPanel).toHaveCount(0);

        // Clicking again re-opens and re-selects
        await toggleBtn.click();
        await expect(toggleBtn).toHaveClass(/active/);
        await expect(thumbPanel).toBeVisible();

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
        await expect(page.getByText(/Step 2|الخطوة 2|Étape 2/)).toBeVisible();

        // Hash check (fail)
        await page.getByTestId('input-verify-hash').fill('wrong_hash');
        await page.getByTestId('btn-check-hash').click();
        await expect(page.getByTestId('integrity-fail')).toBeVisible();
        await expect(page.getByTestId('hash-normalized')).toBeVisible();

        await page.getByTestId('btn-close-verify').click();
    });

    test('8. Accessibility: Keyboard Shortcuts', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await page.getByTestId('btn-toggle-advanced').click();

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
        
        const pdfBuffer = await generateTestPDF();
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

    test('10. REQ-19 TC-01: Sequential chain happy path', async ({page}) => {
        const sourcePdf = await generateTestPDF();
        await page.goto('/');

        const chooserA = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooserA).setFiles({name: 'tc01.pdf', mimeType: 'application/pdf', buffer: sourcePdf});

        await page.getByTestId('btn-add-date').click();
        const dlA = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const dA = await dlA;
        const codeA = (await page.getByTestId('saved-handover-code').innerText()).trim();
        const streamA = await dA.createReadStream();
        const chunksA = [];
        for await (const chunk of streamA) chunksA.push(chunk);
        signerABuffer = Buffer.concat(chunksA);
        await page.getByTestId('btn-close-proof').click();

        await page.goto('/');
        const chooserB = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooserB).setFiles({name: 'tc01_a.pdf', mimeType: 'application/pdf', buffer: signerABuffer});

        await expect(page.getByTestId('handover-modal')).toBeVisible();
        await page.getByTestId('input-handover-hash').fill(codeA);
        await page.getByTestId('btn-verify-handover').click();
        await expect(page.getByTestId('handover-modal')).not.toBeVisible();

        await page.getByTestId('btn-add-date').click();
        const dlB = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const dB = await dlB;
        const streamB = await dB.createReadStream();
        const chunksB = [];
        for await (const chunk of streamB) chunksB.push(chunk);
        signerBBuffer = Buffer.concat(chunksB);
        await page.getByTestId('btn-close-proof').click();

        await page.goto('/');
        await page.getByTestId('btn-verify-mode').click();
        const chooserV = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooserV).setFiles({name: 'tc01_b.pdf', mimeType: 'application/pdf', buffer: signerBBuffer});
        await expect(page.getByTestId('chain-success')).toBeVisible();
    });

    test('11. REQ-19 TC-02 + TC-03: Skip handover and lock prior visuals', async ({page}) => {
        test.skip(!signerABuffer);
        await page.goto('/');

        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({name: 'tc02_a.pdf', mimeType: 'application/pdf', buffer: signerABuffer!});

        await expect(page.getByTestId('handover-modal')).toBeVisible();
        await page.getByTestId('btn-skip-handover').click();
        await expect(page.locator('[data-testid^=\"annotation-\"]')).toHaveCount(0);

        await page.getByTestId('btn-add-date').click();
        const dl = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const d = await dl;
        const stream = await d.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const signerBSkipped = Buffer.concat(chunks);
        await page.getByTestId('btn-close-proof').click();

        const signatures = await readPdfSignatures(signerBSkipped);
        expect(signatures.length).toBe(2);
        expect(signatures[1].previousHashManuallyVerified).toBeFalsy();

        await page.goto('/');
        await page.getByTestId('btn-verify-mode').click();
        const chooserV = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooserV).setFiles({name: 'tc02_b.pdf', mimeType: 'application/pdf', buffer: signerBSkipped});
        await expect(page.getByTestId('chain-success')).toBeVisible();
    });

    test('12. REQ-19 TC-04: Audit page stacking produces exactly one final audit page', async ({page}) => {
        const sourcePdf = await generateTestPDF();
        await page.goto('/');

        const chooseA = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooseA).setFiles({name: 'tc04.pdf', mimeType: 'application/pdf', buffer: sourcePdf});
        await page.getByTestId('btn-add-date').click();
        const dlA = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const dA = await dlA;
        const codeA = (await page.getByTestId('saved-handover-code').innerText()).trim();
        const streamA = await dA.createReadStream();
        const chunksA = [];
        for await (const chunk of streamA!) chunksA.push(chunk);
        const bufA = Buffer.concat(chunksA);
        await page.getByTestId('btn-close-proof').click();

        await page.goto('/');
        const chooseB = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooseB).setFiles({name: 'tc04_a.pdf', mimeType: 'application/pdf', buffer: bufA});
        await page.getByTestId('input-handover-hash').fill(codeA);
        await page.getByTestId('btn-verify-handover').click();
        await expect(page.getByTestId('handover-modal')).not.toBeVisible();
        await page.getByTestId('btn-toggle-audit').click(); // Signer B audit OFF
        await page.getByTestId('btn-add-date').click();
        const dlB = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const dB = await dlB;
        const codeB = (await page.getByTestId('saved-handover-code').innerText()).trim();
        const streamB = await dB.createReadStream();
        const chunksB = [];
        for await (const chunk of streamB!) chunksB.push(chunk);
        const bufB = Buffer.concat(chunksB);
        await page.getByTestId('btn-close-proof').click();

        await page.goto('/');
        const chooseC = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooseC).setFiles({name: 'tc04_b.pdf', mimeType: 'application/pdf', buffer: bufB});
        await page.getByTestId('input-handover-hash').fill(codeB);
        await page.getByTestId('btn-verify-handover').click();
        await expect(page.getByTestId('handover-modal')).not.toBeVisible();
        await page.getByTestId('btn-add-date').click();
        const dlC = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const dC = await dlC;
        const streamC = await dC.createReadStream();
        const chunksC = [];
        for await (const chunk of streamC!) chunksC.push(chunk);
        signerCSingleAuditBuffer = Buffer.concat(chunksC);
        await page.getByTestId('btn-close-proof').click();

        const pdf = await PDFDocument.load(signerCSingleAuditBuffer, {updateMetadata: false});
        expect(pdf.getPageCount()).toBe(2);
        const signatures = await readPdfSignatures(signerCSingleAuditBuffer);
        expect(signatures.length).toBe(3);
    });

    test('13. REQ-19 TC-05: Tamper breaks chain at latest signer', async ({page}) => {
        test.skip(!signerCSingleAuditBuffer);
        const parsed = await PDFDocument.load(signerCSingleAuditBuffer!, {updateMetadata: false});
        parsed.setTitle('tampered');
        const tampered = Buffer.from(await parsed.save());

        await page.goto('/');
        await page.getByTestId('btn-verify-mode').click();
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({name: 'tampered.pdf', mimeType: 'application/pdf', buffer: tampered});
        await expect(page.getByTestId('chain-fail')).toBeVisible();
        await expect(page.getByTestId('chain-fail')).toContainText('3');
    });

    test('14. REQ-19: Preserve externally appended pages when refreshing audit page', async ({page}) => {
        test.skip(!signerCSingleAuditBuffer);

        const external = await PDFDocument.load(signerCSingleAuditBuffer!, {updateMetadata: false});
        for (let i = 0; i < 5; i++) {
            external.addPage([595.28, 841.89]);
        }
        const externallyAppended = Buffer.from(await external.save());

        await page.goto('/');
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({name: 'external-appended.pdf', mimeType: 'application/pdf', buffer: externallyAppended});

        await expect(page.getByTestId('handover-modal')).toBeVisible();
        await page.getByTestId('btn-skip-handover').click();
        await page.getByTestId('btn-add-date').click();

        const dl = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const d = await dl;
        const stream = await d.createReadStream();
        const chunks = [];
        for await (const chunk of stream!) chunks.push(chunk);
        const saved = Buffer.concat(chunks);

        const pdf = await PDFDocument.load(saved, {updateMetadata: false});
        expect(pdf.getPageCount()).toBe(8);
    });

    test('15. REQ-19: Tamper between signers must fail chain even if next signer skips handover', async ({page}) => {
        test.skip(!signerABuffer);

        const tamperedA = await PDFDocument.load(signerABuffer!, {updateMetadata: false});
        tamperedA.setTitle('tampered-between-signers');
        const tamperedABuffer = Buffer.from(await tamperedA.save());

        await page.goto('/');
        const chooserB = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooserB).setFiles({name: 'tampered-a.pdf', mimeType: 'application/pdf', buffer: tamperedABuffer});
        await expect(page.getByTestId('handover-modal')).toBeVisible();
        await page.getByTestId('btn-skip-handover').click();
        await page.getByTestId('btn-add-date').click();

        const dl = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const d = await dl;
        const stream = await d.createReadStream();
        const chunks = [];
        for await (const chunk of stream!) chunks.push(chunk);
        const tamperedSignedByB = Buffer.concat(chunks);
        await page.getByTestId('btn-close-proof').click();

        await page.goto('/');
        await page.getByTestId('btn-verify-mode').click();
        const chooserV = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooserV).setFiles({name: 'tampered-signed-b.pdf', mimeType: 'application/pdf', buffer: tamperedSignedByB});
        await expect(page.getByTestId('chain-fail')).toBeVisible();
        await expect(page.getByTestId('chain-fail')).toContainText('2');
    });
});
