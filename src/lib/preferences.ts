type HardwarePref = 'prompt' | 'always' | 'never';
type UiMode = 'basic' | 'advanced';
type ActiveSidebar = 'thumbnails' | 'annotations' | null;

const KEYS = {
    lang: 'signer_lang',
    hardwarePref: 'signer_hardware_pref',
    activeSidebar: 'signer_active_sidebar',
    uiMode: 'signer_ui_mode',
    userEmail: 'signer_user_email',
} as const;

export const preferences = {
    getLang(): string | null {
        return localStorage.getItem(KEYS.lang);
    },
    setLang(lang: string) {
        localStorage.setItem(KEYS.lang, lang);
    },
    getHardwarePref(): HardwarePref | null {
        const value = localStorage.getItem(KEYS.hardwarePref);
        return value === 'prompt' || value === 'always' || value === 'never' ? value : null;
    },
    setHardwarePref(value: HardwarePref) {
        localStorage.setItem(KEYS.hardwarePref, value);
    },
    /** The saved sidebar choice; `fallback` when the user never chose. */
    getActiveSidebar(fallback: ActiveSidebar = 'thumbnails'): ActiveSidebar {
        const value = localStorage.getItem(KEYS.activeSidebar);
        if (value === 'annotations') return 'annotations';
        if (value === 'thumbnails') return 'thumbnails';
        if (value === 'none') return null;
        return fallback;
    },
    setActiveSidebar(value: ActiveSidebar) {
        localStorage.setItem(KEYS.activeSidebar, value ?? 'none');
    },
    getUiMode(): UiMode {
        const value = localStorage.getItem(KEYS.uiMode);
        return value === 'advanced' ? 'advanced' : 'basic';
    },
    setUiMode(value: UiMode) {
        localStorage.setItem(KEYS.uiMode, value);
    },
    getUserEmail(defaultValue = ''): string {
        return localStorage.getItem(KEYS.userEmail) || defaultValue;
    },
    setUserEmail(email: string) {
        localStorage.setItem(KEYS.userEmail, email);
    },
    clearAll() {
        localStorage.clear();
    },
};

