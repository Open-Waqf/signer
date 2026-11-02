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
};

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 768;

export function tid(page: Page, testId: string): Locator {
    return page.getByTestId(isPhone(page) && PHONE_ID[testId] ? PHONE_ID[testId] : testId);
}
