import {Capacitor} from '@capacitor/core';
import {i18n} from './i18n-service'; // Import Translation Service

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
                const file = e.target.files[0];
                if (file) {
                    const buffer = await file.arrayBuffer();
                    resolve({
                        data: new Uint8Array(buffer),
                        name: file.name
                    });
                } else {
                    reject('No file selected');
                }
            };

            input.click();
        });
    },

    /**
     * Saves the file.
     */
    async savePdf(filename: string, data: Uint8Array) {
        if (Capacitor.isNativePlatform()) {
            // --- NATIVE STRATEGY ---
            try {
                const base64 = await this.blobToBase64(new Blob([data as any]));

                const {Share} = await import('@capacitor/share');
                const {Filesystem, Directory} = await import('@capacitor/filesystem');

                await Filesystem.writeFile({
                    path: filename,
                    data: base64,
                    directory: Directory.Cache
                });

                const uriResult = await Filesystem.getUri({
                    directory: Directory.Cache,
                    path: filename
                });

                // FIX: Use Translations
                await Share.share({
                    title: i18n.t('shareTitle'),
                    text: i18n.t('shareText'),
                    url: uriResult.uri,
                    dialogTitle: i18n.t('shareDialog')
                });

            } catch (e) {
                console.error("Native Save Error", e);
                // FIX: Use Translations
                alert(i18n.t('shareError'));
            }

        } else {
            // --- WEB STRATEGY ---
            const blob = new Blob([data as any], {type: 'application/pdf'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    },

    blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const res = reader.result as string;
                resolve(res.split(',')[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
};