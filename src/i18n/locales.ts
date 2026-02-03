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
        direction: "ltr",
        selectFile: "Select PDF File",
        dragDropHint: "or drag and drop here",
        loadingDoc: "Loading Document...",
        errorLoading: "Error loading PDF. Is it valid?",
        exitConfirm: "Exit editing? Unsaved changes will be lost.",
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
        direction: "rtl",
        selectFile: "اختر ملف PDF",
        dragDropHint: "أو اسحب الملف هنا",
        loadingDoc: "جاري تحميل المستند...",
        errorLoading: "خطأ في تحميل الملف. هل هو صالح؟",
        exitConfirm: "هل تريد الخروج؟ ستفقد التغييرات غير المحفوظة.",
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
        direction: "ltr",
        selectFile: "Sélectionner un fichier PDF",
        dragDropHint: "ou glissez le fichier ici",
        loadingDoc: "Chargement du document...",
        errorLoading: "Erreur de chargement. Est-ce valide ?",
        exitConfirm: "Quitter ? Les modifications seront perdues.",
    }
} as const;

export type LanguageCode = keyof typeof resources;
export type TranslationKey = keyof typeof resources['en'];