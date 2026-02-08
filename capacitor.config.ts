import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'org.openwaqf.signer',
    appName: 'Open Signer',
    webDir: 'dist',
    server: {
        androidScheme: 'https'
    }
};

export default config;