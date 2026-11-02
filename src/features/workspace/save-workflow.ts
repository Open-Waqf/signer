import {Annotation, CertificateSigningConfig, SignaturePayload} from '../../types';

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
            certificateConfig?: CertificateSigningConfig;
        }
    ) => Promise<SaveDocResult>;
};

export type FinalizeSaveDeps = {
    savePdf: (filename: string, data: Uint8Array) => Promise<{ filename: string; uri?: string }>;
    isNativePlatform: () => boolean;
    toast: (msg: string) => void;
    messages: {
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
    certificateConfig?: CertificateSigningConfig;
}): Promise<{ result: SaveDocResult }> {
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
            certificateConfig: input.certificateConfig,
        }
    );
    return {result};
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
        // No automatic share sheet: the "Saved" sheet offers Share, so the user
        // sees one layer at a time instead of a share sheet on top of it.
        saved = await input.deps.savePdf(filename, savedBytes);
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
