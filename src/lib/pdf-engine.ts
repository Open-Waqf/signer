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

            if (ann.type === 'date' && ann.data) {// --- BURN DATE STAMP ---

                // 1. Get User Styles (or defaults)
                const textSize = ann.fontSize || 12;
                const textFont = ann.fontWeight === 'bold' ? fontBold : font;

                // 2. Measure Text
                const textH = textSize; // Approx height

                // 3. Calculate Position
                const finalX = width * ann.xPct;
                const finalY = height - (height * ann.yPct) - textH;

                // 4. Draw Text
                page.drawText(ann.data, {
                    x: finalX,
                    y: finalY,
                    size: textSize,
                    font: textFont,
                    color: rgb(0, 0, 0),
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