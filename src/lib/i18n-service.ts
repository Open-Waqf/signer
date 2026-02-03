import {config, LanguageCode, resources, TranslationKey} from '../i18n/locales';

class I18nService {
    private currentLang: LanguageCode = 'en';

    constructor() {
        this.init();
    }

    init() {
        // 1. Try to get user preference (PREFIXED)
        const saved = localStorage.getItem('signer_lang') as LanguageCode;

        // 2. If not found, detect System Language
        const system = navigator.language.split('-')[0] as LanguageCode;

        // 3. Fallback logic
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
        return resources[this.currentLang]?.[key] || resources['en'][key] || key;
    }

    setLanguage(lang: LanguageCode) {
        if (!resources[lang]) return;
        this.currentLang = lang;
        localStorage.setItem('signer_lang', lang); // PREFIXED
        this.applyDirection();

        // Dispatch event for reactive UI updates
        window.dispatchEvent(new CustomEvent('lang-changed'));
    }

    // Helper to get display label
    getCurrentLabel() {
        switch (this.currentLang) {
            case 'en':
                return 'English';
            case 'ar':
                return 'العربية';
            case 'fr':
                return 'Français';
            default:
                return 'English';
        }
    }

    private applyDirection() {
        const dir = resources[this.currentLang]?.direction || 'ltr';
        document.documentElement.dir = dir;
        document.documentElement.lang = this.currentLang;
    }
}

export const i18n = new I18nService();