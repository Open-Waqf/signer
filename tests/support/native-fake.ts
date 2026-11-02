// native-fake.ts: run the web app in Playwright as if it were the Android app.
//
// Capacitor talks to Android through a bridge that the Android app injects into the page
// (`window.androidBridge` and `window.Capacitor.nativePromise`). This file injects a fake
// bridge before the app loads, so:
//   - Capacitor.isNativePlatform() is true and getPlatform() is 'android',
//   - every plugin call (Filesystem, Share, App, ...) is answered here and recorded,
//   - tests can fire Android events, such as the Back button or an "Open with" file.
// It tests the app's own Android logic. It cannot show real Android behaviour (share sheet
// UI, file permissions, system bars): that is what the Maestro phone flows are for.
import type {Page} from '@playwright/test';

export type NativeCall = {plugin: string; method: string; options: any};

export type FakeAndroidOptions = {
    /** URL the app was launched with (an "Open with" intent), e.g. content://…/contract.pdf */
    launchUrl?: string;
    /** Files Filesystem.readFile can return: path -> base64 data */
    files?: Record<string, string>;
    /** Make Filesystem.writeFile fail (for example storage full) */
    failWrite?: boolean;
    /**
     * Documents files left by an earlier install: on Android 11+ the app cannot see them
     * (stat fails) and cannot delete or replace them (delete/write fail).
     */
    foreignFiles?: string[];
};

// Every native method the app calls (src/), per plugin. A method missing here would make
// Capacitor throw "not implemented", which a test would show at once.
const METHODS: Record<string, string[]> = {
    App: ['addListener', 'removeListener', 'removeAllListeners', 'exitApp', 'getLaunchUrl'],
    Filesystem: ['writeFile', 'appendFile', 'deleteFile', 'getUri', 'readFile', 'stat', 'addListener', 'removeListener'],
    Share: ['share'],
    Haptics: ['impact', 'notification', 'vibrate', 'selectionStart', 'selectionChanged', 'selectionEnd'],
    StatusBar: ['setStyle', 'setBackgroundColor', 'setOverlaysWebView', 'show', 'hide'],
    BarcodeScanner: ['isSupported', 'requestPermissions', 'startScan', 'stopScan', 'addListener', 'removeListener', 'removeAllListeners'],
};

export async function fakeAndroid(page: Page, options: FakeAndroidOptions = {}) {
    await page.addInitScript(({methods, options}) => {
        const DOCUMENTS = 'file:///storage/emulated/0/Documents/';
        const calls: any[] = [];
        const listeners: Record<string, Array<(data: any) => void>> = {};
        const files: Record<string, string[]> = {};
        for (const [path, data] of Object.entries(options.files || {})) files[path] = [data as string];
        let nextId = 1;

        const handle = async (plugin: string, method: string, o: any) => {
            const key = `${plugin}.${method}`;
            switch (key) {
                case 'Filesystem.writeFile':
                    if (options.failWrite) throw new Error('No space left on device');
                    if ((options.foreignFiles || []).includes(o.path)) throw new Error(`${o.path}: open failed: EACCES`);
                    files[o.path] = [o.data];
                    return {uri: DOCUMENTS + o.path};
                case 'Filesystem.appendFile':
                    (files[o.path] ||= []).push(o.data);
                    return {};
                case 'Filesystem.deleteFile':
                    if ((options.foreignFiles || []).includes(o.path)) throw new Error('An unknown error occurred');
                    if (!files[o.path]) throw new Error('File does not exist');
                    delete files[o.path];
                    return {};
                case 'Filesystem.stat':
                    if (!files[o.path]) throw new Error('File does not exist');
                    return {type: 'file', size: files[o.path].join('').length, uri: DOCUMENTS + o.path};
                case 'Filesystem.getUri':
                    return {uri: DOCUMENTS + o.path};
                case 'Filesystem.readFile':
                    if (!files[o.path]) throw new Error('File does not exist');
                    return {data: files[o.path].join('')};
                case 'App.getLaunchUrl':
                    return options.launchUrl ? {url: options.launchUrl} : {};
                case 'BarcodeScanner.isSupported':
                    return {supported: false};
                default:
                    return {};
            }
        };

        (window as any).androidBridge = {postMessage() {}};
        (window as any).Capacitor = {
            PluginHeaders: Object.entries(methods).map(([name, ms]) => ({
                name,
                methods: (ms as string[]).map((m) => ({name: m, rtype: m === 'addListener' ? 'callback' : 'promise'})),
            })),
            nativePromise(plugin: string, method: string, o: any) {
                calls.push({plugin, method, options: o});
                return handle(plugin, method, o || {});
            },
            nativeCallback(plugin: string, method: string, o: any, callback: (data: any) => void) {
                calls.push({plugin, method, options: o});
                (listeners[`${plugin}:${o?.eventName}`] ||= []).push(callback);
                return String(nextId++);
            },
        };
        (window as any).__fakeAndroid = {
            calls,
            files,
            fire(plugin: string, eventName: string, data: any) {
                for (const cb of listeners[`${plugin}:${eventName}`] || []) cb(data);
                return (listeners[`${plugin}:${eventName}`] || []).length;
            },
        };
    }, {methods: METHODS, options});
}

/** All native calls so far, optionally only one plugin's. */
export async function nativeCalls(page: Page, plugin?: string): Promise<NativeCall[]> {
    const calls: NativeCall[] = await page.evaluate(() => (window as any).__fakeAndroid.calls);
    return plugin ? calls.filter((c) => c.plugin === plugin) : calls;
}

/** Fire an Android event (e.g. App 'backButton'). Returns how many listeners received it. */
export async function fireNative(page: Page, plugin: string, eventName: string, data: any = {}): Promise<number> {
    return page.evaluate(([p, e, d]) => (window as any).__fakeAndroid.fire(p, e, d), [plugin, eventName, data] as const);
}

/** Press the Android Back button. */
export const pressBack = (page: Page) => fireNative(page, 'App', 'backButton', {canGoBack: false});

/** Is any <dialog> open anywhere in the page (including inside components)? */
export async function openDialogs(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const out: string[] = [];
        const walk = (root: Document | ShadowRoot) => root.querySelectorAll('*').forEach((el) => {
            if (el.tagName === 'DIALOG' && (el as HTMLDialogElement).open) {
                const host = (el.getRootNode() as ShadowRoot).host as HTMLElement | undefined;
                out.push(host?.getAttribute('data-testid') || 'dialog');
            }
            if ((el as HTMLElement).shadowRoot) walk((el as HTMLElement).shadowRoot!);
        });
        walk(document);
        return out;
    });
}
