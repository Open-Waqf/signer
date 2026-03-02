import {config, LanguageCode, LANGUAGES, resources} from '../i18n/locales';

class I18nService {
    private currentLang: LanguageCode = 'en';

    constructor() {
        this.init();
    }

    init() {
        // 1. Priority: URL Query Param (?lang=ar)
        const params = new URLSearchParams(window.location.search);
        const urlLang = params.get('lang');

        // 2. Secondary: LocalStorage
        const saved = localStorage.getItem('signer_lang') as LanguageCode;

        // 3. Fallback: System Language
        const system = navigator.language.split('-')[0] as LanguageCode;

        const isSupported = (lang: string): lang is LanguageCode =>
            LANGUAGES.some(l => l.code === lang);

        // Decide Language
        if (urlLang && isSupported(urlLang)) {
            this.currentLang = urlLang;
        } else if (saved && isSupported(saved)) {
            this.currentLang = saved;
        } else if (isSupported(system)) {
            this.currentLang = system;
        } else {
            this.currentLang = config.defaultLang as LanguageCode;
        }

        this.applyLanguageSideEffects();
    }

    get lang() {
        return this.currentLang;
    }

    t(key: any): string {
        return (resources[this.currentLang] as any)?.[key] || (resources['en'] as any)[key] || key;
    }

    setLanguage(lang: LanguageCode) {
        if (!LANGUAGES.some(l => l.code === lang)) return;
        this.currentLang = lang;

        // 1. Save Preference
        localStorage.setItem('signer_lang', lang);

        // 2. Update URL (Silent push, no reload)
        const url = new URL(window.location.href);
        url.searchParams.set('lang', lang);
        window.history.pushState({}, '', url);

        // 3. Apply Visuals (Dir, SEO, Title)
        this.applyLanguageSideEffects();

        // 4. Notify App
        window.dispatchEvent(new CustomEvent('lang-changed'));
    }

    cycleNext() {
        const index = LANGUAGES.findIndex(l => l.code === this.currentLang);
        const next = LANGUAGES[(index + 1) % LANGUAGES.length];
        this.setLanguage(next.code);
    }

    getCurrentLabel(): string {
        return LANGUAGES.find(l => l.code === this.currentLang)?.label ?? 'English';
    }

    private applyLanguageSideEffects() {
        // A. Direction (RTL/LTR) — derived from LANGUAGES config, single source of truth
        const dir = LANGUAGES.find(l => l.code === this.currentLang)?.dir ?? 'ltr';
        document.documentElement.dir = dir;
        document.documentElement.lang = this.currentLang;

        // B. SEO & Meta Tags (Dynamic Update)
        this.updateMeta();
    }

    private updateMeta() {
        const title = this.t('appTitle');
        const desc = this.t('appDesc') || "Secure, Offline, Free PDF Signer."; // Ensure this key exists in locales

        // 1. Browser Title
        document.title = title;

        // 2. Meta Tags Helper
        const setMeta = (selector: string, value: string) => {
            let element = document.querySelector(selector);
            if (!element) {
                element = document.createElement('meta');
                // Parse selector to create element (simple version)
                if (selector.includes('name')) element.setAttribute('name', selector.split('=')[1].replace(']', '').replace(/['"]/g, ''));
                if (selector.includes('property')) element.setAttribute('property', selector.split('=')[1].replace(']', '').replace(/['"]/g, ''));
                document.head.appendChild(element);
            }
            element.setAttribute('content', value);
        };

        // 3. Update Standard & Social Tags
        setMeta('meta[name="description"]', desc);
        setMeta('meta[property="og:title"]', title);
        setMeta('meta[property="og:description"]', desc);
        setMeta('meta[property="og:locale"]', this.currentLang);
        setMeta('meta[name="twitter:title"]', title);
        setMeta('meta[name="twitter:description"]', desc);
    }
}

export const i18n = new I18nService();