import {expect, test} from '@playwright/test';
import {handleTsaRelayRequest} from '../workers/tsa-relay/src/index';

test('tsa relay health endpoint returns ok', async () => {
    const request = new Request('https://tsa.open-waqf.org/api/tsa/health', {method: 'GET'});
    const response = await handleTsaRelayRequest(request, {});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ok: true, service: 'tsa-relay'});
});

test('tsa relay forwards query bytes and returns timestamp reply', async () => {
    const upstreamReply = new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x00]);
    const originalFetch = globalThis.fetch;
    let calledUrl = '';
    let calledMethod = '';
    let calledBodyLength = 0;
    try {
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            calledUrl = String(url);
            calledMethod = String(init?.method || '');
            calledBodyLength = new Uint8Array(init?.body as ArrayBufferLike).length;
            return new Response(upstreamReply, {status: 200, headers: {'content-type': 'application/timestamp-reply'}});
        }) as typeof fetch;

        const reqBytes = new Uint8Array([0x01, 0x02, 0x03]);
        const request = new Request('https://sign.open-waqf.org/api/tsa', {
            method: 'POST',
            headers: {'content-type': 'application/timestamp-query'},
            body: reqBytes,
        });
        const response = await handleTsaRelayRequest(request, {});
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/timestamp-reply');
        expect(calledUrl).toContain('freetsa.org/tsr');
        expect(calledMethod).toBe('POST');
        expect(calledBodyLength).toBe(3);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('tsa relay rejects unsupported content type', async () => {
    const request = new Request('https://sign.open-waqf.org/api/tsa', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({bad: true}),
    });
    const response = await handleTsaRelayRequest(request, {});
    expect(response.status).toBe(415);
});

test('tsa relay maps upstream timeout to 504', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = (async () => {
            const err = new Error('aborted');
            (err as any).name = 'AbortError';
            throw err;
        }) as typeof fetch;
        const request = new Request('https://sign.open-waqf.org/api/tsa', {
            method: 'POST',
            headers: {'content-type': 'application/timestamp-query'},
            body: new Uint8Array([0x01]),
        });
        const response = await handleTsaRelayRequest(request, {});
        expect(response.status).toBe(504);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
