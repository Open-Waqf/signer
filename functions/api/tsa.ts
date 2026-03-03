const DEFAULT_UPSTREAM_URL = 'https://freetsa.org/tsr';
const DEFAULT_TIMEOUT_MS = 3000;
const MAX_QUERY_BYTES = 64 * 1024;

function corsHeaders(origin?: string): HeadersInit {
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, accept',
        Vary: 'Origin',
    };
}

function getOrigin(request: Request): string | undefined {
    return request.headers.get('origin') || undefined;
}

export async function onRequestOptions(context: { request: Request }) {
    return new Response(null, {
        status: 204,
        headers: corsHeaders(getOrigin(context.request)),
    });
}

export async function onRequestPost(context: {
    request: Request;
    env?: { TSA_UPSTREAM_URL?: string };
}) {
    const origin = getOrigin(context.request);
    const contentType = context.request.headers.get('content-type')?.toLowerCase() || '';
    if (!contentType.includes('application/timestamp-query') && !contentType.includes('application/octet-stream')) {
        return new Response('Unsupported content type', {
            status: 415,
            headers: {
                ...corsHeaders(origin),
                'content-type': 'text/plain; charset=utf-8',
            },
        });
    }

    const requestBytes = new Uint8Array(await context.request.arrayBuffer());
    if (requestBytes.length === 0 || requestBytes.length > MAX_QUERY_BYTES) {
        return new Response('Invalid query payload size', {
            status: 400,
            headers: {
                ...corsHeaders(origin),
                'content-type': 'text/plain; charset=utf-8',
            },
        });
    }

    const upstreamUrl = context.env?.TSA_UPSTREAM_URL || DEFAULT_UPSTREAM_URL;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
        const upstream = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/timestamp-query',
                accept: 'application/timestamp-reply',
            },
            body: requestBytes,
            signal: controller.signal,
        });

        if (!upstream.ok) {
            return new Response('TSA upstream unavailable', {
                status: 502,
                headers: {
                    ...corsHeaders(origin),
                    'content-type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                },
            });
        }

        const reply = await upstream.arrayBuffer();
        return new Response(reply, {
            status: 200,
            headers: {
                ...corsHeaders(origin),
                'content-type': 'application/timestamp-reply',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error: any) {
        const timeout = String(error?.name || '').toLowerCase().includes('abort');
        return new Response(timeout ? 'TSA request timed out' : 'TSA request failed', {
            status: timeout ? 504 : 502,
            headers: {
                ...corsHeaders(origin),
                'content-type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-store',
            },
        });
    } finally {
        clearTimeout(timer);
    }
}
