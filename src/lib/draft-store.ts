// draft-store.ts: keeps one unfinished document on this device, so work is not lost when
// Android closes the app in the background or a browser tab is reloaded (step 3).
// It is stored in the app's own storage (IndexedDB) and never leaves the device.
// The PDF is written once per document; the edits are written often (they are small).
// The certificate file and its password are never part of a draft.
import type {Annotation} from '../types';

export type DraftPdf = {name: string; bytes: Uint8Array};

export type DraftState = {
    version: 1;
    name: string;
    savedAt: string;
    annotations: Annotation[];
    includeAudit: boolean;
    includeFooter: boolean;
    validationMsg: string | null;
    isVerified: boolean;
    previousHashManuallyVerified: boolean;
    /** The handover question was still open (not answered or skipped). */
    handoverOpen: boolean;
};

export type Draft = {pdf: DraftPdf; state: DraftState};

const DB_NAME = 'owq-signer-draft';
const STORE = 'draft';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | void): Promise<T | null> {
    const db = await openDb();
    try {
        return await new Promise<T | null>((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const req = work(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(req ? ((req.result as T) ?? null) : null);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

export const writeDraftPdf = (pdf: DraftPdf) => run<void>('readwrite', (s) => {
    s.put(pdf, 'pdf');
    s.delete('state'); // edits of an older document must never be paired with this PDF
});

export const writeDraftState = (state: DraftState) => run<void>('readwrite', (s) => s.put(state, 'state'));

export const clearDraft = () => run<void>('readwrite', (s) => s.clear());

/** Name and item count of the stored draft, for the home screen. Null when there is none. */
export async function readDraftInfo(): Promise<{name: string; count: number} | null> {
    try {
        const state = await run<DraftState>('readonly', (s) => s.get('state'));
        if (!state || state.version !== 1) return null;
        return {name: state.name, count: state.annotations.length};
    } catch {
        return null; // storage blocked (private mode): no drafts, nothing else breaks
    }
}

export async function readDraft(): Promise<Draft | null> {
    const [pdf, state] = await Promise.all([
        run<DraftPdf>('readonly', (s) => s.get('pdf')),
        run<DraftState>('readonly', (s) => s.get('state')),
    ]);
    if (!pdf || !state || state.version !== 1 || pdf.name !== state.name) return null;
    return {pdf, state};
}
