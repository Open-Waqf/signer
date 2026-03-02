import {PDFDocument} from 'pdf-lib';
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

export async function readMetadataID(fileData: Uint8Array): Promise<{ id: string | null, assertions: any[], signatures: SignaturePayload[] }> {
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
        return {id, assertions, signatures};
    } catch (e) {
        console.error('Read Error', e);
        return {id: null, assertions: [], signatures: []};
    }
}

