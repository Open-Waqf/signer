/// <reference lib="webworker" />

import {cleanupOutdatedCaches, precacheAndRoute} from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

const SHARE_CACHE_NAME = 'owq-share-target';
const SHARE_CACHE_KEY = '/__owq_shared_pdf__';
const SHARE_DEFAULT_NAME = 'Shared_Document.pdf';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function storeSharedFile(file: File) {
    const cache = await caches.open(SHARE_CACHE_NAME);
    await cache.put(
        SHARE_CACHE_KEY,
        new Response(await file.arrayBuffer(), {
            headers: {
                'content-type': file.type || 'application/pdf',
                'x-owq-file-name': encodeURIComponent(file.name || SHARE_DEFAULT_NAME)
            }
        })
    );
}

async function readSharedFileFromCache(): Promise<File | null> {
    const cache = await caches.open(SHARE_CACHE_NAME);
    const response = await cache.match(SHARE_CACHE_KEY);
    if (!response) return null;

    const fileNameHeader = response.headers.get('x-owq-file-name');
    const fileName = fileNameHeader ? decodeURIComponent(fileNameHeader) : SHARE_DEFAULT_NAME;
    const fileType = response.headers.get('content-type') || 'application/pdf';
    const bytes = await response.arrayBuffer();
    return new File([bytes], fileName, {type: fileType});
}

async function broadcastSharedFile(file: File, sourceClientId?: string) {
    for (let attempt = 0; attempt < 10; attempt++) {
        const clients = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
        const targets = sourceClientId
            ? clients.filter((client) => client.id === sourceClientId)
            : clients;

        if (targets.length > 0) {
            for (const client of targets) {
                client.postMessage({type: 'SHARED_FILE', file});
            }
            return;
        }

        await delay(250);
    }
}

self.addEventListener('fetch', (event: FetchEvent) => {
    const {request} = event;
    if (request.method !== 'POST') return;

    const url = new URL(request.url);
    if (url.pathname !== '/' || !url.searchParams.has('share-target')) return;

    event.respondWith((async () => {
        const formData = await request.formData();
        const sharedFile = formData.get('file');
        if (!(sharedFile instanceof File)) {
            return Response.redirect('/', 303);
        }

        await storeSharedFile(sharedFile);
        event.waitUntil(broadcastSharedFile(sharedFile));
        return Response.redirect('/', 303);
    })());
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
    if (event.data?.type !== 'OWQ_SHARE_TARGET_CLIENT_READY') return;

    event.waitUntil((async () => {
        const sourceClientId = event.source && 'id' in event.source ? event.source.id : undefined;
        const sharedFile = await readSharedFileFromCache();
        if (!sharedFile) return;

        await broadcastSharedFile(sharedFile, sourceClientId);
    })());
});
