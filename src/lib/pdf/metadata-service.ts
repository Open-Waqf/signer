import {PDFArray, PDFDict, PDFDocument, PDFName} from 'pdf-lib';
import {SignaturePayload} from '../../types';
import {CHAIN_META_PREFIX} from './constants';

function normalizeSignaturePayload(input: any, index: number): SignaturePayload | null {
    if (!input || typeof input !== 'object') return null;
    if (typeof input.openedDocumentHash !== 'string' || typeof input.challengeHash !== 'string') return null;

    return {
        signerIndex: typeof input.signerIndex === 'number' ? input.signerIndex : index + 1,
        challengeHash: input.challengeHash,
        openedDocumentHash: input.openedDocumentHash,
        integrityAnchorHash: typeof input.integrityAnchorHash === 'string' ? input.integrityAnchorHash : undefined,
        previousHashManuallyVerified: !!input.previousHashManuallyVerified,
        timestampIso: typeof input.timestampIso === 'string' ? input.timestampIso : new Date(0).toISOString(),
        tsaVerified: !!input.tsaVerified,
        tsaProvider: typeof input.tsaProvider === 'string' ? input.tsaProvider : undefined,
        tsaTokenBase64: typeof input.tsaTokenBase64 === 'string' ? input.tsaTokenBase64 : undefined,
        tsaFailureReason: typeof input.tsaFailureReason === 'string' ? input.tsaFailureReason : undefined,
        signerAnnotationIds: Array.isArray(input.signerAnnotationIds) ? input.signerAnnotationIds.filter((v: unknown) => typeof v === 'string') : [],
        validationLog: typeof input.validationLog === 'string' ? input.validationLog : null,
        refId: typeof input.refId === 'string' ? input.refId : undefined,
        auditPageIncluded: !!input.auditPageIncluded,
        hardwareFallbackUsed: !!input.hardwareFallbackUsed,
        isHardwareBacked: !!input.isHardwareBacked,
        webauthnData: input.webauthnData && typeof input.webauthnData === 'object' ? {
            publicKey: typeof input.webauthnData.publicKey === 'string' ? input.webauthnData.publicKey : '',
            assertion: typeof input.webauthnData.assertion === 'string' ? input.webauthnData.assertion : '',
        } : undefined,
    };
}

export function parseSignaturesFromSubject(subject: string | undefined): SignaturePayload[] {
    if (!subject || !subject.startsWith(CHAIN_META_PREFIX)) return [];
    const raw = subject.slice(CHAIN_META_PREFIX.length);
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.signatures)) return [];
        return parsed.signatures
            .map((item: unknown, idx: number) => normalizeSignaturePayload(item, idx))
            .filter((item: SignaturePayload | null): item is SignaturePayload => !!item);
    } catch {
        return [];
    }
}

export function setSignaturesSubject(pdfDoc: PDFDocument, signatures: SignaturePayload[]) {
    const safe = signatures.map((payload, idx) => ({
        ...payload,
        signerIndex: idx + 1,
    }));
    pdfDoc.setSubject(`${CHAIN_META_PREFIX}${JSON.stringify({version: 1, signatures: safe})}`);
}

function hasStandardCmsSignature(pdfDoc: PDFDocument): boolean {
    try {
        const context: any = (pdfDoc as any).context;
        const acroFormRef = pdfDoc.catalog.get(PDFName.of('AcroForm'));
        if (!acroFormRef) return false;
        const acroForm = context.lookup(acroFormRef, PDFDict);
        if (!acroForm) return false;

        const fields = acroForm.lookup(PDFName.of('Fields'), PDFArray);
        if (!fields) return false;

        const stack = [...fields.asArray()];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node) continue;
            const field = context.lookup(node, PDFDict);
            if (!field) continue;

            const ft = field.get(PDFName.of('FT'));
            if (ft instanceof PDFName && ft.asString() === '/Sig') return true;

            const value = field.get(PDFName.of('V'));
            if (value) return true;

            const kids = field.lookup(PDFName.of('Kids'), PDFArray);
            if (kids) stack.push(...kids.asArray());
        }
    } catch {
        return false;
    }
    return false;
}

export async function readMetadataID(fileData: Uint8Array): Promise<{ id: string | null, assertions: any[], signatures: SignaturePayload[], hasStandardSignature: boolean }> {
    try {
        const pdfDoc = await PDFDocument.load(fileData, {updateMetadata: false});
        const keywords = pdfDoc.getKeywords();
        const match = keywords?.match(/ref:([A-Za-z0-9]+)/i);
        const id = match ? match[1] : null;

        let assertions: any[] = [];
        const creator = pdfDoc.getCreator() || '';
        const assertionMatch = creator.match(/Assertions:(.*)$/);
        if (assertionMatch) {
            try {
                assertions = JSON.parse(assertionMatch[1]);
            } catch (e) {
                console.error('Failed to parse assertions from metadata', e);
            }
        }

        const signatures = parseSignaturesFromSubject(pdfDoc.getSubject() || '');
        const hasStandardSignature = hasStandardCmsSignature(pdfDoc);
        return {id, assertions, signatures, hasStandardSignature};
    } catch (e) {
        console.error('Read Error', e);
        return {id: null, assertions: [], signatures: [], hasStandardSignature: false};
    }
}
