import {defineConfig} from 'vite';

export default defineConfig({
    // Base must be './' for Capacitor to find files on Android
    base: './',
    build: {
        outDir: 'dist',
        emptyOutDir: true, // Cleans the folder before building
    },
    server: {
        port: 3000,
    }
});