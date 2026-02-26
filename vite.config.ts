import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig({
    base: './',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    plugins: [
        VitePWA({
            injectRegister: null,
            registerType: 'prompt',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
            workbox: {
                cleanupOutdatedCaches: true,
                skipWaiting: false,
                clientsClaim: false,
                globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,json,woff2,wasm,bcmap,pfb,ttf,mjs}'],
                maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
                navigateFallbackDenylist: [/^\/sitemap\.xml$/, /^\/robots\.txt$/],
            },
            manifest: {
                name: 'Open Waqf Signer',
                short_name: 'Signer',
                start_url: "/",
                description: 'Secure, Offline, Free PDF Signer.',
                theme_color: '#ffffff',
                background_color: '#ffffff',
                display: 'standalone',
                orientation: 'portrait',
                icons: [
                    {
                        src: 'icons/icon-192.webp',
                        sizes: '192x192',
                        type: 'image/webp',
                        purpose: 'any maskable'
                    },
                    {
                        src: 'icons/icon-512.webp',
                        sizes: '512x512',
                        type: 'image/webp',
                        purpose: 'any maskable'
                    }
                ]
            }
        })
    ],
});