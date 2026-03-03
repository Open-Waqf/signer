import {expect, test} from '@playwright/test';
import {getTimestampProof} from '../src/lib/tsa-service';

async function makeTsaResponseBytes(): Promise<Uint8Array> {
    const mod = await import('node-forge');
    const forge = (mod as any).default ?? (mod as any);
    const asn1 = forge.asn1;
    const statusInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(0x00)),
    ]);
    const token = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(0x01)),
    ]);
    const resp = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [statusInfo, token]);
    const der = asn1.toDer(resp).getBytes();
    const out = new Uint8Array(der.length);
    for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i);
    return out;
}

test('tsa-service returns verified proof when TSA responds', async () => {
    const bytes = await makeTsaResponseBytes();
    const proof = await getTimestampProof('a'.repeat(64), {
        isOnline: async () => true,
        fetchImpl: async () =>
            ({
                ok: true,
                status: 200,
                arrayBuffer: async () => bytes.buffer,
            } as any),
        now: () => new Date('2026-03-03T12:00:00.000Z'),
    });

    expect(proof.tsaVerified).toBeTruthy();
    expect(proof.tsaProvider).toBe('FreeTSA');
    expect(proof.tsaTokenBase64).toBeTruthy();
    expect(proof.timestampIso).toBe('2026-03-03T12:00:00.000Z');
});

test('tsa-service falls back offline without throwing', async () => {
    const proof = await getTimestampProof('b'.repeat(64), {
        isOnline: async () => false,
        fetchImpl: async () => {
            throw new Error('should not call fetch when offline');
        },
        now: () => new Date('2026-03-03T13:00:00.000Z'),
    });

    expect(proof.tsaVerified).toBeFalsy();
    expect(proof.tsaFailureReason).toBe('offline');
    expect(proof.timestampIso).toBe('2026-03-03T13:00:00.000Z');
});

test('tsa-service times out and falls back', async () => {
    const proof = await getTimestampProof('c'.repeat(64), {
        isOnline: async () => true,
        timeoutMs: 20,
        fetchImpl: async (_url: string, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
                const signal = init?.signal as AbortSignal | undefined;
                if (!signal) return;
                signal.addEventListener('abort', () => reject({name: 'AbortError'}));
            }) as any,
    });

    expect(proof.tsaVerified).toBeFalsy();
    expect(proof.tsaFailureReason).toBe('timeout');
});

test('tsa-service handles browser CORS/network rejection gracefully', async () => {
    const proof = await getTimestampProof('d'.repeat(64), {
        isOnline: async () => true,
        fetchImpl: async () => {
            throw new TypeError('Failed to fetch');
        },
    });

    expect(proof.tsaVerified).toBeFalsy();
    expect(proof.tsaFailureReason).toBe('cors_or_network_blocked');
});
