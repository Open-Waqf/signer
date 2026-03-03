type TimestampProof = {
    timestampIso: string;
    tsaVerified: boolean;
    tsaProvider?: string;
    tsaTokenBase64?: string;
    tsaFailureReason?: string;
};

type TimestampDeps = {
    isOnline?: () => Promise<boolean>;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
    tsaUrl?: string;
};

const ENV_TSA_URL = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_TSA_RELAY_URL;
const DEFAULT_TSA_URL = ENV_TSA_URL?.trim() || '/api/tsa';
const DEFAULT_TIMEOUT_MS = 3000;
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

function mapFailureReason(error: unknown): string {
    const err = error as { name?: string; message?: string } | undefined;
    const name = String(err?.name ?? '').toLowerCase();
    const message = String(err?.message ?? '').toLowerCase();
    if (name.includes('abort')) return 'timeout';
    if (name === 'typeerror' || message.includes('cors') || message.includes('failed to fetch')) {
        return 'cors_or_network_blocked';
    }
    return String(err?.name || err?.message || 'tsa_error');
}

async function isOnlineRuntime(): Promise<boolean> {
    try {
        const modName = '@capacitor/network';
        const capNetwork = await import(/* @vite-ignore */ modName);
        if (capNetwork?.Network?.getStatus) {
            const status = await capNetwork.Network.getStatus();
            return !!status.connected;
        }
    } catch {
        // Fallback to web API
    }
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') return navigator.onLine;
    return true;
}

function bytesToBinary(bytes: Uint8Array): string {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, i + chunk);
        out += String.fromCharCode(...slice);
    }
    return out;
}

function binaryToBytes(binary: string): Uint8Array {
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('Invalid SHA-256 hex');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
        out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    return out;
}

async function getForge() {
    const mod = await import('node-forge');
    return (mod as any).default ?? (mod as any);
}

async function buildTimestampRequest(hashHex: string): Promise<Uint8Array> {
    const forge = await getForge();
    const asn1 = forge.asn1;
    const hashBytes = bytesToBinary(hexToBytes(hashHex));

    const algorithmIdentifier = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_SHA256).getBytes()),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    ]);

    const messageImprint = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        algorithmIdentifier,
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, hashBytes),
    ]);

    const request = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(0x01)),
        messageImprint,
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BOOLEAN, false, String.fromCharCode(0xff)),
    ]);

    const der = asn1.toDer(request).getBytes();
    return binaryToBytes(der);
}

async function parseTimestampResponse(respBytes: Uint8Array): Promise<{ accepted: boolean; tokenBase64?: string }> {
    const forge = await getForge();
    const asn1 = forge.asn1;
    const der = asn1.fromDer(bytesToBinary(respBytes));

    if (!der?.value || !Array.isArray(der.value) || der.value.length < 1) {
        return {accepted: false};
    }
    const statusInfo = der.value[0];
    const statusNode = statusInfo?.value?.[0];
    if (!statusNode?.value || typeof statusNode.value !== 'string') {
        return {accepted: false};
    }
    const status = statusNode.value.charCodeAt(statusNode.value.length - 1);
    const accepted = status === 0 || status === 1;
    if (!accepted) return {accepted: false};

    const tokenNode = der.value[1];
    if (!tokenNode) return {accepted: false};
    const tokenDer = asn1.toDer(tokenNode).getBytes();
    const tokenBase64 = typeof btoa === 'function'
        ? btoa(tokenDer)
        : Buffer.from(tokenDer, 'binary').toString('base64');
    return {accepted: true, tokenBase64};
}

export async function getTimestampProof(hashHex: string, deps: TimestampDeps = {}): Promise<TimestampProof> {
    const now = deps.now ? deps.now() : new Date();
    const timestampIso = now.toISOString();
    const isOnline = deps.isOnline || isOnlineRuntime;
    const fetchImpl = deps.fetchImpl || fetch;
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const tsaUrl = deps.tsaUrl ?? DEFAULT_TSA_URL;

    try {
        const online = await isOnline();
        if (!online) {
            return {
                timestampIso,
                tsaVerified: false,
                tsaFailureReason: 'offline',
            };
        }

        const requestBody = await buildTimestampRequest(hashHex);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(tsaUrl, {
                method: 'POST',
                headers: {
                    'content-type': 'application/timestamp-query',
                    accept: 'application/timestamp-reply',
                },
                body: new Blob([new Uint8Array(requestBody)], {type: 'application/timestamp-query'}),
                signal: controller.signal,
            });
            if (!response.ok) {
                return {
                    timestampIso,
                    tsaVerified: false,
                    tsaFailureReason: `http_${response.status}`,
                };
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            const parsed = await parseTimestampResponse(bytes);
            if (!parsed.accepted || !parsed.tokenBase64) {
                return {
                    timestampIso,
                    tsaVerified: false,
                    tsaFailureReason: 'invalid_tsa_response',
                };
            }
            return {
                timestampIso,
                tsaVerified: true,
                tsaProvider: 'FreeTSA',
                tsaTokenBase64: parsed.tokenBase64,
            };
        } finally {
            clearTimeout(timer);
        }
    } catch (error: any) {
        return {
            timestampIso,
            tsaVerified: false,
            tsaFailureReason: mapFailureReason(error),
        };
    }
}
