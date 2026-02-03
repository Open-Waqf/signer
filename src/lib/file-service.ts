import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {Share} from '@capacitor/share';

// 1. The Interface: What our app needs to do, regardless of platform
export interface IFileService {
    savePdf(fileName: string, data: Uint8Array): Promise<void>;

    openPdf(): Promise<Uint8Array>;
}

// 2. The Browser Implementation (Desktop/Mobile Web)
class WebFileService implements IFileService {
    async savePdf(fileName: string, data: Uint8Array): Promise<void> {
        // In browser, "saving" means triggering a download
        const blob = new Blob([data as any], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();

        // Cleanup
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async openPdf(): Promise<Uint8Array> {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/pdf';

            input.onchange = async (e: any) => {
                const file = e.target.files[0];
                if (!file) {
                    reject('No file selected');
                    return;
                }
                const arrayBuffer = await file.arrayBuffer();
                resolve(new Uint8Array(arrayBuffer));
            };

            input.click();
        });
    }
}

// 3. The Native Implementation (Android APK)
class NativeFileService implements IFileService {
    async savePdf(fileName: string, data: Uint8Array): Promise<void> {
        // 1. Write the file to the Documents cache/folder
        // We convert Uint8Array to Base64 because Capacitor Filesystem wants strings
        const base64Data = this.uint8ToBase64(data);

        const result = await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Documents,
            recursive: true
        });

        // 2. Share it immediately so the user can send it to WhatsApp/Email
        await Share.share({
            title: 'Signed Document',
            text: 'Here is your signed PDF from Open Waqf.',
            url: result.uri,
            dialogTitle: 'Send Signed PDF'
        });
    }

    async openPdf(): Promise<Uint8Array> {
        // For Native, we might use a file picker plugin later.
        // BUT for the MVP, the "Web" method actually works in WebViews too!
        // So we can fallback to the Web implementation for "Open"
        // unless we install a specific Native File Picker plugin.
        const webFallback = new WebFileService();
        return webFallback.openPdf();
    }

    private uint8ToBase64(bytes: Uint8Array): string {
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
}

// 4. The Factory: Choose the right one automatically
export const fileService: IFileService = Capacitor.isNativePlatform()
    ? new NativeFileService()
    : new WebFileService();