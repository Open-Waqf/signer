import * as pdfjsLib from 'pdfjs-dist';
import {PageSizes, PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';
import {Annotation} from '../types';
import QRCode from 'qrcode';
import {AppConfig} from '../config';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

/**
 * Helper: Generate a SHA-256 Hash of the document content
 */
async function generateHashID(text: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Convert to Hex and take first 12 chars -> "A1B2C3D4E5F6"
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 12).toUpperCase();
}

/**
 * Helper: Calculate full SHA-256 hash of a file
 */
async function calculateSHA256(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

export class PdfEngine {
    private pdfDoc: any = null;
    private pdfBytes: Uint8Array | null = null;

    /**
     * 🛡️ MEMORY SAFE Text-To-Image
     */
    private async textToImage(text: string, fontSize: number = 12, isBold: boolean = false): Promise<Uint8Array> {
        let canvas: HTMLCanvasElement | null = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context not available');

        const scale = 3; // High Res
        const fontSizePx = fontSize * scale;
        const font = `${isBold ? 'bold' : 'normal'} ${fontSizePx}px "Amiri", "Segoe UI", "Helvetica", "Arial", sans-serif`;

        ctx.font = font;
        const metrics = ctx.measureText(text);
        const width = Math.ceil(metrics.width);
        const height = Math.ceil(fontSizePx * 1.5);

        canvas.width = width;
        canvas.height = height;

        ctx.font = font;
        ctx.fillStyle = 'black';
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
                errorCorrectionLevel: 'M',
                margin: 0,
                width: 200,
                color: {dark: '#000000', light: '#ffffff'}
            });
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            return new Uint8Array(await blob.arrayBuffer());
        } catch (err) {
            console.error("QR Gen Error", err);
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
        // ✅ OPTIMIZATION: Store reference instead of cloning (prevents Double RAM usage)
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

    private async appendAuditPage(pdfDoc: PDFDocument, annotations: Annotation[], filename: string, docId: string) {
        const page = pdfDoc.addPage(PageSizes.A4);
        const {width, height} = page.getSize();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const isAscii = (str: string) => /^[\x00-\x7F]*$/.test(str);

        const drawLabel = (text: string, x: number, y: number, size = 10, bold = false) => {
            page.drawText(text, {x, y, size, font: bold ? fontBold : font, color: rgb(0, 0, 0)});
        };

        const drawSmart = async (text: string, x: number, y: number, size = 10) => {
            if (isAscii(text)) {
                drawLabel(text, x, y, size);
            } else {
                try {
                    const imgBuffer = await this.textToImage(text, size, false);
                    const img = await pdfDoc.embedPng(imgBuffer);
                    const w = img.width / 3;
                    const h = img.height / 3;
                    page.drawImage(img, {x, y: y - (h / 4), width: w, height: h});
                } catch {
                    drawLabel("[Complex Text]", x, y, size);
                }
            }
        };

        let y = height - 50;
        const dateStr = new Date().toLocaleString();

        const verifyUrl = `${AppConfig.website}/verify?id=${docId}`;

        drawLabel("AUDIT TRAIL / CERTIFICATE", 50, y, 16, true);

        const qrBytes = await this.generateQRCode(verifyUrl);
        if (qrBytes.length > 0) {
            const qrImg = await pdfDoc.embedPng(qrBytes);
            const qrSize = 80;
            const qrY = y - qrSize + 10;

            page.drawImage(qrImg, {
                x: width - qrSize - 50,
                y: qrY,
                width: qrSize,
                height: qrSize
            });
            drawLabel(`Ref: ${docId}`, width - qrSize - 50, qrY - 15, 8);
        }

        y -= 40;
        drawLabel("Document:", 50, y, 10, true);
        await drawSmart(filename, 140, y, 10);
        y -= 20;
        drawLabel("Date:", 50, y, 10, true);
        await drawSmart(dateStr, 140, y, 10);
        y -= 20;
        drawLabel("Validator:", 50, y, 10, true);
        drawLabel("Open Waqf Signer (Local/Offline)", 140, y, 10);

        y -= 40;
        page.drawLine({start: {x: 50, y}, end: {x: width - 50, y}, thickness: 1, color: rgb(0.8, 0.8, 0.8)});
        y -= 30;

        drawLabel("EVENT LOG", 50, y, 12, true);
        y -= 20;

        const events = [
            `Document Loaded`,
            ...annotations.map((a, i) => `Action ${i + 1}: Added ${a.type.toUpperCase()} (Pg ${a.page + 1})`),
            `Finalized with ID: ${docId}`
        ];

        for (const evt of events) {
            if (y > 50) {
                drawLabel(`• ${evt}`, 50, y, 9);
                y -= 15;
            }
        }
        drawLabel("Valid only if digital structure is intact.", 50, 40, 8);
    }

    async saveProfessional(annotations: Annotation[], filename: string, includeAuditTrail: boolean): Promise<{
        pdfBytes: Uint8Array,
        docId: string,
        finalHash: string
    }> {
        if (!this.pdfBytes) throw new Error('No PDF bytes available');
        const pdfDoc = await PDFDocument.load(this.pdfBytes);

        const signingDate = new Date();
        // 🛡️ SECURITY: Bind ID to content hash so different files get different IDs
        const contentHash = await calculateSHA256(this.pdfBytes);
        const fingerprint = contentHash + filename + signingDate.toISOString() + JSON.stringify(annotations);
        const docId = await generateHashID(fingerprint);

        pdfDoc.setTitle('Signed Document');
        pdfDoc.setProducer('Open Waqf Signer');
        pdfDoc.setModificationDate(signingDate);
        pdfDoc.setKeywords([`ref:${docId}`]);

        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const footerText = `Signed via Open Waqf | Ref: ${docId}`;
        for (const page of pages) {
            const {width} = page.getSize();
            page.drawText(footerText, {
                x: width / 2 - 90,
                y: 8,
                size: 6,
                font,
                color: rgb(0.6, 0.6, 0.6),
            });
        }

        for (const ann of annotations) {
            if (ann.page < 0 || ann.page >= pages.length) continue;
            const page = pages[ann.page];
            const {width, height} = page.getSize();

            if ((ann.type === 'date' || ann.type === 'identity') && ann.data) {
                const imgBuffer = await this.textToImage(ann.data, ann.fontSize || 12, ann.fontWeight === 'bold');
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

        if (includeAuditTrail) {
            await this.appendAuditPage(pdfDoc, annotations, filename, docId);
        }

        const savedBytes = await pdfDoc.save();

        // 🔐 SECURITY: Calculate hash of the FINAL output for "Strict Verification"
        const finalHash = await calculateSHA256(savedBytes);

        return {pdfBytes: savedBytes, docId, finalHash};
    }

    // New Helper: Calculate Hash for Verification
    async getFileHash(fileData: Uint8Array): Promise<string> {
        return calculateSHA256(fileData);
    }

    async readMetadataID(fileData: Uint8Array): Promise<string | null> {
        try {
            const pdfDoc = await PDFDocument.load(fileData, {updateMetadata: false});
            const keywords = pdfDoc.getKeywords();
            if (!keywords) return null;
            const match = keywords.split(' ').find(k => k.startsWith('ref:'));
            return match ? match.replace('ref:', '') : null;
        } catch (e) {
            console.error("Read Error", e);
            return null;
        }
    }
}

export const pdfEngine = new PdfEngine();