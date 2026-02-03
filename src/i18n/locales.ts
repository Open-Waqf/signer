// src/i18n/locales.ts

// 1. Global Configuration (Not language dependent, but overridable)
export const config = {
    defaultLang: 'en',
    dateFormat: 'YYYY-MM-DD',
    animationSpeed: 300,
};

// 2. The Translations
export const resources = {
    en: {
        appTitle: "Open Signer",
        privacy: "Privacy",
        zoomIn: "Zoom In",
        zoomOut: "Zoom Out",
        prev: "Prev",
        next: "Next",
        addSig: "+ Signature",
        addInitials: "+ Initials",
        addDate: "+ Date",
        savePdf: "Save PDF",
        savedMsg: "Document Saved!",
        privacyTitle: "🔒 Privacy Promise (Amanah)",
        privacyContent: "Your documents never leave this device. No tracking. No servers.",
        close: "Close",
        dragHint: "Drag to move",
        // Config Overrides (Example)
        direction: "ltr"
    },
    ar: {
        appTitle: "الموقع المفتوح",
        privacy: "الخصوصية",
        zoomIn: "تكبير",
        zoomOut: "تصغير",
        prev: "السابق",
        next: "التالي",
        addSig: "+ توقيع",
        addInitials: "+ أحرف",
        addDate: "+ تاريخ",
        savePdf: "حفظ الملف",
        savedMsg: "تم حفظ المستند!",
        privacyTitle: "🔒 وعد الأمانة",
        privacyContent: "مستنداتك لا تغادر هذا الجهاز أبداً. لا تتبع. لا خوادم.",
        close: "إغلاق",
        dragHint: "اسحب للتحريك",
        direction: "rtl"
    },
    fr: {
        appTitle: "Open Signer",
        privacy: "Confidentialité",
        zoomIn: "Zoom Avant",
        zoomOut: "Zoom Arrière",
        prev: "Préc.",
        next: "Suiv.",
        addSig: "+ Signature",
        addInitials: "+ Initiales",
        addDate: "+ Date",
        savePdf: "Enregistrer PDF",
        savedMsg: "Document enregistré !",
        privacyTitle: "🔒 Promesse de Confidentialité",
        privacyContent: "Vos documents ne quittent jamais cet appareil.",
        close: "Fermer",
        dragHint: "Glisser pour déplacer",
        direction: "ltr"
    }
} as const;

export type LanguageCode = keyof typeof resources;
export type TranslationKey = keyof typeof resources['en'];