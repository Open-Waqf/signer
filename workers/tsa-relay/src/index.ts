export interface RelayEnv {
    TSA_UPSTREAM_URL?: string;
    ALLOWED_ORIGIN?: string;
}

const DEFAULT_UPSTREAM_URL = 'https://freetsa.org/tsr';
const DEFAULT_TIMEOUT_MS = 3000;
const MAX_QUERY_BYTES = 64 * 1024;
const DEFAULT_ALLOWED_ORIGIN = 'https://sign.open-waqf.org';

function corsHeaders(allowedOrigin: string): HeadersInit {
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, accept',
        Vary: 'Origin',
    };
}

export async function handleTsaRelayRequest(
    request: Request,
    env: RelayEnv = {},
    fetchImpl: typeof fetch = fetch,
): Promise<Response> {
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
    const cors = corsHeaders(allowedOrigin);
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname.endsWith('/health')) {
        return new Response(JSON.stringify({ok: true, service: 'tsa-relay'}), {
            status: 200,
            headers: {
                ...cors,
                'content-type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
            },
        });
    }

    if (request.method === 'OPTIONS') {
        return new Response(null, {status: 204, headers: cors});
    }
    if (request.method !== 'POST') {
        return new Response('Method not allowed', {status: 405, headers: cors});
    }
    const contentType = request.headers.get('content-type')?.toLowerCase() || '';
    if (!contentType.includes('application/timestamp-query') && !contentType.includes('application/octet-stream')) {
        return new Response('Unsupported content type', {status: 415, headers: cors});
    }

    const queryBytes = new Uint8Array(await request.arrayBuffer());
    if (queryBytes.length === 0 || queryBytes.length > MAX_QUERY_BYTES) {
        return new Response('Invalid query payload size', {status: 400, headers: cors});
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const upstreamUrl = env.TSA_UPSTREAM_URL || DEFAULT_UPSTREAM_URL;

    try {
        const upstream = await fetchImpl(upstreamUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/timestamp-query',
                accept: 'application/timestamp-reply',
            },
            body: queryBytes,
            signal: controller.signal,
        });
        if (!upstream.ok) {
            return new Response('TSA upstream unavailable', {status: 502, headers: cors});
        }
        const body = await upstream.arrayBuffer();
        return new Response(body, {
            status: 200,
            headers: {
                ...cors,
                'content-type': 'application/timestamp-reply',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error: any) {
        const timeout = String(error?.name || '').toLowerCase().includes('abort');
        return new Response(timeout ? 'TSA request timed out' : 'TSA request failed', {
            status: timeout ? 504 : 502,
            headers: cors,
        });
    } finally {
        clearTimeout(timer);
    }
}

export default {
    async fetch(request: Request, env: RelayEnv): Promise<Response> {
        return handleTsaRelayRequest(request, env);
    },
};
