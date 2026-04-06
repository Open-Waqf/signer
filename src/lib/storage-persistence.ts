/**
 * Storage persistence reduces the chance that browser-managed origin data is
 * evicted under storage pressure. In Signer this primarily protects IndexedDB
 * signature presets and the service-worker share-target cache.
 */

export type StoragePersistenceStatus =
    | 'unsupported'
    | 'already-persisted'
    | 'granted'
    | 'denied'
    | 'error';

export type StoragePersistenceResult = {
    status: StoragePersistenceStatus;
    persisted: boolean;
};

const REQUESTED_KEY = 'signer_storage_persistence_requested';
const DENIED_KEY = 'signer_storage_persistence_denied';

function canUseStoragePersistenceApi(): boolean {
    return typeof navigator !== 'undefined'
        && !!navigator.storage
        && typeof navigator.storage.persist === 'function'
        && typeof navigator.storage.persisted === 'function';
}

function canUseLocalStorage(): boolean {
    return typeof localStorage !== 'undefined';
}

function getFlag(key: string): boolean {
    if (!canUseLocalStorage()) return false;
    return localStorage.getItem(key) === '1';
}

function setFlag(key: string, enabled: boolean) {
    if (!canUseLocalStorage()) return;
    if (enabled) {
        localStorage.setItem(key, '1');
        return;
    }
    localStorage.removeItem(key);
}

export async function requestStoragePersistence(): Promise<StoragePersistenceResult> {
    if (!canUseStoragePersistenceApi()) {
        return {status: 'unsupported', persisted: false};
    }

    try {
        const isPersisted = await navigator.storage.persisted();
        if (isPersisted) {
            setFlag(DENIED_KEY, false);
            return {status: 'already-persisted', persisted: true};
        }

        if (getFlag(REQUESTED_KEY) && getFlag(DENIED_KEY)) {
            return {status: 'denied', persisted: false};
        }

        const granted = await navigator.storage.persist();
        setFlag(REQUESTED_KEY, true);
        setFlag(DENIED_KEY, !granted);

        if (granted) {
            console.info('[OWQ] Persistent storage granted.');
            return {status: 'granted', persisted: true};
        }

        console.warn('[OWQ] Persistent storage not granted; IndexedDB and cache data may remain best-effort.');
        return {status: 'denied', persisted: false};
    } catch (error) {
        console.warn('[OWQ] Persistent storage request failed:', error);
        return {status: 'error', persisted: false};
    }
}
