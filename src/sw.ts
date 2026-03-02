/// <reference lib="webworker" />

import {cleanupOutdatedCaches, precacheAndRoute} from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

const SHARE_CACHE_NAME = 'owq-share-target';
const SHARE_CACHE_KEY = '/__owq_shared_pdf__';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('fetch', (event: FetchEvent) => {
    const {request} = event;
    if (request.method !== 'POST') return;

    const url = new URL(request.url);
    if (url.pathname !== '/' || !url.searchParams.has('share-target')) return;

    event.respondWith((async () => {
        const formData = await request.formData();
        const sharedFile = formData.get('file');
        if (!(sharedFile instanceof File)) {
            return Response.redirect('/?share-target=1', 303);
        }

        const cache = await caches.open(SHARE_CACHE_NAME);
        await cache.put(
            SHARE_CACHE_KEY,
            new Response(await sharedFile.arrayBuffer(), {
                headers: {
                    'content-type': sharedFile.type || 'application/pdf',
                    'x-owq-file-name': encodeURIComponent(sharedFile.name || 'Shared_Document.pdf')
                }
            })
        );

        const clients = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
        for (const client of clients) {
            client.postMessage({type: 'OWQ_SHARED_PDF_READY'});
        }

        return Response.redirect('/?shared-pdf=1', 303);
    })());
});
