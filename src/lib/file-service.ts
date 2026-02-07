import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {Share} from '@capacitor/share';
import {i18n} from './i18n-service'; // 👈 Restored Import

export interface SavedFile {
    uri: string;
    filename: string;
}

export class FileService {

    /**
     * 🟢 RESTORED: Open File Picker
     * Necessary to load documents!
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
    }

    /**
     * SAVES FILE EFFICIENTLY (No Memory Bomb)
     */
    async savePdf(filename: string, data: Uint8Array): Promise<SavedFile> {
        if (Capacitor.isNativePlatform()) {
            return this.saveFileNative(filename, data);
        } else {
            return this.saveFileBrowser(filename, data);
        }
    }

    /**
     * NATIVE STRATEGY: Chunked Writing
     * Prevents OOM crashes by streaming 1MB chunks.
     */
    private async saveFileNative(filename: string, data: Uint8Array): Promise<SavedFile> {
        try {
            // 1. Delete file if exists
            try {
                await Filesystem.deleteFile({
                    path: filename,
                    directory: Directory.Documents
                });
            } catch (e) { /* Ignore */
            }

            // 2. Write in Chunks
            const CHUNK_SIZE = 1024 * 1024; // 1MB
            const totalChunks = Math.ceil(data.length / CHUNK_SIZE);

            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, data.length);
                const chunk = data.slice(start, end);

                // Use fast Blob conversion
                const base64Chunk = await this.blobToBase64(new Blob([chunk]));

                if (i === 0) {
                    await Filesystem.writeFile({
                        path: filename,
                        data: base64Chunk,
                        directory: Directory.Documents,
                        // No encoding = Binary Write
                    });
                } else {
                    await Filesystem.appendFile({
                        path: filename,
                        data: base64Chunk,
                        directory: Directory.Documents
                    });
                }
            }

            const uriResult = await Filesystem.getUri({
                path: filename,
                directory: Directory.Documents
            });

            return {uri: uriResult.uri, filename};

        } catch (e) {
            console.error("Native Save Error", e);
            throw new Error("Could not save file to device.");
        }
    }

    /**
     * BROWSER STRATEGY: Blob Download
     */
    private async saveFileBrowser(filename: string, data: Uint8Array): Promise<SavedFile> {
        const blob = new Blob([data as any], {type: 'application/pdf'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        return {uri: url, filename};
    }

    /**
     * 🟢 RESTORED: Intelligent Share (Web + Native)
     * Handles Web Share API (Mobile Web) and Native Share (App).
     */
    async sharePdf(file: { filename: string; uri?: string }, dataIfWeb?: Uint8Array) {
        // 1. NATIVE APP STRATEGY
        if (Capacitor.isNativePlatform()) {
            if (!file.uri) throw new Error('No file uri to share');

            await Share.share({
                title: i18n.t('shareTitle'), // 👈 Restored Translation
                text: i18n.t('shareText'),
                url: file.uri,
                dialogTitle: i18n.t('shareDialog'),
            });
            return;
        }

        // 2. WEB APP STRATEGY
        if (!dataIfWeb) throw new Error('sharePdf on web requires bytes');

        const blob = new Blob([dataIfWeb as any], {type: 'application/pdf'});
        const f = new File([blob], file.filename, {type: 'application/pdf'});
        const navAny = navigator as any;

        // Try modern Web Share API (e.g. Chrome on Android)
        if (navAny.share && navAny.canShare && navAny.canShare({files: [f]})) {
            await navAny.share({
                title: i18n.t('shareTitle'),
                text: i18n.t('shareText'),
                files: [f],
            });
            return;
        }

        // Fallback: Just ensure it was downloaded (which savePdf does)
        this.saveFileBrowser(file.filename, dataIfWeb);
        console.log("Web Share API not supported, file downloaded instead.");
    }

    /**
     * Helper: Fast Async Base64 Converter
     */
    private blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => {
                const result = reader.result as string;
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.readAsDataURL(blob);
        });
    }
}

export const fileService = new FileService();