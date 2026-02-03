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
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
            manifest: {
                name: 'Open Waqf Signer',
                short_name: 'Signer',
                description: 'Secure, Offline, Free PDF Signer.',
                theme_color: '#ffffff',
                background_color: '#ffffff',
                display: 'standalone',
                orientation: 'portrait',
                icons: [
                    {
                        src: 'icons/icon-192.webp',
                        sizes: '192x192',
                        type: 'image/webp'
                    },
                    {
                        src: 'icons/icon-512.webp',
                        sizes: '512x512',
                        type: 'image/webp'
                    }
                ]
            }
        })
    ],
});