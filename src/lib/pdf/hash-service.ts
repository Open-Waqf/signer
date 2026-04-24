let HashWorkerConstructor: any;
let worker: Worker | null = null;
const pendingRequests = new Map<string, { resolve: (val: string) => void; reject: (err: any) => void }>();

async function getWorker(): Promise<Worker | null> {
    if (typeof Worker === 'undefined') return null;
    
    if (!worker) {
        try {
            if (!HashWorkerConstructor) {
                // @ts-ignore - Vite specific import
                const m = await import('./hash.worker?worker');
                HashWorkerConstructor = m.default;
            }
            if (typeof HashWorkerConstructor !== 'function') return null;
            
            worker = new HashWorkerConstructor();
            worker!.onmessage = (event: MessageEvent) => {
                const {id, hash, error} = event.data;
                const pending = pendingRequests.get(id);
                if (!pending) return;
                pendingRequests.delete(id);
                if (error) pending.reject(new Error(error));
                else pending.resolve(hash);
            };
        } catch (e) {
            console.error('[OWQ][WorkerLoadError]', e);
            return null;
        }
    }
    return worker;
}

async function runInWorker(type: 'CALCULATE_SHA256' | 'CALCULATE_DETERMINISTIC_HASH', data: Uint8Array): Promise<string> {
    const w = await getWorker();
    
    if (!w) {
        if (type === 'CALCULATE_SHA256') {
            const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
            return Array.from(new Uint8Array(hashBuffer))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        }
        const {PDFDocument} = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(data, {updateMetadata: false});
        pdfDoc.setSubject('');
        pdfDoc.setCreationDate(new Date(0));
        pdfDoc.setModificationDate(new Date(0));
        const normalized = await pdfDoc.save();
        const hashBuffer = await crypto.subtle.digest('SHA-256', normalized as any);
        return Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        pendingRequests.set(id, {resolve, reject});
        w.postMessage({id, type, data});
    });
}

export async function generateHashID(text: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').substring(0, 12).toUpperCase();
}

export async function calculateSHA256(data: Uint8Array): Promise<string> {
    if (data.length < 1024 * 512) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
        return Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }
    return runInWorker('CALCULATE_SHA256', data);
}

export function getSixDigitCode(hash: string): string {
    const normalized = hash.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    const seed = Number.parseInt(normalized.slice(0, 12) || '0', 16);
    return String(seed % 1000000).padStart(6, '0');
}

export async function calculateDeterministicHashIgnoringSubject(fileData: Uint8Array): Promise<string> {
    return runInWorker('CALCULATE_DETERMINISTIC_HASH', fileData);
}
