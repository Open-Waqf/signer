import * as pdfjsLib from 'pdfjs-dist';
import {PageSizes, PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';
import {Annotation} from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export class PdfEngine {
    private pdfDoc: any = null;
    private pdfBytes: Uint8Array | null = null;

    private async textToImage(text: string, fontSize: number = 12, isBold: boolean = false): Promise<Uint8Array> {
        // 1. Create canvas
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

        // 2. Resize & Draw
        canvas.width = width;
        canvas.height = height;

        ctx.font = font;
        ctx.fillStyle = 'black';
        ctx.textBaseline = 'middle';
        ctx.direction = 'inherit';
        ctx.fillText(text, 0, height / 2);

        // 3. Convert & CLEANUP
        return new Promise((resolve, reject) => {
            if (!canvas) return reject('Canvas lost');

            canvas.toBlob(async (blob) => {
                if (blob) {
                    const buffer = await blob.arrayBuffer();
                    resolve(new Uint8Array(buffer));
                } else {
                    reject(new Error('Canvas conversion failed'));
                }

                // 🗑️ CRITICAL MEMORY CLEANUP
                if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                    canvas.remove();
                    canvas = null;
                }
            }, 'image/png');
        });
    }

    destroy() {
        if (this.pdfDoc) {
            this.pdfDoc.destroy(); // PDF.js cleanup if available
            this.pdfDoc = null;
        }
        this.pdfBytes = null;
    }

    async load(data: Uint8Array) {
        this.pdfBytes = new Uint8Array(data.buffer.slice(0));

        // 🔧 FIX: Determine the correct base path for assets
        // If we are at https://site.com/app/, this returns "https://site.com/app/"
        // If we are at localhost, it returns "http://localhost:port/"
        const baseUrl = window.location.href.replace(/index\.html.*/, '');
        // Remove trailing slash if present to avoid double slashes, though browsers handle it.
        const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

        // Standard PDF.js loading (No custom fonts needed here)
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

    private async appendAuditPage(pdfDoc: PDFDocument, annotations: Annotation[], filename: string) {
        const page = pdfDoc.addPage(PageSizes.A4);
        const {width, height} = page.getSize();

        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // Helper: Check if string is pure ASCII (English/Numbers/Symbols)
        const isAscii = (str: string) => /^[\x00-\x7F]*$/.test(str);

        const drawLabel = (text: string, x: number, y: number, size = 10, bold = false) => {
            page.drawText(text, {x, y, size, font: bold ? fontBold : font, color: rgb(0, 0, 0)});
        };

        // Smart Draw: Vector if possible, Image if necessary
        const drawSmart = async (text: string, x: number, y: number, size = 10) => {
            if (isAscii(text)) {
                drawLabel(text, x, y, size);
            } else {
                // Fallback for Arabic/Chinese/Emoji
                try {
                    const imgBuffer = await this.textToImage(text, size, false);
                    const img = await pdfDoc.embedPng(imgBuffer);
                    const w = img.width / 3;
                    const h = img.height / 3;
                    page.drawImage(img, {x, y: y - (h / 4), width: w, height: h});
                } catch (e) {
                    // Fallback if image generation fails (rare)
                    drawLabel("[Complex Text]", x, y, size);
                }
            }
        };

        let y = height - 50;
        const dateStr = new Date().toLocaleString();

        drawLabel("AUDIT TRAIL / CERTIFICATE OF COMPLETION", 50, y, 16, true);
        y -= 35;

        drawLabel("Document Name:", 50, y, 10, true);
        await drawSmart(filename, 160, y, 10); // ⚡ Optimized
        y -= 20;

        drawLabel("Signed Date:", 50, y, 10, true);
        await drawSmart(dateStr, 160, y, 10); // ⚡ Optimized
        y -= 20;

        drawLabel("Generator:", 50, y, 10, true);
        drawLabel("Open Waqf Signer (Offline/Local)", 160, y, 10);
        y -= 40;

        page.drawLine({start: {x: 50, y}, end: {x: width - 50, y}, thickness: 1, color: rgb(0.8, 0.8, 0.8)});
        y -= 30;

        drawLabel("EVENT LOG", 50, y, 12, true);
        y -= 20;

        const events = [
            `Document Loaded`,
            ...annotations.map((a, i) => {
                const type = a.type.charAt(0).toUpperCase() + a.type.slice(1);
                return `Action ${i + 1}: Added ${type} on Page ${a.page + 1}`;
            }),
            `Finalized & Exported`
        ];

        for (const evt of events) {
            if (y > 50) {
                drawLabel(`• ${evt}`, 50, y, 9);
                y -= 15;
            }
        }

        drawLabel("Disclaimer: This audit trail tracks visual modifications applied locally.", 50, 50, 8);
        drawLabel("It does not represent a PKI digital signature.", 50, 40, 8);
    }

    async saveProfessional(annotations: Annotation[], filename: string, includeAuditTrail: boolean): Promise<Uint8Array> {
        if (!this.pdfBytes) throw new Error('No PDF bytes available');
        const pdfDoc = await PDFDocument.load(this.pdfBytes);

        pdfDoc.setTitle('Signed Document');
        pdfDoc.setProducer('Open Waqf Signer');
        pdfDoc.setModificationDate(new Date());

        const pages = pdfDoc.getPages();

        for (const ann of annotations) {
            if (ann.page < 0 || ann.page >= pages.length) continue;
            const page = pages[ann.page];
            const {width, height} = page.getSize();

            if (ann.type === 'date' && ann.data) {
                // --- STRATEGY: TEXT AS IMAGE ---
                // 1. Generate PNG buffer from browser canvas
                const imgBuffer = await this.textToImage(
                    ann.data,
                    ann.fontSize || 12,
                    ann.fontWeight === 'bold'
                );

                // 2. Embed & Scale
                const pngImage = await pdfDoc.embedPng(imgBuffer);
                const pdfWidth = pngImage.width / 3; // Undo the 3x scale
                const pdfHeight = pngImage.height / 3;

                // 3. Position (Adjust for PDF coordinate system)
                const finalX = width * ann.xPct;
                // Center vertically on the intended line
                const finalY = height - (height * ann.yPct) - (pdfHeight * 0.7);

                // 4. Draw
                page.drawImage(pngImage, {
                    x: finalX,
                    y: finalY,
                    width: pdfWidth,
                    height: pdfHeight,
                });

            } else if ((ann.type === 'signature' || ann.type === 'initials') && ann.data) {
                // --- STANDARD IMAGE STAMP ---
                const pngImage = await pdfDoc.embedPng(ann.data);
                const targetWidth = width * (ann.widthPct || 0.2);
                const imgDims = pngImage.scale(1);
                const aspectRatio = imgDims.height / imgDims.width;
                const targetHeight = targetWidth * aspectRatio;

                page.drawImage(pngImage, {
                    x: width * ann.xPct,
                    y: height - (height * ann.yPct) - targetHeight,
                    width: targetWidth,
                    height: targetHeight,
                });
            }
        }

        if (includeAuditTrail) {
            await this.appendAuditPage(pdfDoc, annotations, filename);
        }

        return await pdfDoc.save();
    }
}

export const pdfEngine = new PdfEngine();