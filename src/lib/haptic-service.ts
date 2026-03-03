import {Haptics, ImpactStyle} from '@capacitor/haptics';
import {Capacitor} from '@capacitor/core';

export class HapticService {
    private static vibrateFallback(durationMs = 10) {
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate(durationMs);
            }
        } catch {
            // Ignore unsupported or blocked vibration APIs.
        }
    }

    static async impact(style: ImpactStyle = ImpactStyle.Light) {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.impact({style});
            } catch (e) {
                console.error('Haptics error:', e);
            }
            return;
        }
        this.vibrateFallback(10);
    }

    static async success() {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.notification({type: 'SUCCESS' as any});
            } catch (e) {
                console.error('Haptics error:', e);
            }
            return;
        }
        this.vibrateFallback(15);
    }

    static async selection() {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.selectionStart();
            } catch (e) {
                console.error('Haptics error:', e);
            }
            return;
        }
        this.vibrateFallback(10);
    }
}
