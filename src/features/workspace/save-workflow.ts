import {Annotation, SignaturePayload} from '../../types';

export type SaveDocResult = {
    pdfBytes: Uint8Array;
    docId: string;
    finalHash: string;
    finalCode: string;
    signatures: SignaturePayload[];
};

export type ExecuteSaveDeps = {
    saveProfessional: (
        annotations: Annotation[],
        filename: string,
        includeAuditTrail: boolean,
        includeFooter: boolean,
        validationLog: string | null,
        opts?: {
            previousSignatures?: SignaturePayload[];
            previousHashManuallyVerified?: boolean;
            openedDocumentHash?: string;
            enableWebAuthn?: boolean;
            userName?: string;
            hardwareFallbackUsed?: boolean;
        }
    ) => Promise<SaveDocResult>;
    getSavedEmail: () => string;
    setHardwarePrefNever: () => void;
    toast: (msg: string) => void;
    messages: {
        hardwareProofUnavailable: string;
    };
};

export type FinalizeSaveDeps = {
    savePdf: (filename: string, data: Uint8Array) => Promise<{ filename: string; uri?: string }>;
    sharePdf: (file: { filename: string; uri?: string }, dataIfWeb?: Uint8Array) => Promise<void>;
    isNativePlatform: () => boolean;
    toast: (msg: string) => void;
    messages: {
        exportingFile: string;
        savedMsg: string;
    };
    hapticSuccess: () => void;
};

export type ShareLatestDeps = {
    sharePdf: (file: { filename: string; uri?: string }, dataIfWeb?: Uint8Array) => Promise<void>;
    toast: (msg: string) => void;
    messages: {
        noChanges: string;
    };
};

export async function resolveHardwareUsage(input: {
    hasHardwareSupport: boolean;
    hasVisualSig: boolean;
    hardwarePref: 'prompt' | 'always' | 'never';
    isBasicMode: boolean;
    requestPromptDecision: () => Promise<boolean | null>;
}): Promise<{ cancelled: boolean; useHardware: boolean }> {
    let useHardware = false;
    if (input.hasHardwareSupport && input.hasVisualSig) {
        if (input.hardwarePref === 'always') {
            useHardware = true;
        } else if (input.hardwarePref === 'never') {
            useHardware = false;
        } else if (!input.isBasicMode) {
            const decision = await input.requestPromptDecision();
            if (decision === null) return {cancelled: true, useHardware: false};
            useHardware = decision;
        }
    }
    return {cancelled: false, useHardware};
}

export async function executeSave(input: {
    deps: ExecuteSaveDeps;
    annotations: Annotation[];
    pdfName: string;
    includeAudit: boolean;
    includeFooter: boolean;
    validationMsg: string | null;
    signaturesChain: SignaturePayload[];
    previousHashManuallyVerified: boolean;
    openedDocumentHash: string;
    useHardware: boolean;
}): Promise<{ result: SaveDocResult; hardwareFallbackUsed: boolean }> {
    const savedEmail = input.deps.getSavedEmail();
    try {
        const result = await input.deps.saveProfessional(
            input.annotations,
            input.pdfName,
            input.includeAudit,
            input.includeFooter,
            input.validationMsg,
            {
                previousSignatures: input.signaturesChain,
                previousHashManuallyVerified: input.previousHashManuallyVerified,
                openedDocumentHash: input.openedDocumentHash,
                enableWebAuthn: input.useHardware,
                userName: savedEmail,
            }
        );
        return {result, hardwareFallbackUsed: false};
    } catch (e: any) {
        const message = String(e?.message || '');
        if (!input.useHardware || !message.includes('Hardware proof unavailable')) throw e;

        input.deps.setHardwarePrefNever();
        input.deps.toast(input.deps.messages.hardwareProofUnavailable || 'Hardware proof unavailable on this browser. Saved as visual-only.');
        const result = await input.deps.saveProfessional(
            input.annotations,
            input.pdfName,
            input.includeAudit,
            input.includeFooter,
            input.validationMsg,
            {
                previousSignatures: input.signaturesChain,
                previousHashManuallyVerified: input.previousHashManuallyVerified,
                openedDocumentHash: input.openedDocumentHash,
                enableWebAuthn: false,
                userName: savedEmail,
                hardwareFallbackUsed: true,
            }
        );
        return {result, hardwareFallbackUsed: true};
    }
}

export async function finalizeSave(input: {
    deps: FinalizeSaveDeps;
    result: SaveDocResult;
    outputFilename: string;
    silentWeb: boolean;
    showToast: boolean;
}): Promise<{ saved: { filename: string; uri?: string }; savedBytes: Uint8Array }> {
    const filename = `${input.outputFilename}.pdf`;
    const savedBytes = input.result.pdfBytes;
    let saved: { filename: string; uri?: string };

    if (!input.deps.isNativePlatform() && input.silentWeb) {
        saved = {filename};
    } else {
        saved = await input.deps.savePdf(filename, savedBytes);
        if (input.deps.isNativePlatform() && input.showToast) {
            setTimeout(() => {
                input.deps.toast(input.deps.messages.exportingFile);
                void input.deps.sharePdf(saved, savedBytes);
            }, 200);
        }
    }

    input.deps.hapticSuccess();
    if (input.showToast) input.deps.toast(input.deps.messages.savedMsg);
    return {saved, savedBytes};
}

export async function shareLatestDocument(input: {
    deps: ShareLatestDeps;
    hasEdits: boolean;
    isDirty: boolean;
    lastSavedBytes: Uint8Array | null;
    lastSaved: { filename: string; uri?: string } | null;
    saveIfNeeded: () => Promise<void>;
}): Promise<void> {
    if (!input.hasEdits) {
        input.deps.toast(input.deps.messages.noChanges);
        return;
    }
    if (input.isDirty || !input.lastSavedBytes || !input.lastSaved) {
        await input.saveIfNeeded();
    }
    if (input.lastSaved && input.lastSavedBytes) {
        await input.deps.sharePdf(input.lastSaved, input.lastSavedBytes);
    }
}
