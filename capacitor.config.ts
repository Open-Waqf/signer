import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'org.openwaqf.signer',
    appName: 'Open Signer',
    webDir: 'dist',
    plugins: {
        // Dark icons on both system bars: the app has only a light design. With the phone in
        // dark mode the default made the bottom navigation buttons white, barely visible.
        SystemBars: {
            style: 'LIGHT',
        },
        StatusBar: {
            style: 'LIGHT',
            backgroundColor: '#ffffff',
            overlaysWebView: false
        }
    },
    server: {
        androidScheme: 'https'
    }
};

export default config;