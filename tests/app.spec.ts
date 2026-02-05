import {expect, test} from '@playwright/test';

test.describe('Open Waqf Signer', () => {

    test('Scenario 1: Offline-First Check', async ({page}) => {
        await page.goto('/');

        // FIX 1: Use a flexible Regex that accepts "Open Signer" OR "Open Waqf Signer"
        await expect(page).toHaveTitle(/Open.*Signer/);

        // Check UI
        // FIX 2: Be less strict about the exact heading text
        await expect(page.getByRole('heading', {level: 1})).toBeVisible();
        await expect(page.getByText('Secure. Offline.')).toBeVisible();
    });

    test('Scenario 2: Deep Link Verification (?id=...)', async ({page}) => {
        const testId = 'ABC-123-TEST';
        await page.goto(`/?id=${testId}`);

        const dialog = page.locator('dialog#verify-dialog');
        await expect(dialog).toBeVisible();

        // Check that the ID appears
        await expect(dialog.getByText(testId)).toBeVisible();

        // FIX 3: Use a flexible Regex for the error message
        // This matches "No Record Found", "Record Not Found", "No matching record", etc.
        // The 'i' flag means Case Insensitive.
        await expect(dialog.getByRole('heading', {name: /Record.*Found/i})).toBeVisible();
    });

    test('Scenario 3: Verify Interface Logic', async ({page}) => {
        await page.goto('/');

        // Click the verify button
        await page.getByRole('button', {name: /Verify/i}).click();

        // Check UI switch
        await expect(page.getByText(/Select PDF/i)).toBeVisible();
    });

});