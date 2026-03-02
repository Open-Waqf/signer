import * as pdfjsLib from 'pdfjs-dist';
import {PageSizes, PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';
import {Annotation, SignaturePayload} from '../types';
import QRCode from 'qrcode';
import {AppConfig} from '../config';
import {WebAuthnService} from './webauthn-service';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const CHAIN_META_PREFIX = 'OWQ_CHAIN:';
const AUDIT_MARKER_PREFIX = 'OWQ_AUDIT_PAGE_V1:';

// Helper: Generate ID from hash (short version)
async function generateHashID(text: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 12).toUpperCase();
}

// Helper: Calculate full SHA-256 hash of file bytes
async function calculateSHA256(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

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

export class PdfEngine {
    private pdfDoc: any = null;
    private pdfBytes: Uint8Array | null = null;

    private parseSignaturesFromSubject(subject: string | undefined): SignaturePayload[] {
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

    private setSignaturesSubject(pdfDoc: PDFDocument, signatures: SignaturePayload[]) {
        const safe = signatures.map((payload, idx) => ({
            ...payload,
            signerIndex: idx + 1,
        }));
        pdfDoc.setSubject(`${CHAIN_META_PREFIX}${JSON.stringify({version: 1, signatures: safe})}`);
    }

    private pageContainsAuditMarker(pageText: string): boolean {
        return pageText.includes(AUDIT_MARKER_PREFIX);
    }

    private async removeTrailingAuditPages(pdfDoc: PDFDocument, sourceBytes: Uint8Array) {
        if (pdfDoc.getPageCount() <= 1) return false;
        const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(sourceBytes)});
        const srcDoc = await loadingTask.promise;
        const lastPage = await srcDoc.getPage(srcDoc.numPages);
        const textContent = await lastPage.getTextContent();
        const text = (textContent.items || []).map((i: any) => i.str || '').join(' ');
        const hasMarker = this.pageContainsAuditMarker(text);
        srcDoc.destroy();
        if (hasMarker && pdfDoc.getPageCount() > 1) {
            pdfDoc.removePage(pdfDoc.getPageCount() - 1);
            return true;
        }
        return false;
    }

    private async calculateDeterministicHashIgnoringSubject(fileData: Uint8Array): Promise<string> {
        const pdfDoc = await PDFDocument.load(fileData, {updateMetadata: false});
        pdfDoc.setSubject('');
        pdfDoc.setCreationDate(new Date(0));
        pdfDoc.setModificationDate(new Date(0));
        const normalized = await pdfDoc.save();
        return calculateSHA256(normalized);
    }

    getSixDigitCode(hash: string): string {
        const normalized = hash.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
        const seed = Number.parseInt(normalized.slice(0, 12) || '0', 16);
        return String(seed % 1000000).padStart(6, '0');
    }

    private async textToImage(text: string, fontSize: number = 12, isBold: boolean = false, fontFamily: string = 'Amiri', color: string = '#000000'): Promise<Uint8Array> {
        let canvas: HTMLCanvasElement | null = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context not available');

        const scale = 3;
        const fontSizePx = fontSize * scale;
        const font = `${isBold ? 'bold' : 'normal'} ${fontSizePx}px "${fontFamily}", "Segoe UI", "Segoe UI Emoji", "Apple Color Emoji", "Helvetica", "Arial", sans-serif`;
        ctx.font = font;
        const metrics = ctx.measureText(text);
        const width = Math.ceil(metrics.width);
        const height = Math.ceil(fontSizePx * 1.5);

        canvas.width = width;
        canvas.height = height;

        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        ctx.direction = 'inherit';
        ctx.fillText(text, 0, height / 2);

        return new Promise((resolve, reject) => {
            if (!canvas) return reject('Canvas lost');
            canvas.toBlob(async (blob) => {
                if (blob) {
                    const buffer = await blob.arrayBuffer();
                    resolve(new Uint8Array(buffer));
                } else {
                    reject(new Error('Canvas conversion failed'));
                }
                if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                    canvas.remove();
                    canvas = null;
                }
            }, 'image/png');
        });
    }

    private async generateQRCode(text: string): Promise<Uint8Array> {
        try {
            const dataUrl = await QRCode.toDataURL(text, {
                errorCorrectionLevel: 'M', margin: 0, width: 200, color: {dark: '#000000', light: '#ffffff'}
            });
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            return new Uint8Array(await blob.arrayBuffer());
        } catch (err) {
            console.error('QR Gen Error', err);
            return new Uint8Array(0);
        }
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

        const baseUrl = window.location.href.replace(/index\.html.*/, '');
        const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

        const loadingTask = pdfjsLib.getDocument({
            data: new Uint8Array(data),
            cMapUrl: `${cleanBase}cmaps/`,
            cMapPacked: true,
            standardFontDataUrl: `${cleanBase}standard_fonts/`
        });
        this.pdfDoc = await loadingTask.promise;
        return this.pdfDoc.numPages;
    }

    async renderPage(pageNumber: number, canvas: HTMLCanvasElement, scale = 1.5) {
        if (!this.pdfDoc) throw new Error('No PDF loaded');
        const page = await this.pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({scale});
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({canvasContext: canvas.getContext('2d')!, viewport}).promise;
    }

    private async appendAuditPage(
        pdfDoc: PDFDocument,
        signatures: SignaturePayload[],
        filename: string,
        docId: string,
        validationLog: string | null,
    ) {
        const page = pdfDoc.addPage(PageSizes.A4);
        const {width, height} = page.getSize();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const drawLabel = (text: string, x: number, y: number, size = 10, bold = false) => {
            page.drawText(text, {x, y, size, font: bold ? fontBold : font, color: rgb(0, 0, 0)});
        };

        drawLabel(`${AUDIT_MARKER_PREFIX}${docId}`, 4, 4, 1, false);

        let y = height - 50;
        const dateStr = new Date().toLocaleString();
        const verifyUrl = `${AppConfig.website}/?id=${docId}`;

        drawLabel('OPEN WAQF AUDIT TRAIL', 50, y, 16, true);

        const qrBytes = await this.generateQRCode(verifyUrl);
        if (qrBytes.length > 0) {
            const qrImg = await pdfDoc.embedPng(qrBytes);
            const qrSize = 80;
            const qrY = y - qrSize + 10;
            page.drawImage(qrImg, {x: width - qrSize - 50, y: qrY, width: qrSize, height: qrSize});
            drawLabel(`Ref: ${docId}`, width - qrSize - 50, qrY - 15, 8);
        }

        y -= 40;
        drawLabel('Document:', 50, y, 10, true);
        drawLabel(filename, 140, y, 10);
        y -= 20;
        drawLabel('Date:', 50, y, 10, true);
        drawLabel(dateStr, 140, y, 10);
        y -= 20;
        drawLabel('Validator:', 50, y, 10, true);
        drawLabel('Open Waqf Signer (Local/Offline)', 140, y, 10);

        y -= 40;
        page.drawLine({start: {x: 50, y}, end: {x: width - 50, y}, thickness: 1, color: rgb(0.8, 0.8, 0.8)});
        y -= 26;
        drawLabel('SIGNATURE CHAIN LOG', 50, y, 12, true);
        y -= 20;

        if (validationLog) {
            drawLabel(`SECURITY NOTE: ${validationLog}`, 50, y, 9);
            y -= 18;
        }

        for (const sig of signatures) {
            if (y < 95) break;
            drawLabel(`Signer ${sig.signerIndex}`, 50, y, 10, true);
            y -= 14;
            if (sig.signerIndex > 1) {
                drawLabel(`Opened Hash: ${sig.openedDocumentHash.slice(0, 16)}...`, 55, y, 8);
                y -= 11;
            }
            drawLabel(`Hardware Proof Embedded: ${sig.isHardwareBacked ? 'YES (Cryptographic Proof)' : 'NO (Visual Only)'}`, 55, y, 8);
            y -= 11;
            if (sig.signerIndex > 1) {
                drawLabel(`Verified Previous: ${sig.previousHashManuallyVerified ? 'YES' : 'NO'}`, 55, y, 8);
                y -= 14;
            } else {
                y -= 3;
            }
            if (sig.hardwareFallbackUsed) {
                drawLabel(`WARNING: Hardware requested but proof could not be embedded. Saved as visual-only.`, 55, y, 8);
                y -= 14;
            }

            if (!sig.previousHashManuallyVerified && sig.signerIndex > 1) {
                drawLabel(`WARNING: Signer ${sig.signerIndex} signed without manually verifying Signer ${sig.signerIndex - 1}. Prior-chain trust was not confirmed manually.`, 55, y, 8);
                y -= 14;
            }
        }

        drawLabel('Valid only if cryptographic chain remains intact.', 50, 40, 8);
    }

    private hexToRgb(hex: string) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return rgb(r, g, b);
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

        const existingMeta = await this.readMetadataID(this.pdfBytes);
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
                const imgBuffer = await this.textToImage(ann.data, ann.fontSize || 12, ann.fontWeight === 'bold', ann.fontFamily || 'Amiri', ann.color || '#000000');
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
        this.setSignaturesSubject(pdfDoc, provisionalSignatures);

        if (includeAuditTrail) {
            await this.removeTrailingAuditPages(pdfDoc, this.pdfBytes);
            await this.appendAuditPage(pdfDoc, provisionalSignatures, filename, docId, validationLog);
        }

        const interimBytes = await pdfDoc.save();
        const integrityAnchorHash = await this.calculateDeterministicHashIgnoringSubject(interimBytes);
        const challengeHash = integrityAnchorHash;

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
            challengeHash,
            integrityAnchorHash,
            isHardwareBacked: !!webauthnData,
            webauthnData,
        }];
        const finalDoc = await PDFDocument.load(interimBytes, {updateMetadata: false});
        this.setSignaturesSubject(finalDoc, finalizedSignatures);
        const savedBytes = await finalDoc.save();

        const finalHash = await calculateSHA256(savedBytes);
        const finalCode = this.getSixDigitCode(finalHash);

        return {pdfBytes: savedBytes, docId, finalHash, finalCode, signatures: finalizedSignatures};
    }

    async getFileHash(fileData: Uint8Array): Promise<string> {
        return calculateSHA256(fileData);
    }

    async getIntegrityAnchorHash(fileData: Uint8Array): Promise<string> {
        return this.calculateDeterministicHashIgnoringSubject(fileData);
    }

    async verifySignatureChain(fileData: Uint8Array): Promise<{ valid: boolean, failedSignerIndex?: number, signatures: SignaturePayload[] }> {
        const meta = await this.readMetadataID(fileData);
        if (meta.signatures.length === 0) return {valid: false, signatures: []};
        const latest = meta.signatures[meta.signatures.length - 1];
        if (latest.integrityAnchorHash) {
            const currentAnchor = await this.calculateDeterministicHashIgnoringSubject(fileData);
            if (currentAnchor !== latest.integrityAnchorHash) {
                return {valid: false, failedSignerIndex: latest.signerIndex, signatures: meta.signatures};
            }
        }

        for (let i = meta.signatures.length - 1; i >= 0; i--) {
            const payload = meta.signatures[i];
            if (!payload.openedDocumentHash || !payload.challengeHash) {
                return {valid: false, failedSignerIndex: payload.signerIndex, signatures: meta.signatures};
            }

            if (i > 0) {
                const previous = meta.signatures[i - 1];
                const expectedPreviousHash = previous.integrityAnchorHash || previous.challengeHash;
                if (!expectedPreviousHash || payload.openedDocumentHash !== expectedPreviousHash) {
                    return {valid: false, failedSignerIndex: payload.signerIndex, signatures: meta.signatures};
                }
            }

            if (payload.webauthnData?.publicKey && payload.webauthnData?.assertion) {
                try {
                    const parsed = JSON.parse(payload.webauthnData.assertion);
                    const challengeBytes = new Uint8Array(payload.challengeHash.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []);
                    const ok = await WebAuthnService.verifyLocal(
                        payload.webauthnData.publicKey,
                        parsed.signature,
                        parsed.authData,
                        parsed.clientDataJSON,
                        challengeBytes
                    );
                    if (!ok) {
                        return {valid: false, failedSignerIndex: payload.signerIndex, signatures: meta.signatures};
                    }
                } catch {
                    return {valid: false, failedSignerIndex: payload.signerIndex, signatures: meta.signatures};
                }
            } else if (payload.isHardwareBacked) {
                return {valid: false, failedSignerIndex: payload.signerIndex, signatures: meta.signatures};
            }
        }

        return {valid: true, signatures: meta.signatures};
    }

    async readMetadataID(fileData: Uint8Array): Promise<{id: string | null, assertions: any[], signatures: SignaturePayload[]}> {
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

            const signatures = this.parseSignaturesFromSubject(pdfDoc.getSubject() || '');
            return {id, assertions, signatures};
        } catch (e) {
            console.error('Read Error', e);
            return {id: null, assertions: [], signatures: []};
        }
    }
}

export const pdfEngine = new PdfEngine();
