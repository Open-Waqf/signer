import * as pdfjsLib from 'pdfjs-dist';
import {PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';
import {Annotation} from '../types'; // Import the new type

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export class PdfEngine {
    private pdfDoc: any = null;
    private pdfBytes: Uint8Array | null = null;

    async load(data: Uint8Array) {
        this.pdfBytes = new Uint8Array(data.buffer.slice(0));
        const loadingTask = pdfjsLib.getDocument({
            data: new Uint8Array(data),
            cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/', // FIX: Better Text Support (Feedback #3)
            cMapPacked: true,
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

        const renderContext = {
            canvasContext: canvas.getContext('2d')!,
            viewport: viewport,
        };

        await page.render(renderContext).promise;
    }

    /**
     * Save Routine - Now handles an Array of Annotations
     */
    async saveProfessional(annotations: Annotation[]): Promise<Uint8Array> {
        if (!this.pdfBytes) throw new Error('No PDF bytes available');

        const pdfDoc = await PDFDocument.load(this.pdfBytes);

        // Metadata Update
        pdfDoc.setTitle('Signed Document');
        pdfDoc.setProducer('Open Waqf Signer (Secure & Offline)');
        pdfDoc.setModificationDate(new Date());

        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // Loop through ALL annotations
        for (const ann of annotations) {
            // Safety check for page range
            if (ann.page < 0 || ann.page >= pages.length) continue;

            const page = pages[ann.page];
            const {width, height} = page.getSize();

            // Calculate coordinates from Percentages
            // PDF Coordinates: Y starts at bottom.
            // We flip Y: (height - (yPct * height)) - objectHeight

            if (ann.type === 'date' && ann.data) {
                // --- BURN DATE STAMP ---
                const stampText = `Visually Signed: ${ann.data}`; // FIX: Wording
                const hashId = `ID: ${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

                const fontSize = 10;
                const textW = font.widthOfTextAtSize(stampText, fontSize);
                const boxW = textW + 20;
                const boxH = 35;

                // Use the percentage width if provided, otherwise default
                const finalX = width * ann.xPct;
                const finalY = height - (height * ann.yPct) - boxH;

                page.drawRectangle({
                    x: finalX, y: finalY, width: boxW, height: boxH,
                    color: rgb(0.95, 0.95, 0.95),
                    borderColor: rgb(0.5, 0.5, 0.5),
                    borderWidth: 1,
                });

                page.drawText(stampText, {
                    x: finalX + 10, y: finalY + 20,
                    size: fontSize, font: fontBold, color: rgb(0, 0, 0),
                });

                page.drawText(hashId, {
                    x: finalX + 10, y: finalY + 8,
                    size: 8, font: font, color: rgb(0.4, 0.4, 0.4),
                });

            } else if ((ann.type === 'signature' || ann.type === 'initials') && ann.data) {
                // --- BURN IMAGE ---
                const pngImage = await pdfDoc.embedPng(ann.data);

                // Use stored width percentage. Default to 20% if missing.
                const targetWidth = width * (ann.widthPct || 0.2);

                // Calculate height based on image aspect ratio to prevent stretching
                const imgDims = pngImage.scale(1);
                const aspectRatio = imgDims.height / imgDims.width;
                const targetHeight = targetWidth * aspectRatio;

                const finalX = width * ann.xPct;
                const finalY = height - (height * ann.yPct) - targetHeight;

                page.drawImage(pngImage, {
                    x: finalX,
                    y: finalY,
                    width: targetWidth,
                    height: targetHeight,
                });
            }
        }

        return await pdfDoc.save();
    }
}

export const pdfEngine = new PdfEngine();