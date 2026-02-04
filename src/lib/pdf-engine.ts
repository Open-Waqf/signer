import * as pdfjsLib from 'pdfjs-dist';
import {PageSizes, PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';
import {Annotation} from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export class PdfEngine {
    private pdfDoc: any = null;
    private pdfBytes: Uint8Array | null = null;

    /**
     * 🎨 TEXT-TO-IMAGE ENGINE
     * Uses the browser's native text rendering to create a high-quality PNG.
     * This solves 100% of Arabic/RTL issues without extra libraries.
     */
    private async textToImage(text: string, fontSize: number = 12, isBold: boolean = false): Promise<Uint8Array> {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context not available');

        // 1. High Resolution Scale (3x) for crisp printing
        const scale = 3;
        const fontSizePx = fontSize * scale;
        // Use system fonts that support Arabic naturally
        const font = `${isBold ? 'bold' : 'normal'} ${fontSizePx}px "Amiri", "Segoe UI", "Helvetica", "Arial", sans-serif`;

        ctx.font = font;

        // 2. Measure Text
        const metrics = ctx.measureText(text);
        const width = Math.ceil(metrics.width);
        // Add generous height padding to prevent clipping of accents
        const height = Math.ceil(fontSizePx * 1.5);

        // 3. Resize Canvas
        canvas.width = width;
        canvas.height = height;

        // 4. Draw Text
        ctx.font = font; // Re-apply after resize
        ctx.fillStyle = 'black';
        ctx.textBaseline = 'middle';
        // Force LTR context but allow browser to handle RTL inside it
        ctx.direction = 'inherit';
        ctx.fillText(text, 0, height / 2);

        // 5. Convert to PNG Buffer
        return new Promise((resolve, reject) => {
            canvas.toBlob(async (blob) => {
                if (blob) {
                    const buffer = await blob.arrayBuffer();
                    resolve(new Uint8Array(buffer));
                } else {
                    reject(new Error('Canvas conversion failed'));
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

    /**
     * Draws the Audit Page
     * Uses StandardFonts for static English labels to keep file size small.
     * Uses textToImage for dynamic fields (Filename/Dates) so Arabic doesn't break.
     */
    private async appendAuditPage(pdfDoc: PDFDocument, annotations: Annotation[], filename: string) {
        const page = pdfDoc.addPage(PageSizes.A4);
        const {width, height} = page.getSize();

        // Standard Font for labels
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // Helper to draw standard Latin text
        const drawLabel = (text: string, x: number, y: number, size = 10, bold = false) => {
            page.drawText(text, {x, y, size, font: bold ? fontBold : font, color: rgb(0, 0, 0)});
        };

        // Helper to draw Dynamic (possibly Arabic) text as Image
        const drawDynamic = async (text: string, x: number, y: number, size = 10) => {
            const imgBuffer = await this.textToImage(text, size, false);
            const img = await pdfDoc.embedPng(imgBuffer);
            const w = img.width / 3; // Scale back down
            const h = img.height / 3;
            // Center the image vertically relative to text line
            page.drawImage(img, {x, y: y - (h / 4), width: w, height: h});
        };

        let y = height - 50;
        const dateStr = new Date().toLocaleString();

        drawLabel("AUDIT TRAIL / CERTIFICATE OF COMPLETION", 50, y, 16, true);
        y -= 35;

        drawLabel("Document Name:", 50, y, 10, true);
        await drawDynamic(filename, 160, y, 10); // Handle Arabic Filename
        y -= 20;

        drawLabel("Signed Date:", 50, y, 10, true);
        await drawDynamic(dateStr, 160, y, 10); // Handle Localized Date
        y -= 20;

        drawLabel("Generator:", 50, y, 10, true);
        drawLabel("Open Waqf Signer (Offline/Local)", 160, y, 10);
        y -= 40;

        // Divider
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