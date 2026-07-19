type PresetRecord = {
    id: string;
    name: string;
    dataURL: string;
};

const DB_NAME = 'owq-signer';
const DB_VERSION = 1;
const STORE = 'signature-presets';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function readKey<T>(key: string): Promise<T | null> {
    try {
        const db = await openDb();
        return await new Promise<T | null>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(key);
            req.onsuccess = () => resolve((req.result as T) ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

async function writeKey<T>(key: string, value: T): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadPresets(mode: string): Promise<PresetRecord[]> {
    const data = await readKey<PresetRecord[]>(`presets:${mode}`);
    return Array.isArray(data) ? data : [];
}

export async function persistPresets(mode: string, presets: PresetRecord[]): Promise<void> {
    await writeKey(`presets:${mode}`, presets);
}

export async function loadLastUsed(mode: string): Promise<string | null> {
    const value = await readKey<string>(`last:${mode}`);
    return typeof value === 'string' ? value : null;
}

// Best-effort convenience cache: a failure here must never reject (callers use
// `void persistLastUsed(...)`), because the actual signature is dispatched
// regardless of whether the last-used thumbnail could be cached.
export async function persistLastUsed(mode: string, dataURL: string): Promise<void> {
    try {
        await writeKey(`last:${mode}`, dataURL);
    } catch {
        // Storage full/unavailable — the last-used cache is non-essential.
    }
}

export async function clearLastUsed(mode: string): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(`last:${mode}`);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // Non-essential cache clear — ignore failures.
    }
}
