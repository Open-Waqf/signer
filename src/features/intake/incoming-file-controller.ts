import {App} from '@capacitor/app';
import {Capacitor} from '@capacitor/core';
import {Filesystem} from '@capacitor/filesystem';

export type SharedFileHandler = (data: Uint8Array, name: string) => Promise<void>;

type IncomingFileControllerOptions = {
    onSharedFile: SharedFileHandler;
    onError: () => void;
};

export class IncomingFileController {
    static readonly SHARE_CACHE_NAME = 'owq-share-target';
    static readonly SHARE_CACHE_KEY = '/__owq_shared_pdf__';
    static readonly SHARED_PDF_QUERY = 'shared-pdf';

    private readonly options: IncomingFileControllerOptions;

    constructor(options: IncomingFileControllerOptions) {
        this.options = options;
    }

    serviceWorkerMessageHandler = (event: MessageEvent) => {
        if (event.data?.type === 'SHARED_FILE' && event.data.file instanceof File) {
            void this.handleSharedBrowserFile(event.data.file);
            return;
        }

        if (event.data?.type === 'OWQ_SHARED_PDF_READY') {
            void this.consumeSharedPdfFromCache();
        }
    };

    async initializeServiceWorkerShareBridge() {
        if (!('serviceWorker' in navigator)) return;

        try {
            const registration = await navigator.serviceWorker.ready;
            const target = navigator.serviceWorker.controller ?? registration.active;
            target?.postMessage({type: 'OWQ_SHARE_TARGET_CLIENT_READY'});
        } catch (error) {
            console.error('Failed to initialize share target bridge:', error);
        }
    }

    async consumePendingSharedPdf() {
        await this.consumeSharedPdfFromCache();
    }

    async consumeSharedPdfFromLocation(locationSearch: string): Promise<string | null> {
        const params = new URLSearchParams(locationSearch);
        if (!params.has(IncomingFileController.SHARED_PDF_QUERY) && !params.has('share-target')) return null;

        await this.consumeSharedPdfFromCache();
        params.delete(IncomingFileController.SHARED_PDF_QUERY);
        params.delete('share-target');
        return params.toString();
    }

    setupIncomingNativeFileRouting() {
        if (!Capacitor.isNativePlatform()) return;

        App.addListener('appUrlOpen', ({url}) => {
            if (!url) return;
            void this.handleIncomingNativePdfUrl(url);
        });

        App.getLaunchUrl().then((launch) => {
            if (!launch?.url) return;
            void this.handleIncomingNativePdfUrl(launch.url);
        }).catch(console.error);
    }

    private isIncomingPdfUrl(url: string) {
        const lower = url.toLowerCase();
        return lower.startsWith('content://') || lower.startsWith('file://') || lower.endsWith('.pdf') || lower.includes('.pdf?');
    }

    private async handleIncomingNativePdfUrl(url: string) {
        if (!this.isIncomingPdfUrl(url)) return;

        try {
            const data = await this.readNativePdfBytes(url);
            const name = this.extractIncomingFileName(url);
            await this.options.onSharedFile(data, name);
        } catch (error) {
            console.error('Failed to open shared file URL:', error);
            this.options.onError();
        }
    }

    private async readNativePdfBytes(url: string): Promise<Uint8Array> {
        const decoded = decodeURIComponent(url);
        const stripped = decoded.startsWith('file://') ? decoded.replace('file://', '') : decoded;
        const candidates = Array.from(new Set([url, decoded, stripped]));
        let lastError: unknown = null;

        for (const path of candidates) {
            try {
                const {data} = await Filesystem.readFile({path});
                if (typeof data !== 'string') {
                    return new Uint8Array(await (data as Blob).arrayBuffer());
                }
                return this.base64ToUint8Array(data);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError ?? new Error('Unable to read shared file bytes');
    }

    private base64ToUint8Array(base64: string): Uint8Array {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    private extractIncomingFileName(url: string): string {
        const cleanUrl = url.split('?')[0];
        const lastSegment = cleanUrl.split('/').pop();
        if (!lastSegment) return 'Shared_Document.pdf';
        try {
            const decoded = decodeURIComponent(lastSegment);
            return decoded.toLowerCase().endsWith('.pdf') ? decoded : 'Shared_Document.pdf';
        } catch (_error) {
            return 'Shared_Document.pdf';
        }
    }

    private async consumeSharedPdfFromCache() {
        if (!('caches' in window)) return;

        try {
            const cache = await caches.open(IncomingFileController.SHARE_CACHE_NAME);
            const response = await cache.match(IncomingFileController.SHARE_CACHE_KEY);
            if (!response) return;

            await cache.delete(IncomingFileController.SHARE_CACHE_KEY);
            const fileNameHeader = response.headers.get('x-owq-file-name');
            const fileName = fileNameHeader ? decodeURIComponent(fileNameHeader) : 'Shared_Document.pdf';
            const data = new Uint8Array(await response.arrayBuffer());
            await this.options.onSharedFile(data, fileName);
        } catch (error) {
            console.error('Failed to load shared target PDF:', error);
            this.options.onError();
        }
    }

    private async handleSharedBrowserFile(file: File) {
        try {
            const data = new Uint8Array(await file.arrayBuffer());
            await this.options.onSharedFile(data, file.name || 'Shared_Document.pdf');
        } catch (error) {
            console.error('Failed to load shared browser file:', error);
            this.options.onError();
        }
    }
}
