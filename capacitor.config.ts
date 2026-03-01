import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'org.openwaqf.signer',
    appName: 'Open Signer',
    webDir: 'dist',
    plugins: {
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