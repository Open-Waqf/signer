import {config, LanguageCode, resources, TranslationKey} from '../i18n/locales';

class I18nService {
    private currentLang: LanguageCode = 'en';

    constructor() {
        this.init();
    }

    init() {
        // 1. Try to get user preference from LocalStorage
        const saved = localStorage.getItem('app-lang') as LanguageCode;

        // 2. If not found, detect System Language (Android/Browser)
        const system = navigator.language.split('-')[0] as LanguageCode;

        // 3. Fallback to default
        if (saved && resources[saved]) {
            this.currentLang = saved;
        } else if (resources[system]) {
            this.currentLang = system;
        } else {
            this.currentLang = config.defaultLang as LanguageCode;
        }

        this.applyDirection();
    }

    get lang() {
        return this.currentLang;
    }

    t(key: TranslationKey): string {
        return resources[this.currentLang][key] || resources['en'][key] || key;
    }

    setLanguage(lang: LanguageCode) {
        if (!resources[lang]) return;
        this.currentLang = lang;
        localStorage.setItem('app-lang', lang);
        this.applyDirection();
        window.dispatchEvent(new CustomEvent('lang-changed'));
    }

    private applyDirection() {
        const dir = resources[this.currentLang].direction || 'ltr';
        document.documentElement.dir = dir;
        document.documentElement.lang = this.currentLang;
    }
}

export const i18n = new I18nService();