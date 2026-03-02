import {Capacitor} from '@capacitor/core';

export function isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
}

export function isMobileViewport(): boolean {
    return window.innerWidth < 768;
}

export function isNativeOrSmallViewport(): boolean {
    return isNativePlatform() || isMobileViewport();
}

