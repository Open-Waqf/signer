// ui.ts: one test, two screen sizes.
//
// On phones (screen 768 px wide or less) the toolbar buttons live in the bottom bar and have
// an `m-` test id; on desktop they live in the top toolbar. `tid(page, 'btn-add-date')`
// returns the button that is actually on screen, so the same test runs in both projects.
import type {Locator, Page} from '@playwright/test';

const PHONE_ID: Record<string, string> = {
    'btn-add-sig': 'm-btn-add-sig',
    'btn-add-date': 'm-btn-add-date',
    'btn-add-initials': 'm-btn-add-initials',
    'btn-add-text': 'm-btn-add-text',
    'btn-add-stamp': 'm-btn-add-stamp',
    'btn-add-identity': 'm-btn-add-identity',
    'btn-toggle-advanced': 'm-btn-toggle-advanced',
    'btn-cert-sign': 'm-btn-cert-sign',
    'btn-save': 'm-btn-finish',
    // On phones the two option switches sit in the bottom bar with the other tools.
    'btn-toggle-footer': 'm-btn-toggle-footer',
    'btn-toggle-audit': 'm-btn-toggle-audit',
};

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 768;

export function tid(page: Page, testId: string): Locator {
    return page.getByTestId(isPhone(page) && PHONE_ID[testId] ? PHONE_ID[testId] : testId);
}

/** "Apply to all pages" sits behind the style bar's "⋯" button. */
export async function applyToAllPages(page: Page, options?: {timeout?: number}) {
    const more = page.getByTestId('btn-style-more');
    if (!(await page.getByTestId('btn-apply-all').isVisible())) await more.click(options);
    await page.getByTestId('btn-apply-all').click(options);
}

/** Verify: the record and signer history are under a closed "Details" section. */
export async function openVerifyDetails(page: Page) {
    const details = page.getByTestId('verify-details');
    if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await page.getByTestId('verify-details-toggle').click();
}
