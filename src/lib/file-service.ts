import {Capacitor} from '@capacitor/core';
import {i18n} from './i18n-service';

type SavedFile = { filename: string; uri?: string };

export const fileService = {
    /**
     * Opens a file picker and returns the file data + name.
     */
    async openPdf(): Promise<{ data: Uint8Array; name: string }> {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/pdf';

            input.onchange = async (e: any) => {
                const file = e.target.files?.[0];
                if (file) {
                    const buffer = await file.arrayBuffer();
                    resolve({data: new Uint8Array(buffer), name: file.name});
                } else {
                    reject('No file selected');
                }
            };

            input.click();
        });
    },

    /**
     * Save PDF (primary action).
     * - Web: download
     * - Native: write to app Documents (reliable on Android 11+), returns a uri
     */
    async savePdf(filename: string, data: Uint8Array): Promise<SavedFile> {
        if (!Capacitor.isNativePlatform()) {
            const blob = new Blob([data as any], {type: 'application/pdf'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return {filename};
        }

        // --- NATIVE STRATEGY ---
        // Note: Filesystem.writeFile expects base64 on native. This can be memory-heavy for large PDFs. :contentReference[oaicite:2]{index=2}
        const {Filesystem, Directory} = await import('@capacitor/filesystem');

        // Soft guardrail: base64 can crash WebView on large files
        const maxBytes = 25 * 1024 * 1024; // 25MB
        if (data.byteLength > maxBytes) {
            // You can replace with a toast in your UI
            console.warn('Large PDF on native: base64 conversion may fail.');
        }

        const base64 = this.uint8ToBase64Chunked(data);

        await Filesystem.writeFile({
            path: filename,
            data: base64,
            directory: Directory.Documents,
        });

        const uriResult = await Filesystem.getUri({
            directory: Directory.Documents,
            path: filename,
        });

        return {filename, uri: uriResult.uri};
    },

    async sharePdf(file: { filename: string; uri?: string }, dataIfWeb?: Uint8Array) {
        if (!Capacitor.isNativePlatform()) {
            if (!dataIfWeb) throw new Error('sharePdf on web requires bytes');

            const blob = new Blob([dataIfWeb as any], {type: 'application/pdf'});
            const f = new File([blob], file.filename, {type: 'application/pdf'});

            const navAny = navigator as any;

            // Try native web share
            if (navAny.share && navAny.canShare && navAny.canShare({files: [f]})) {
                await navAny.share({
                    title: i18n.t('shareTitle'),
                    text: i18n.t('shareText'),
                    files: [f],
                });
                return;
            }

            // Fallback: download
            await this.savePdf(file.filename, dataIfWeb);
            return;
        }

        // Native (Android/iOS) path unchanged
        if (!file.uri) throw new Error('No file uri to share');

        const {Share} = await import('@capacitor/share');
        await Share.share({
            title: i18n.t('shareTitle'),
            text: i18n.t('shareText'),
            url: file.uri,
            dialogTitle: i18n.t('shareDialog'),
        });
    },

    /**
     * Avoid FileReader DataURL (huge memory overhead).
     * Chunked base64 conversion from Uint8Array.
     */
    uint8ToBase64Chunked(bytes: Uint8Array): string {
        const chunkSize = 0x8000; // 32KB
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode(...chunk);
        }
        return btoa(binary);
    },
};