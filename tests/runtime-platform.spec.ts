import {expect, test} from '@playwright/test';
import {Capacitor} from '@capacitor/core';
import {isMobileViewport, isNativeOrSmallViewport} from '../src/lib/runtime-platform';

function setWindowWidth(width: number) {
    const target = globalThis as any;
    if (!target.window) target.window = {};
    Object.defineProperty(target.window, 'innerWidth', {value: width, configurable: true});
}

test('runtime-platform detects small viewport', async () => {
    setWindowWidth(767);
    expect(isMobileViewport()).toBeTruthy();

    setWindowWidth(1200);
    expect(isMobileViewport()).toBeFalsy();
});

test('runtime-platform native-or-small checks both native and viewport', async () => {
    const original = Capacitor.isNativePlatform;

    Object.defineProperty(Capacitor, 'isNativePlatform', {
        value: () => false,
        configurable: true,
    });
    setWindowWidth(1200);
    expect(isNativeOrSmallViewport()).toBeFalsy();

    setWindowWidth(500);
    expect(isNativeOrSmallViewport()).toBeTruthy();

    Object.defineProperty(Capacitor, 'isNativePlatform', {
        value: () => true,
        configurable: true,
    });
    setWindowWidth(1200);
    expect(isNativeOrSmallViewport()).toBeTruthy();

    Object.defineProperty(Capacitor, 'isNativePlatform', {
        value: original,
        configurable: true,
    });
});
