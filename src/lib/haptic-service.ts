import {Haptics, ImpactStyle} from '@capacitor/haptics';
import {Capacitor} from '@capacitor/core';

export class HapticService {
    static async impact(style: ImpactStyle = ImpactStyle.Light) {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.impact({style});
            } catch (e) {
                console.error('Haptics error:', e);
            }
        }
    }

    static async success() {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.notification({type: 'SUCCESS' as any});
            } catch (e) {
                console.error('Haptics error:', e);
            }
        }
    }

    static async selection() {
        if (Capacitor.isNativePlatform()) {
            try {
                await Haptics.selectionStart();
            } catch (e) {
                console.error('Haptics error:', e);
            }
        }
    }
}
