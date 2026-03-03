import {expect, test} from '@playwright/test';
import {HapticService} from '../src/lib/haptic-service';

test.describe('haptic-service web fallback', () => {
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    const withMockedNavigatorVibrate = async (run: (calls: number[]) => Promise<void>) => {
        const currentNavigator = (globalThis as any).navigator ?? {};
        const calls: number[] = [];
        const mockedNavigator = {
            ...currentNavigator,
            vibrate: (duration: number) => {
                calls.push(duration);
                return true;
            },
        };

        Object.defineProperty(globalThis, 'navigator', {
            value: mockedNavigator,
            configurable: true,
            writable: true,
        });

        try {
            await run(calls);
        } finally {
            if (originalNavigatorDescriptor) {
                Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
            } else {
                delete (globalThis as any).navigator;
            }
        }
    };

    test('impact uses navigator.vibrate on web platforms', async () => {
        await withMockedNavigatorVibrate(async (calls) => {
            await HapticService.impact();
            expect(calls.length).toBeGreaterThan(0);
            expect(calls[0]).toBe(10);
        });
    });

    test('selection uses navigator.vibrate on web platforms', async () => {
        await withMockedNavigatorVibrate(async (calls) => {
            await HapticService.selection();
            expect(calls.length).toBeGreaterThan(0);
            expect(calls[0]).toBe(10);
        });
    });
});
