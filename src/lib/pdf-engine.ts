import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFDocument, type PDFImage, rgb, StandardFonts} from 'pdf-lib';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {Annotation, CertificateSigningConfig, SignaturePayload} from '../types';
import {appendAuditPage, removeTrailingAuditPages, textToImage} from './pdf/audit-page-service';
import {
    calculateDeterministicHashIgnoringSubject,
    calculateSHA256,
    generateHashID,
    getSixDigitCode
} from './pdf/hash-service';
import {readMetadataID, setSignaturesSubject} from './pdf/metadata-service';
import {verifySignatureChain as verifySignatureChainCore} from './pdf/signature-chain-service';
import {shownFrame} from './pdf/page-frame';
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

    destroy() {
        if (this.pdfDoc) {
            // pdf.js 6 removed PDFDocumentProxy.destroy(); the loading task owns the worker.
            void this.pdfDoc.loadingTask.destroy();
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
        // pdf.js 6 decodes JBIG2 and CCITT (fax) images, common in scans, with files
        // from public/wasm/. Without them those pages render blank, with no error.
        const wasmUrl = new URL('wasm/', base).toString();
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
                    wasmUrl,
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

    /** Page size in PDF points (scale 1), e.g. 595 x 842 for A4. */
    async getPageSize(pageNumber = 1): Promise<{ width: number; height: number }> {
        if (!this.pdfDoc) throw new Error('No PDF loaded');
        const page = await this.pdfDoc.getPage(pageNumber);
        const {width, height} = page.getViewport({scale: 1});
        return {width, height};
    }

    /**
     * Draw a page into the canvas. The canvas keeps the on-screen size of `scale`;
     * `pixelRatio` adds that many device pixels per screen pixel so text is sharp on phones
     * (capped by `maxPixels` to protect memory). Thumbnails call it without a pixel ratio.
     */
    async renderPage(
        pageNumber: number,
        canvas: HTMLCanvasElement,
        scale = 1.5,
        opts?: { signal?: AbortSignal; pixelRatio?: number; maxPixels?: number }
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
        let ratio = Math.max(1, opts?.pixelRatio ?? 1);
        if (opts?.maxPixels) {
            ratio = Math.max(1, Math.min(ratio, Math.sqrt(opts.maxPixels / (viewport.width * viewport.height))));
        }
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        // On-screen size stays the same as before, whatever the pixel ratio.
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const canvasContext = canvas.getContext('2d')!;
        // Keep PDF glyph shaping stable regardless of UI direction (RTL/LTR).
        if ('direction' in canvasContext) {
            (canvasContext as CanvasRenderingContext2D & { direction?: CanvasDirection }).direction = 'ltr';
        }
        const renderTask = page.render({
            canvasContext,
            viewport,
            ...(ratio !== 1 ? {transform: [ratio, 0, 0, ratio, 0, 0]} : {}),
        });
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
            // Each signer's footer one line above the earlier ones, never printed over them.
            const footerY = 8 + 9 * baseSignatures.length;
            for (const page of pages) {
                const frame = shownFrame(page);
                page.drawText(footerText, {
                    ...frame.toPage(frame.width / 2 - 90, footerY), rotate: frame.rotate,
                    size: 6, font, color: rgb(0.6, 0.6, 0.6),
                });
            }
        }

        // Each picture is stored in the file once and reused: "Apply to all pages" on a
        // 50-page file used to store the same signature 50 times.
        const embedded = new Map<string, PDFImage>();
        const embedOnce = async (key: string, png: () => Promise<Uint8Array | string>) => {
            let image = embedded.get(key);
            if (!image) {
                image = await pdfDoc.embedPng(await png());
                embedded.set(key, image);
            }
            return image;
        };

        for (const ann of annotations) {
            if (ann.page < 0 || ann.page >= pages.length) continue;
            const page = pages[ann.page];
            // Positions are fractions of the page as shown (turned and cropped).
            const frame = shownFrame(page);
            const {width, height} = frame;
            // Draw a w x h image whose top-left corner is at (left, top) of the shown page.
            const drawShown = (image: PDFImage, left: number, top: number, w: number, h: number) =>
                page.drawImage(image, {...frame.toPage(left, height - top - h), width: w, height: h, rotate: frame.rotate});

            if ((ann.type === 'date' || ann.type === 'identity') && ann.data) {
                const normalized = ann.data.replace(/\u200E/g, '').trim();
                const isDateLike = /^\d{2}\/\d{2}\/\d{4}$/.test(normalized);
                // Like dir="auto" on screen: the first letter decides (Arabic: right to left).
                // Not the page language, so Arabic text is right in an English session too.
                const firstStrong = normalized.match(/[A-Za-z\u00C0-\u024F\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/)?.[0] ?? '';
                const textDirection: CanvasDirection = !isDateLike && /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(firstStrong) ? 'rtl' : 'ltr';
                const style = [ann.data, ann.fontSize || 12, ann.fontWeight === 'bold', ann.fontFamily || 'Amiri', ann.color || '#000000', textDirection] as const;
                const pngImage = await embedOnce(`text:${JSON.stringify(style)}`, () => textToImage(...style));
                const scaleFactor = 0.75;
                const w = (pngImage.width / 3) * scaleFactor;
                const h = (pngImage.height / 3) * scaleFactor;
                drawShown(pngImage, width * ann.xPct, height * ann.yPct, w, h);
            } else if (ann.data) {
                const data = ann.data;
                const pngImage = await embedOnce(`image:${data}`, async () => data);
                const targetWidth = width * (ann.widthPct || 0.2);
                const imgDims = pngImage.scale(1);
                const ratio = imgDims.height / imgDims.width;
                const targetHeight = targetWidth * ratio;
                drawShown(pngImage, width * ann.xPct, height * ann.yPct, targetWidth, targetHeight);
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

        const finalizedSignatures = [...baseSignatures, {
            ...provisionalPayload,
            timestampIso: tsaProof.timestampIso,
            tsaVerified: tsaProof.tsaVerified,
            tsaProvider: tsaProof.tsaProvider,
            tsaTokenBase64: tsaProof.tsaTokenBase64,
            tsaFailureReason: tsaProof.tsaFailureReason,
            challengeHash,
            integrityAnchorHash,
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
