import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'org.openwaqf.signer',
    appName: 'Open Signer',
    webDir: 'dist',
    plugins: {
        StatusBar: {
            style: 'DARK',
            backgroundColor: '#ffffff',
            overlaysWebView: false
        }
    },
    server: {
        androidScheme: 'https'
    }
};

export default config;