import {expect, test} from '@playwright/test';
import {HapticService} from '../src/lib/haptic-service';

test.describe('haptic-service web fallback', () => {
    test('impact uses navigator.vibrate on web platforms', async () => {
        const originalVibrate = navigator.vibrate;
        const calls: number[] = [];
        (navigator as any).vibrate = (duration: number) => {
            calls.push(duration);
            return true;
        };
        try {
            await HapticService.impact();
            expect(calls.length).toBeGreaterThan(0);
            expect(calls[0]).toBe(10);
        } finally {
            (navigator as any).vibrate = originalVibrate;
        }
    });

    test('selection uses navigator.vibrate on web platforms', async () => {
        const originalVibrate = navigator.vibrate;
        const calls: number[] = [];
        (navigator as any).vibrate = (duration: number) => {
            calls.push(duration);
            return true;
        };
        try {
            await HapticService.selection();
            expect(calls.length).toBeGreaterThan(0);
            expect(calls[0]).toBe(10);
        } finally {
            (navigator as any).vibrate = originalVibrate;
        }
    });
});
