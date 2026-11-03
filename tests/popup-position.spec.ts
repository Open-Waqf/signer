// popup-position.spec.ts: small popups are centred and stay above the phone keyboard;
// Verify (which grows while open) stays near the top.
import {expect, test, type Page} from '@playwright/test';
import {tid} from './support/ui';

const cardBox = (page: Page, testid: string) => page.getByTestId(testid).evaluate((host) => {
    const r = (host as HTMLElement).shadowRoot!.querySelector('.modal-card')!.getBoundingClientRect();
    return {top: r.top, bottom: r.bottom, centre: (r.top + r.bottom) / 2, height: window.innerHeight};
});

async function openEditPrompt(page: Page) {
    await page.goto('/');
    await page.getByTestId('btn-sample').click();
    await expect(page.getByTestId('btn-exit')).toBeVisible();
    await tid(page, 'btn-toggle-advanced').click();
    await tid(page, 'btn-add-identity').click();
    await expect(page.getByTestId('custom-prompt')).toBeVisible();
    await page.waitForTimeout(300);
}

test.describe('28. Popup position @phone', () => {
    test('28.1 The edit popup is centred on the screen', async ({page}) => {
        await openEditPrompt(page);
        const box = await cardBox(page, 'custom-prompt');
        expect(Math.abs(box.centre - box.height / 2)).toBeLessThan(box.height * 0.06);
    });

    test('28.2 When the keyboard covers the bottom, the popup moves up above it', async ({page}) => {
        // A fake visual viewport: the keyboard covers the bottom 320 px of the screen.
        await page.addInitScript(() => {
            const target = new EventTarget() as any;
            target.offsetTop = 0;
            Object.defineProperty(target, 'height', {get: () => window.innerHeight - (window as any).__kb});
            (window as any).__kb = 0;
            (window as any).__showKeyboard = () => { (window as any).__kb = 320; target.dispatchEvent(new Event('resize')); };
            Object.defineProperty(window, 'visualViewport', {configurable: true, get: () => target});
        });
        await openEditPrompt(page);
        await page.evaluate(() => (window as any).__showKeyboard());
        await page.waitForTimeout(200);
        const box = await cardBox(page, 'custom-prompt');
        expect(box.bottom, 'card above the keyboard').toBeLessThanOrEqual(box.height - 320);
        expect(box.top, 'card still on screen').toBeGreaterThanOrEqual(0);
    });

    test('28.3 Verify stays near the top', async ({page}) => {
        await page.goto('/?id=0000000000000000');
        await expect(page.getByTestId('btn-start-verify')).toBeVisible();
        const box = await page.locator('owq-modal[top][open]').evaluate((host) => {
            const r = (host as HTMLElement).shadowRoot!.querySelector('.modal-card')!.getBoundingClientRect();
            return {top: r.top, height: window.innerHeight};
        });
        expect(box.top).toBeLessThan(box.height * 0.15);
    });
});
