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
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
            manifest: {
                name: 'Open Waqf Signer',
                short_name: 'Signer',
                description: 'Offline PDF Signer & Editor',
                theme_color: '#ffffff',
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
    server: {
        port: 3000,
    }
});