import * as pdfjsLib from 'pdfjs-dist';
import {PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export class PdfEngine {
    private pdfDoc: any = null; // View (PDF.js)
    private pdfBytes: Uint8Array | null = null; // Save (Raw Data)

    async load(data: Uint8Array) {
        // 1. CLONE THE DATA (Fixes the "No Header" crash)
        // We create a deep copy so PDF.js can't "steal" (transfer) the buffer
        this.pdfBytes = new Uint8Array(data.buffer.slice(0));

        // 2. Load the View (using a copy or the original, doesn't matter now)
        const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(data)});
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
     * Professional Saving Routine
     * Adds Signature + Metadata + "Verified" Stamp
     */
    async saveProfessional(
        signatureData: { base64: string, xPct: number, yPct: number, page: number } | null,
        dateData: { dateString: string, xPct: number, yPct: number, page: number } | null
    ): Promise<Uint8Array> {

        if (!this.pdfBytes) throw new Error('No PDF bytes available');

        // Load the document
        const pdfDoc = await PDFDocument.load(this.pdfBytes);

        // 1. Set Metadata (Professional Touch)
        pdfDoc.setTitle('Signed Document');
        pdfDoc.setAuthor('Open Waqf Signer');
        pdfDoc.setProducer('Open Waqf (Privacy First)');
        pdfDoc.setModificationDate(new Date());

        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // 2. Burn Signature (Image)
        if (signatureData) {
            const page = pages[signatureData.page];
            const {width, height} = page.getSize();

            const pngImage = await pdfDoc.embedPng(signatureData.base64);
            const pngDims = pngImage.scale(0.5);

            // Calculate realistic size (max 25% of page width)
            const finalW = width * 0.25;
            const finalH = (pngDims.height / pngDims.width) * finalW;

            page.drawImage(pngImage, {
                x: width * signatureData.xPct,
                y: height - (height * signatureData.yPct) - finalH, // Flip Y
                width: finalW,
                height: finalH,
            });
        }

        // 3. Burn Professional "Stamp" (Text)
        if (dateData) {
            const page = pages[dateData.page];
            const {width, height} = page.getSize();

            const stampText = `Digitally Signed: ${dateData.dateString}`;
            const hashId = `ID: ${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

            const fontSize = 10;
            const textW = font.widthOfTextAtSize(stampText, fontSize);
            const boxW = textW + 20;
            const boxH = 35;

            const x = width * dateData.xPct;
            const y = height - (height * dateData.yPct) - boxH;

            // Draw "Badge" Background
            page.drawRectangle({
                x: x, y: y, width: boxW, height: boxH,
                color: rgb(0.95, 0.95, 0.95), // Light Gray
                borderColor: rgb(0.5, 0.5, 0.5),
                borderWidth: 1,
            });

            // Draw "Verified" Text
            page.drawText(stampText, {
                x: x + 10, y: y + 20,
                size: fontSize, font: fontBold, color: rgb(0, 0, 0),
            });

            // Draw ID Text
            page.drawText(hashId, {
                x: x + 10, y: y + 8,
                size: 8, font: font, color: rgb(0.4, 0.4, 0.4),
            });
        }

        return await pdfDoc.save();
    }
}

export const pdfEngine = new PdfEngine();