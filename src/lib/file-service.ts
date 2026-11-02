import {Directory, Filesystem} from '@capacitor/filesystem';
import {Share} from '@capacitor/share';
import {i18n} from './i18n-service'; // 👈 Restored Import
import {isNativePlatform} from './runtime-platform';

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
        if (isNativePlatform()) {
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
        // Never delete or overwrite a file in Documents. If the name is taken, or Android
        // refuses it (on Android 11+ a file left by an earlier install is invisible but cannot
        // be replaced), save as "name (2).pdf", "name (3).pdf", ... (bug S1). The old code
        // deleted first, which failed in that case and could lose the old file on a bad write.
        const base = filename.replace(/\.pdf$/i, '');
        let lastError: unknown = null;
        for (let n = 1; n <= 20; n++) {
            const name = n === 1 ? filename : `${base} (${n}).pdf`;
            if (await this.nativeFileExists(name)) continue;
            try {
                await this.writeNativeFile(name, data);
            } catch (e) {
                lastError = e;
                if ((e as {partial?: boolean})?.partial) break; // storage problem, not the name
                continue;
            }
            const uriResult = await Filesystem.getUri({path: name, directory: Directory.Documents});
            return {uri: uriResult.uri, filename: name};
        }
        console.error('Native Save Error', lastError);
        throw new Error('Could not save file to device.');
    }

    private async nativeFileExists(path: string): Promise<boolean> {
        try {
            await Filesystem.stat({path, directory: Directory.Documents});
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Write in 1 MB chunks (prevents out-of-memory on big files). If a later chunk fails,
     * the half-written file is removed and the error is marked `partial`.
     */
    private async writeNativeFile(path: string, data: Uint8Array) {
        const CHUNK_SIZE = 1024 * 1024;
        const totalChunks = Math.max(1, Math.ceil(data.length / CHUNK_SIZE));
        for (let i = 0; i < totalChunks; i++) {
            const chunk = data.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, data.length));
            const base64Chunk = await this.blobToBase64(new Blob([chunk]));
            if (i === 0) {
                // No encoding = binary write.
                await Filesystem.writeFile({path, data: base64Chunk, directory: Directory.Documents});
                continue;
            }
            try {
                await Filesystem.appendFile({path, data: base64Chunk, directory: Directory.Documents});
            } catch (e) {
                try {
                    await Filesystem.deleteFile({path, directory: Directory.Documents}); // our own partial file
                } catch { /* ignore */ }
                throw Object.assign(new Error(String((e as Error)?.message ?? e)), {partial: true});
            }
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
        }, 500);
        return {uri: url, filename};
    }

    /**
     * True when Share can hand a PDF to another app: always in the native app,
     * and in browsers that support sharing files (e.g. Chrome on Android).
     * On desktop browsers without it, Share would only download the file again.
     */
    canShareFiles(): boolean {
        if (isNativePlatform()) return true;
        const navAny = navigator as any;
        if (typeof navAny.share !== 'function' || typeof navAny.canShare !== 'function') return false;
        try {
            const probe = new File([new Uint8Array(0)], 'probe.pdf', {type: 'application/pdf'});
            return !!navAny.canShare({files: [probe]});
        } catch {
            return false;
        }
    }

    /**
     * 🟢 RESTORED: Intelligent Share (Web + Native)
     * Handles Web Share API (Mobile Web) and Native Share (App).
     */
    async sharePdf(file: { filename: string; uri?: string }, dataIfWeb?: Uint8Array) {
        // 1. NATIVE APP STRATEGY
        if (isNativePlatform()) {
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
            try {
                await navAny.share({
                    title: i18n.t('shareTitle'),
                    text: i18n.t('shareText'),
                    files: [f],
                });
                return;
            } catch (error) {
                console.warn('Web Share failed, falling back to download.', error);
                await this.saveFileBrowser(file.filename, dataIfWeb);
                return;
            }
        }

        // Fallback: Just ensure it was downloaded (which savePdf does)
        await this.saveFileBrowser(file.filename, dataIfWeb);
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
