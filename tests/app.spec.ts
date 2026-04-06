import {expect, test} from '@playwright/test';
import {generateTestPDF} from './utils';
import {PDFDocument} from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 🌍 SHARED STATE
// ---------------------------------------------------------------------------
let aliceSignedBuffer: Buffer | null = null;
let signerABuffer: Buffer | null = null;
let signerBBuffer: Buffer | null = null;
let signerCSingleAuditBuffer: Buffer | null = null;
const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAukB9oN2VN8AAAAASUVORK5CYII=',
    'base64'
);

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

    test('2.2 PWA update banner reload triggers service worker activation callback', async ({page}) => {
        await page.goto('/');
        await page.evaluate(() => {
            const app = document.querySelector('app-root') as any;
            (window as any).__updateReloadArg = null;
            app.updateSW = (reload: boolean) => {
                (window as any).__updateReloadArg = reload;
            };
            app.updateAvailable = true;
            app.requestUpdate();
        });

        await expect(page.getByTestId('btn-update-reload')).toBeVisible();
        await page.getByTestId('btn-update-reload').click();
        await expect.poll(async () => page.evaluate(() => (window as any).__updateReloadArg)).toBe(true);
    });

    test('2.3 Modal host uses native dialog element', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('link-privacy').click();
        const hasDialog = await page.locator('owq-modal[open]').first().evaluate((el) => {
            const root = (el as HTMLElement).shadowRoot;
            return !!root?.querySelector('dialog[open]');
        });
        expect(hasDialog).toBe(true);
    });

    test('2.5 RTL: Modal direction follows selected language', async ({page}) => {
        await page.goto('/');

        await page.getByTestId('select-lang-home').selectOption('ar');
        await page.getByTestId('link-privacy').click();
        const rtlModal = await page.locator('owq-modal[open]').first().evaluate((el) => {
            const root = (el as HTMLElement).shadowRoot;
            const card = root?.querySelector('.modal-card') as HTMLElement | null;
            const shell = root?.querySelector('.modal-shell') as HTMLElement | null;
            return {
                overlayDir: shell?.getAttribute('dir') || '',
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
            const shell = root?.querySelector('.modal-shell') as HTMLElement | null;
            return {
                overlayDir: shell?.getAttribute('dir') || '',
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
            const shell = root?.querySelector('.modal-shell') as HTMLElement | null;
            return {
                overlayDir: shell?.getAttribute('dir') || '',
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

        await expect.poll(async () => {
            return page.getByTestId('diagnostics-modal').evaluate((el) => {
                const root = (el as HTMLElement).shadowRoot;
                const dialog = root?.querySelector('dialog');
                return !!dialog?.hasAttribute('open');
            });
        }).toBe(true);
        await page.getByTestId('btn-close-diagnostics').click();
        await expect(page.getByTestId('diagnostics-modal')).not.toBeVisible();
    });

    test('3.2 Sample flow repeatedly opens workspace', async ({page}) => {
        await page.goto('/');
        for (let i = 0; i < 3; i++) {
            await page.getByTestId('btn-sample').click();
            await expect(page.getByTestId('btn-exit')).toBeVisible();
            await page.getByTestId('btn-exit').click();
            await expect(page.getByTestId('btn-select-file')).toBeVisible();
        }
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
        await page.getByTestId('btn-add-date').click();
        const downloadPromise = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        await downloadPromise;
        await page.getByTestId('btn-close-proof').click();
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

    test('4.5 Workflow: Certificate signing with .p12 works and wrong password is handled', async ({page}) => {
        const certPath = path.join(process.cwd(), 'tests/fixtures/test-cert.p12');
        const certBuffer = fs.readFileSync(certPath);

        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await page.getByTestId('btn-add-date').click();
        await page.getByTestId('btn-toggle-advanced').click();

        const certChooserPromise = page.waitForEvent('filechooser');
        await page.getByTestId('btn-cert-sign').click();
        const certChooser = await certChooserPromise;
        await certChooser.setFiles({
            name: 'test-cert.p12',
            mimeType: 'application/x-pkcs12',
            buffer: certBuffer,
        });

        const certModal = page.getByTestId('cert-password-modal');
        await expect(certModal).toBeVisible();

        await page.getByTestId('input-cert-password').fill('wrong-password');
        await page.getByTestId('btn-cert-confirm').click();
        await expect(certModal).toBeVisible();
        await expect(page.locator('.toast')).toContainText(/Invalid certificate or password/i);

        await page.getByTestId('input-cert-password').fill('owq-test-1234');
        await page.getByTestId('btn-cert-confirm').click();
        await expect(certModal).not.toBeVisible();

        const downloadPromise = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/_signed_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$/);

        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const signedBuffer = Buffer.concat(chunks);
        const signedRaw = signedBuffer.toString('latin1');
        expect(signedRaw).toContain('/ByteRange');
    });

    test('4.6 Verify mode: Detect CMS signature banner and verify generated hash for p12-signed file', async ({page}) => {
        const certPath = path.join(process.cwd(), 'tests/fixtures/test-cert.p12');
        const certBuffer = fs.readFileSync(certPath);

        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await page.getByTestId('btn-add-date').click();
        await page.getByTestId('btn-toggle-advanced').click();

        const certChooserPromise = page.waitForEvent('filechooser');
        await page.getByTestId('btn-cert-sign').click();
        const certChooser = await certChooserPromise;
        await certChooser.setFiles({
            name: 'test-cert.p12',
            mimeType: 'application/x-pkcs12',
            buffer: certBuffer,
        });
        await page.getByTestId('input-cert-password').fill('owq-test-1234');
        await page.getByTestId('btn-cert-confirm').click();
        await expect(page.getByTestId('cert-password-modal')).not.toBeVisible();

        const downloadPromise = page.waitForEvent('download');
        await page.getByTestId('btn-save').click();
        const download = await downloadPromise;
        const generatedHash = (await page.getByTestId('saved-doc-hash').innerText()).trim();

        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const signedBuffer = Buffer.concat(chunks);

        await page.getByTestId('btn-close-proof').click();
        await page.getByTestId('btn-exit').click();
        await page.getByTestId('btn-verify-mode').click();

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles({
            name: 'p12_signed.pdf',
            mimeType: 'application/pdf',
            buffer: signedBuffer,
        });

        await expect(page.getByTestId('cms-signature-banner')).toBeVisible();
        await expect(page.getByTestId('verify-success-title')).toBeVisible();

        await page.getByTestId('input-verify-hash').fill(generatedHash);
        await page.getByTestId('btn-check-hash').click();
        await expect(page.getByTestId('integrity-success')).toBeVisible();

        const chainSuccess = page.getByTestId('chain-success');
        const chainFail = page.getByTestId('chain-fail');
        expect((await chainSuccess.count()) + (await chainFail.count())).toBeGreaterThan(0);
    });

    test('4.7 Share fallback: web share failure still downloads on first click', async ({page}) => {
        await page.addInitScript(() => {
            const navAny = navigator as any;
            (window as any).__owqShareCalled = 0;
            const failingShare = async () => {
                (window as any).__owqShareCalled += 1;
                throw new Error('Simulated share failure');
            };
            const canShare = () => true;

            try {
                Object.defineProperty(navAny, 'share', {value: failingShare, configurable: true});
                Object.defineProperty(navAny, 'canShare', {value: canShare, configurable: true});
            } catch {
                // ignore and try prototype fallback
            }

            try {
                const proto = Object.getPrototypeOf(navAny);
                Object.defineProperty(proto, 'share', {value: failingShare, configurable: true});
                Object.defineProperty(proto, 'canShare', {value: canShare, configurable: true});
            } catch {
                // ignore
            }
        });

        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.getByTestId('btn-exit')).toBeVisible();
        await page.getByTestId('btn-add-date').click();

        const downloadPromise = page.waitForEvent('download');
        await page.getByTestId('btn-share').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/_signed_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$/);
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

    test('6.1 Signature presets persist across reload via IndexedDB', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await page.getByTestId('btn-add-sig').click();
        const sigPad = page.getByTestId('signature-pad');
        await expect(sigPad).toBeVisible();

        const box = await sigPad.boundingBox();
        if (!box) throw new Error('Missing signature pad bounds');
        await page.mouse.move(box.x + 18, box.y + 18);
        await page.mouse.down();
        await page.mouse.move(box.x + 90, box.y + 90);
        await page.mouse.up();

        await page.getByTestId('btn-save-preset').click();
        await page.getByTestId('input-preset-name').fill('E2E IndexedDB Preset');
        await page.getByTestId('btn-confirm-preset').click();
        await expect(page.locator('.preset-item[title=\"E2E IndexedDB Preset\"]')).toHaveCount(1);
        await page.evaluate(() => {
            document.querySelector('signature-modal')?.remove();
        });

        await page.reload();
        await page.getByTestId('btn-sample').click();
        await page.getByTestId('btn-add-sig').click();
        await expect(page.locator('.preset-item[title=\"E2E IndexedDB Preset\"]')).toHaveCount(1);
    });

    test('6.1.1 Signature pad does not draw a dot on pointer down without movement', async ({page}) => {
        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await page.getByTestId('btn-add-sig').click();
        const sigPad = page.getByTestId('signature-pad');
        await expect(sigPad).toBeVisible();

        const box = await sigPad.boundingBox();
        if (!box) throw new Error('Missing signature pad bounds');

        await page.mouse.move(box.x + 48, box.y + 48);
        await page.mouse.down();
        await page.mouse.up();

        await expect(page.getByTestId('btn-save-preset')).toHaveCount(0);

        const blankAlphaPixels = await sigPad.evaluate((canvas) => {
            const ctx = (canvas as HTMLCanvasElement).getContext('2d');
            if (!ctx) return -1;
            const {data} = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let inkPixels = 0;
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] > 8) inkPixels++;
            }
            return inkPixels;
        });
        expect(blankAlphaPixels).toBe(0);

        await page.mouse.move(box.x + 48, box.y + 48);
        await page.mouse.down();
        await page.mouse.move(box.x + 132, box.y + 92);
        await page.mouse.up();

        await expect(page.getByTestId('btn-save-preset')).toBeVisible();
        const drawnAlphaPixels = await sigPad.evaluate((canvas) => {
            const ctx = (canvas as HTMLCanvasElement).getContext('2d');
            if (!ctx) return -1;
            const {data} = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let inkPixels = 0;
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] > 8) inkPixels++;
            }
            return inkPixels;
        });
        expect(drawnAlphaPixels).toBeGreaterThan(0);
    });

    test('6.2 Stamp presets persist across reload via IndexedDB', async ({page}) => {
        const ensureAdvancedToolsVisible = async () => {
            if (await page.getByTestId('btn-add-stamp').count()) return;
            await page.getByTestId('btn-toggle-advanced').click();
            await expect(page.getByTestId('btn-add-stamp')).toBeVisible();
        };

        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.locator('pdf-workspace')).toBeVisible();

        await expect(page.getByTestId('btn-add-stamp')).toHaveCount(0);
        await ensureAdvancedToolsVisible();
        const hwPrefCount = await page.getByTestId('btn-hw-pref').count();
        expect(hwPrefCount).toBeLessThanOrEqual(1);

        await page.getByTestId('btn-add-stamp').click();
        await expect(page.getByTestId('stamp-library-modal')).toBeVisible();
        await page.getByTestId('btn-close-stamp-library').click();
        await expect(page.getByTestId('stamp-library-modal')).not.toBeVisible();

        await page.getByTestId('btn-add-stamp').click();
        await expect(page.getByTestId('stamp-library-modal')).toBeVisible();

        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-stamp-upload').click();
        (await chooser).setFiles({
            name: 'tiny-stamp.png',
            mimeType: 'image/png',
            buffer: TINY_PNG,
        });

        await expect(page.getByTestId('stamp-library-modal')).not.toBeVisible();
        await expect(page.locator('[data-testid^="annotation-"]')).toHaveCount(1);

        await page.getByTestId('btn-add-stamp').click();
        await expect(page.locator('[data-testid^="stamp-preset-"]')).toHaveCount(1);
        await page.getByTestId('btn-close-stamp-library').click();

        await page.reload();
        await page.getByTestId('btn-sample').click();
        await expect(page.locator('pdf-workspace')).toBeVisible();
        await ensureAdvancedToolsVisible();
        await page.getByTestId('btn-add-stamp').click();
        await expect(page.locator('[data-testid^="stamp-preset-"]')).toHaveCount(1);
    });

    test('6.3 Thumbnails lazy-load with blob URLs and deep pages render on demand', async ({page}) => {
        const bigPdf = await PDFDocument.create();
        for (let i = 0; i < 120; i++) {
            bigPdf.addPage([595, 842]);
        }
        const bigPdfBytes = Buffer.from(await bigPdf.save());

        await page.goto('/');
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({
            name: 'big-120-pages.pdf',
            mimeType: 'application/pdf',
            buffer: bigPdfBytes,
        });

        const ws = page.locator('pdf-workspace');
        await expect(ws).toBeVisible();
        const toggleBtn = page.getByTestId('btn-toggle-thumbs');
        const isActive = await toggleBtn.evaluate((el) => el.classList.contains('active'));
        if (!isActive) await toggleBtn.click();
        await expect(page.locator('.thumb-panel')).toBeVisible();

        await expect.poll(async () => {
            const src = await page.getByTestId('thumb-page-1').locator('img').first().getAttribute('src');
            return src || '';
        }).toMatch(/^blob:/);

        await expect(page.getByTestId('thumb-page-120').locator('img')).toHaveCount(0);

        await ws.evaluate((el) => {
            const panel = (el.shadowRoot?.querySelector('.thumb-panel') as HTMLElement | null);
            if (panel) panel.scrollTop = panel.scrollHeight;
        });

        await expect.poll(async () => page.getByTestId('thumb-page-120').locator('img').count()).toBe(1);
        await expect.poll(async () => {
            const src = await page.getByTestId('thumb-page-120').locator('img').getAttribute('src');
            return src || '';
        }).toMatch(/^blob:/);
    });

    test('6.4 Stamp upload size cap rejects oversized files gracefully', async ({page}) => {
        const openStampLibrary = async () => {
            await page.locator('pdf-workspace').evaluate((el) => {
                const ws = el as any;
                ws.uiMode = 'advanced';
                ws.showStampLibraryModal = true;
                ws.requestUpdate();
            });
        };

        await page.goto('/');
        await page.getByTestId('btn-sample').click();
        await expect(page.locator('pdf-workspace')).toBeVisible();
        await openStampLibrary();
        await expect(page.getByTestId('stamp-library-modal')).toBeVisible();

        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-stamp-upload').click();
        (await chooser).setFiles({
            name: 'too-big-stamp.png',
            mimeType: 'image/png',
            buffer: Buffer.alloc(6 * 1024 * 1024, 1),
        });

        await expect(page.locator('.toast')).toContainText(/too large|max/i);
        await expect(page.locator('[data-testid^="annotation-"]')).toHaveCount(0);
    });

    test('6.5 Thumbnail blob URLs are revoked on workspace reset', async ({page}) => {
        await page.goto('/');
        await page.evaluate(() => {
            const original = URL.revokeObjectURL.bind(URL);
            (window as any).__revokeCalls = [];
            (window as any).__originalRevoke = original;
            URL.revokeObjectURL = ((url: string) => {
                (window as any).__revokeCalls.push(url);
                original(url);
            }) as typeof URL.revokeObjectURL;
        });

        await page.getByTestId('btn-sample').click();
        const ws = page.locator('pdf-workspace');
        await expect(ws).toBeVisible();

        const toggleBtn = page.getByTestId('btn-toggle-thumbs');
        const isActive = await toggleBtn.evaluate((el) => el.classList.contains('active'));
        if (!isActive) await toggleBtn.click();

        await expect.poll(async () => {
            const src = await page.getByTestId('thumb-page-1').locator('img').first().getAttribute('src');
            return src || '';
        }).toMatch(/^blob:/);

        await ws.evaluate((el) => {
            (el as any).reset();
        });

        await expect.poll(async () => {
            return page.evaluate(() => (window as any).__revokeCalls.length || 0);
        }).toBeGreaterThan(0);

        await page.evaluate(() => {
            const original = (window as any).__originalRevoke as typeof URL.revokeObjectURL | undefined;
            if (original) URL.revokeObjectURL = original;
        });
    });

    test('6.6 Thumbnail rapid-scroll prioritizes final viewport pages', async ({page}) => {
        const bigPdf = await PDFDocument.create();
        for (let i = 0; i < 220; i++) {
            bigPdf.addPage([595, 842]);
        }
        const bigPdfBytes = Buffer.from(await bigPdf.save());

        await page.goto('/');
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({
            name: 'rapid-scroll-220-pages.pdf',
            mimeType: 'application/pdf',
            buffer: bigPdfBytes,
        });

        const ws = page.locator('pdf-workspace');
        await expect(ws).toBeVisible();
        const toggleBtn = page.getByTestId('btn-toggle-thumbs');
        const isActive = await toggleBtn.evaluate((el) => el.classList.contains('active'));
        if (!isActive) await toggleBtn.click();
        await expect(page.locator('.thumb-panel')).toBeVisible();

        await ws.evaluate((el) => {
            const panel = (el.shadowRoot?.querySelector('.thumb-panel') as HTMLElement | null);
            if (!panel) return;
            panel.scrollTop = 0;
            panel.scrollTop = panel.scrollHeight * 0.35;
            panel.scrollTop = panel.scrollHeight * 0.7;
            panel.scrollTop = panel.scrollHeight;
        });

        await expect.poll(async () => page.getByTestId('thumb-page-220').locator('img').count()).toBe(1);
        await expect.poll(async () => {
            const src = await page.getByTestId('thumb-page-220').locator('img').getAttribute('src');
            return src || '';
        }).toMatch(/^blob:/);
    });

    test('6.7 Thumbnail blob cache stays under cap after deep scrolling', async ({page}) => {
        const bigPdf = await PDFDocument.create();
        for (let i = 0; i < 300; i++) {
            bigPdf.addPage([595, 842]);
        }
        const bigPdfBytes = Buffer.from(await bigPdf.save());

        await page.goto('/');
        const chooser = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        (await chooser).setFiles({
            name: 'cache-cap-300-pages.pdf',
            mimeType: 'application/pdf',
            buffer: bigPdfBytes,
        });

        const ws = page.locator('pdf-workspace');
        await expect(ws).toBeVisible();
        const toggleBtn = page.getByTestId('btn-toggle-thumbs');
        const isActive = await toggleBtn.evaluate((el) => el.classList.contains('active'));
        if (!isActive) await toggleBtn.click();
        await expect(page.locator('.thumb-panel')).toBeVisible();

        await ws.evaluate(async (el) => {
            const root = el.shadowRoot;
            const panel = root?.querySelector('.thumb-panel') as HTMLElement | null;
            if (!panel) return;
            const stops = [0.15, 0.4, 0.65, 1];
            for (const stop of stops) {
                panel.scrollTop = panel.scrollHeight * stop;
                await new Promise((resolve) => setTimeout(resolve, 180));
            }
        });

        const loadedCount = await ws.evaluate((el) => {
            const comp = el as any;
            return (comp.thumbnailURLs as Array<string | null>).filter((u) => !!u).length;
        });
        expect(loadedCount).toBeLessThanOrEqual(48);
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

    test('9. Workflow: Batch Operations (Desktop marquee + Delete)', async ({page}) => {
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
        for (let i = 0; i < 3; i++) {
            await ws.getByTestId('btn-add-date').click();
            await page.waitForTimeout(100);
        }

        await expect(ws.locator('[data-testid^="annotation-"]')).toHaveCount(3);

        await ws.evaluate((el) => {
            const comp = el as any;
            comp.annotations = comp.annotations.map((a: any, i: number) => ({
                ...a,
                xPct: 0.1 + (i * 0.22),
                yPct: 0.12 + (i * 0.08),
            }));
            comp.requestUpdate();
        });

        const pageContainer = ws.getByTestId('page-container');
        const box = await pageContainer.boundingBox();
        if (!box) throw new Error('Missing page container');

        const startX = box.x + box.width * 0.04;
        const startY = box.y + box.height * 0.04;
        const endX = box.x + box.width * 0.38;
        const endY = box.y + box.height * 0.29;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(endX, endY);
        await page.mouse.up();

        const selected = ws.locator('.draggable.selected');
        await expect(selected).toHaveCount(2);

        await page.keyboard.press('Delete');
        await expect(ws.locator('[data-testid^="annotation-"]')).toHaveCount(1);
    });

    test('9.1 Workflow: Mobile long-press enables multi-select tap-add', async ({page}) => {
        await page.goto('/');
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        const fileChooser = await fileChooserPromise;
        const pdfBuffer = await generateTestPDF();
        await fileChooser.setFiles({
            name: 'touch_batch_test.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from(pdfBuffer),
        });

        const ws = page.locator('pdf-workspace');
        await expect(ws).toBeVisible();
        await ws.getByTestId('btn-add-date').click();
        await ws.getByTestId('btn-add-date').click();
        await expect(ws.locator('[data-testid^="annotation-"]')).toHaveCount(2);

        await ws.evaluate((el) => {
            const comp = el as any;
            comp.annotations = comp.annotations.map((a: any, i: number) => ({
                ...a,
                xPct: 0.14 + (i * 0.3),
                yPct: 0.18 + (i * 0.16),
            }));
            comp.requestUpdate();
        });

        const anns = ws.locator('[data-testid^="annotation-"]');
        const ann1 = anns.nth(0);
        const ann2 = anns.nth(1);

        await ann1.evaluate((node) => {
            const rect = (node as HTMLElement).getBoundingClientRect();
            const event = new Event('touchstart', {bubbles: true, cancelable: true});
            Object.defineProperty(event, 'touches', {
                value: [{clientX: rect.left + 5, clientY: rect.top + 5}],
            });
            node.dispatchEvent(event);
        });
        await page.waitForTimeout(620);
        await page.evaluate(() => {
            const endEvent = new Event('touchend', {bubbles: true, cancelable: true});
            Object.defineProperty(endEvent, 'changedTouches', {value: []});
            window.dispatchEvent(endEvent);
        });

        await ann2.evaluate((node) => {
            const rect = (node as HTMLElement).getBoundingClientRect();
            const event = new Event('touchstart', {bubbles: true, cancelable: true});
            Object.defineProperty(event, 'touches', {
                value: [{clientX: rect.left + 5, clientY: rect.top + 5}],
            });
            node.dispatchEvent(event);
        });
        await page.evaluate(() => {
            const endEvent = new Event('touchend', {bubbles: true, cancelable: true});
            Object.defineProperty(endEvent, 'changedTouches', {value: []});
            window.dispatchEvent(endEvent);
        });

        await expect(ws.locator('.draggable.selected')).toHaveCount(2);
    });

    test('9.2 Workflow: snap guideline movement does not vibrate', async ({page}) => {
        await page.goto('/');
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByTestId('btn-select-file').click();
        const fileChooser = await fileChooserPromise;
        const pdfBuffer = await generateTestPDF();
        await fileChooser.setFiles({
            name: 'snap_haptic_test.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from(pdfBuffer),
        });

        const ws = page.locator('pdf-workspace');
        await ws.getByTestId('btn-add-date').click();
        await ws.getByTestId('btn-add-date').click();
        await expect(ws.locator('[data-testid^="annotation-"]')).toHaveCount(2);

        await page.evaluate(() => {
            (window as any).__vibrateCalls = 0;
            const original = navigator.vibrate?.bind(navigator);
            (window as any).__originalVibrate = original;
            (navigator as any).vibrate = () => {
                (window as any).__vibrateCalls += 1;
                return true;
            };
        });

        const anns = ws.locator('[data-testid^="annotation-"]');
        const first = anns.nth(0);
        const second = anns.nth(1);
        const firstBox = await first.boundingBox();
        const secondBox = await second.boundingBox();
        if (!firstBox || !secondBox) throw new Error('Missing annotation bounds');

        // Drag first near second to trigger snapping guides repeatedly while moving.
        const startX = firstBox.x + firstBox.width / 2;
        const startY = firstBox.y + firstBox.height / 2;
        const endX = secondBox.x + secondBox.width / 2;
        const endY = secondBox.y + secondBox.height / 2;

        await page.mouse.move(startX, startY);
        await page.mouse.down();
        for (let i = 0; i < 8; i++) {
            const t = (i + 1) / 8;
            await page.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
        }
        await page.mouse.up();

        const calls = await page.evaluate(() => (window as any).__vibrateCalls || 0);
        expect(calls).toBe(0);

        await page.evaluate(() => {
            const original = (window as any).__originalVibrate;
            if (original) {
                (navigator as any).vibrate = original;
            }
            delete (window as any).__originalVibrate;
            delete (window as any).__vibrateCalls;
        });
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
        test.setTimeout(90_000);
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error' || msg.type() === 'warning') {
                consoleErrors.push(`${msg.type()}: ${msg.text()}`);
            }
        });

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

        await page.locator('pdf-workspace').evaluate(async (el) => {
            const ws = el as any;
            await ws.saveDocument({silentWeb: true, showToast: false, suppressProofModal: true});
        });
        const saved = await page.locator('pdf-workspace').evaluate((el) => {
            const ws = el as any;
            const bytes = ws.lastSavedBytes as Uint8Array | null;
            if (!bytes) {
                return null;
            }
            return Array.from(bytes);
        });
        if (!saved) {
            throw new Error(`lastSavedBytes unavailable after save. Console:\n${consoleErrors.join('\n')}`);
        }
        const savedBuffer = Buffer.from(saved);

        const pdf = await PDFDocument.load(savedBuffer, {updateMetadata: false});
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
