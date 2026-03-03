import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {Annotation, CertificateSigningConfig, SignaturePayload} from '../types';
import {WebAuthnService} from './webauthn-service';
import {appendAuditPage, getHexToRgb, removeTrailingAuditPages, textToImage} from './pdf/audit-page-service';
import {
    calculateDeterministicHashIgnoringSubject,
    calculateSHA256,
    generateHashID,
    getSixDigitCode
} from './pdf/hash-service';
import {readMetadataID, setSignaturesSubject} from './pdf/metadata-service';
import {verifySignatureChain as verifySignatureChainCore} from './pdf/webauthn-chain-service';
import {signPdfWithCertificate} from './pdf/cms-signature-service';
import {getTimestampProof} from './tsa-service';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export class PdfEngine {
    private pdfDoc: any = null;
    private pdfBytes: Uint8Array | null = null;

    private describeError(error: unknown): string {
        if (error instanceof Error) return `${error.name}: ${error.message}`;
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    getSixDigitCode(hash: string): string {
        return getSixDigitCode(hash);
    }

    private get hexToRgb() {
        return getHexToRgb();
    }

    destroy() {
        if (this.pdfDoc) {
            this.pdfDoc.destroy();
            this.pdfDoc = null;
        }
        this.pdfBytes = null;
    }

    async load(data: Uint8Array) {
        this.pdfBytes = data;
        // Resolve PDF.js static assets from Vite base path relative to current location
        // so query params (e.g. ?lang=ar) and sub-path deployments both work.
        const base = new URL(import.meta.env.BASE_URL, window.location.href);
        const cMapUrl = new URL('cmaps/', base).toString();
        const standardFontDataUrl = new URL('standard_fonts/', base).toString();
        const attempts: Array<Record<string, unknown>> = [
            {
                cMapUrl,
                cMapPacked: true,
                standardFontDataUrl,
                useSystemFonts: true,
                disableFontFace: false,
            },
            {
                cMapUrl,
                cMapPacked: true,
                useSystemFonts: true,
                disableFontFace: true,
            },
            {
                useSystemFonts: true,
                disableFontFace: true,
            },
        ];

        let lastError: unknown = null;
        for (let i = 0; i < attempts.length; i++) {
            try {
                const loadingTask = pdfjsLib.getDocument({
                    // PDF.js may transfer/detach ArrayBuffer internally on some Android WebViews.
                    // Re-create a fresh copy for each attempt.
                    data: new Uint8Array(data),
                    ...attempts[i],
                });
                this.pdfDoc = await loadingTask.promise;
                return this.pdfDoc.numPages;
            } catch (error) {
                lastError = error;
                console.error(`[OWQ][PDF_LOAD_FAIL][attempt:${i + 1}] ${this.describeError(error)}`);
            }
        }
        throw new Error(`Failed to load PDF document: ${this.describeError(lastError)}`);
    }

    async renderPage(
        pageNumber: number,
        canvas: HTMLCanvasElement,
        scale = 1.5,
        opts?: { signal?: AbortSignal }
    ) {
        if (!this.pdfDoc) throw new Error('No PDF loaded');
        if (opts?.signal?.aborted) {
            throw new DOMException('Render aborted', 'AbortError');
        }
        const page = await this.pdfDoc.getPage(pageNumber);
        if (opts?.signal?.aborted) {
            throw new DOMException('Render aborted', 'AbortError');
        }
        const viewport = page.getViewport({scale});
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        const canvasContext = canvas.getContext('2d')!;
        // Keep PDF glyph shaping stable regardless of UI direction (RTL/LTR).
        if ('direction' in canvasContext) {
            (canvasContext as CanvasRenderingContext2D & { direction?: CanvasDirection }).direction = 'ltr';
        }
        const renderTask = page.render({canvasContext, viewport});
        if (opts?.signal) {
            const onAbort = () => {
                try {
                    renderTask.cancel();
                } catch {
                    // Ignore cancellation races.
                }
            };
            opts.signal.addEventListener('abort', onAbort, {once: true});
            try {
                await renderTask.promise;
            } finally {
                opts.signal.removeEventListener('abort', onAbort);
            }
            return;
        }
        await renderTask.promise;
    }

    async saveProfessional(
        annotations: Annotation[],
        filename: string,
        includeAuditTrail: boolean,
        includeFooter: boolean,
        validationLog: string | null = null,
        opts?: {
            previousSignatures?: SignaturePayload[];
            previousHashManuallyVerified?: boolean;
            openedDocumentHash?: string;
            enableWebAuthn?: boolean;
            userName?: string;
            hardwareFallbackUsed?: boolean;
            certificateConfig?: CertificateSigningConfig;
        }
    ): Promise<{
        pdfBytes: Uint8Array,
        docId: string,
        finalHash: string,
        finalCode: string,
        signatures: SignaturePayload[]
    }> {
        if (!this.pdfBytes) throw new Error('No PDF bytes available');
        const pdfDoc = await PDFDocument.load(this.pdfBytes);

        const signingDate = new Date();
        const contentHash = await calculateSHA256(this.pdfBytes);
        const fingerprint = contentHash + filename + signingDate.toISOString() + JSON.stringify(annotations);
        const docId = await generateHashID(fingerprint);

        const existingMeta = await readMetadataID(this.pdfBytes);
        const baseSignatures = [...(opts?.previousSignatures ?? existingMeta.signatures)];
        const openedDocumentHash = opts?.openedDocumentHash ?? contentHash;
        const previousHashManuallyVerified = baseSignatures.length === 0 ? true : !!opts?.previousHashManuallyVerified;
        const useWebAuthn = !!opts?.enableWebAuthn;

        pdfDoc.setTitle('Signed Document');
        pdfDoc.setProducer('Open Waqf Signer');
        pdfDoc.setModificationDate(signingDate);
        pdfDoc.setKeywords([`ref:${docId}`]);

        const identityAnn = annotations.find(a => a.type === 'identity');
        const emailMatch = identityAnn?.data?.split(':').pop()?.trim();
        if (emailMatch) {
            pdfDoc.setAuthor(emailMatch);
        }

        const creatorParts = ['Open Waqf Signer'];
        if (emailMatch) creatorParts.push(`Identity:${emailMatch}`);
        pdfDoc.setCreator(creatorParts.join(' | '));

        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        if (includeFooter) {
            const footerText = `Signed via Open Waqf | Ref: ${docId}`;
            for (const page of pages) {
                const {width} = page.getSize();
                page.drawText(footerText, {
                    x: width / 2 - 90, y: 8, size: 6, font, color: rgb(0.6, 0.6, 0.6),
                });
            }
        }

        for (const ann of annotations) {
            if (ann.page < 0 || ann.page >= pages.length) continue;
            const page = pages[ann.page];
            const {width, height} = page.getSize();

            if (ann.type === 'biometric') {
                const targetWidth = width * (ann.widthPct || 0.2);
                const targetHeight = 25;
                const x = width * ann.xPct;
                const y = height - (height * ann.yPct) - targetHeight;

            const textColor = ann.color ? this.hexToRgb(ann.color) : rgb(0, 0, 0.5);
                page.drawRectangle({
                    x, y, width: targetWidth, height: targetHeight,
                    borderWidth: 1, borderColor: textColor,
                    color: rgb(0.95, 0.95, 1)
                });
                page.drawText('BIOMETRIC VERIFIED', {
                    x: x + 5, y: y + 10, size: 7, font, color: textColor,
                });
                page.drawText(`ID: ${ann.id.substring(0, 8)}`, {
                    x: x + 5, y: y + 2, size: 5, font, color: textColor,
                });
            } else if ((ann.type === 'date' || ann.type === 'identity') && ann.data) {
                const imgBuffer = await textToImage(ann.data, ann.fontSize || 12, ann.fontWeight === 'bold', ann.fontFamily || 'Amiri', ann.color || '#000000');
                const pngImage = await pdfDoc.embedPng(imgBuffer);
                const scaleFactor = 0.75;
                const w = (pngImage.width / 3) * scaleFactor;
                const h = (pngImage.height / 3) * scaleFactor;
                const pdfY = height - (height * ann.yPct) - h;
                page.drawImage(pngImage, {x: width * ann.xPct, y: pdfY, width: w, height: h});
            } else if (ann.data) {
                const pngImage = await pdfDoc.embedPng(ann.data);
                const targetWidth = width * (ann.widthPct || 0.2);
                const imgDims = pngImage.scale(1);
                const ratio = imgDims.height / imgDims.width;
                const targetHeight = targetWidth * ratio;
                page.drawImage(pngImage, {
                    x: width * ann.xPct,
                    y: height - (height * ann.yPct) - targetHeight,
                    width: targetWidth,
                    height: targetHeight,
                });
            }
        }

        const provisionalPayload: SignaturePayload = {
            signerIndex: baseSignatures.length + 1,
            challengeHash: '',
            openedDocumentHash,
            previousHashManuallyVerified,
            timestampIso: signingDate.toISOString(),
            signerAnnotationIds: annotations.map((a) => a.id),
            validationLog,
            refId: docId,
            auditPageIncluded: includeAuditTrail,
            hardwareFallbackUsed: !!opts?.hardwareFallbackUsed,
            isHardwareBacked: false,
        };

        const provisionalSignatures = [...baseSignatures, provisionalPayload];
        setSignaturesSubject(pdfDoc, provisionalSignatures);

        if (includeAuditTrail) {
            await removeTrailingAuditPages(pdfDoc, this.pdfBytes);
            await appendAuditPage(pdfDoc, provisionalSignatures, filename, docId, validationLog);
        }

        const interimBytes = await pdfDoc.save();
        const integrityAnchorHash = await calculateDeterministicHashIgnoringSubject(interimBytes);
        const challengeHash = integrityAnchorHash;
        const tsaProof = await getTimestampProof(challengeHash);

        let webauthnData: SignaturePayload['webauthnData'] = undefined;
        if (useWebAuthn) {
            const challengeBytes = new Uint8Array(challengeHash.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
            const signed = await WebAuthnService.sign(challengeBytes, opts?.userName || 'User');
            if (!signed.publicKeySpki) {
                throw new Error('Hardware proof unavailable on this browser.');
            }
            webauthnData = {
                publicKey: signed.publicKeySpki,
                assertion: JSON.stringify({
                    signature: signed.signature,
                    authData: signed.authData,
                    clientDataJSON: signed.clientDataJSON,
                })
            };
        }

        const finalizedSignatures = [...baseSignatures, {
            ...provisionalPayload,
            timestampIso: tsaProof.timestampIso,
            tsaVerified: tsaProof.tsaVerified,
            tsaProvider: tsaProof.tsaProvider,
            tsaTokenBase64: tsaProof.tsaTokenBase64,
            tsaFailureReason: tsaProof.tsaFailureReason,
            challengeHash,
            integrityAnchorHash,
            isHardwareBacked: !!webauthnData,
            webauthnData,
        }];
        const finalDoc = await PDFDocument.load(interimBytes, {updateMetadata: false});
        setSignaturesSubject(finalDoc, finalizedSignatures);
        let savedBytes = await finalDoc.save({useObjectStreams: false});
        if (opts?.certificateConfig) {
            try {
                savedBytes = await signPdfWithCertificate(savedBytes, opts.certificateConfig);
            } catch (error) {
                throw new Error('Certificate signing failed. Check certificate password and file format.');
            }
        }

        const finalHash = await calculateSHA256(savedBytes);
        const finalCode = this.getSixDigitCode(finalHash);

        return {pdfBytes: savedBytes, docId, finalHash, finalCode, signatures: finalizedSignatures};
    }

    async getFileHash(fileData: Uint8Array): Promise<string> {
        return calculateSHA256(fileData);
    }

    async getIntegrityAnchorHash(fileData: Uint8Array): Promise<string> {
        return calculateDeterministicHashIgnoringSubject(fileData);
    }

    async verifySignatureChain(fileData: Uint8Array): Promise<{ valid: boolean, failedSignerIndex?: number, signatures: SignaturePayload[] }> {
        const meta = await readMetadataID(fileData);
        return verifySignatureChainCore({
            fileData,
            signatures: meta.signatures,
            calculateDeterministicHashIgnoringSubject,
            hasStandardSignature: meta.hasStandardSignature,
        });
    }

    async readMetadataID(fileData: Uint8Array): Promise<{id: string | null, assertions: any[], signatures: SignaturePayload[], hasStandardSignature: boolean}> {
        return readMetadataID(fileData);
    }
}

export const pdfEngine = new PdfEngine();
