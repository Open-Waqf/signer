import * as pdfjsLib from 'pdfjs-dist';
import {PDFDocument} from 'pdf-lib';

// FIX: Vite worker import for PDF.js
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export class PdfEngine {
    private pdfDoc: any = null; // The PDF.js document (for viewing)
    private pdfBytes: Uint8Array | null = null; // The raw bytes (for saving)

    async load(data: Uint8Array) {
        this.pdfBytes = data;
        // Load for viewing
        const loadingTask = pdfjsLib.getDocument({data: this.pdfBytes});
        this.pdfDoc = await loadingTask.promise;
        return this.pdfDoc.numPages;
    }

    // Render a specific page to an HTML Canvas
    async renderPage(pageNumber: number, canvas: HTMLCanvasElement, scale = 1.5) {
        if (!this.pdfDoc) throw new Error('No PDF loaded');

        const page = await this.pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({scale});

        // Set canvas dimensions to match the PDF page
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: canvas.getContext('2d')!,
            viewport: viewport,
        };

        await page.render(renderContext).promise;
        return {width: viewport.width, height: viewport.height, originalWidth: viewport.width / scale};
    }

    // The Magic: Take the signature image and burn it into the PDF
    async saveWithSignature(
        signaturePngBase64: string,
        pageIndex: number,
        xPercent: number, // 0.0 to 1.0 (relative to canvas width)
        yPercent: number, // 0.0 to 1.0 (relative to canvas height)
    ): Promise<Uint8Array> {
        if (!this.pdfBytes) throw new Error('No PDF loaded');

        // 1. Load the document into pdf-lib (The editor)
        const pdfDoc = await PDFDocument.load(this.pdfBytes);
        const pages = pdfDoc.getPages();
        const page = pages[pageIndex];

        // 2. Embed the signature image
        const pngImage = await pdfDoc.embedPng(signaturePngBase64);

        // 3. Calculate coordinates
        // PDF coordinates start at Bottom-Left. Browser is Top-Left.
        const {width, height} = page.getSize();

        // Scale the signature image
        const imgDims = pngImage.scale(0.5); // Default scale
        // You might want to pass exact width/height from the UI later,
        // but for MVP, we scale it based on the document size roughly.
        const finalWidth = width * 0.3; // Signature is 30% of page width
        const finalHeight = (imgDims.height / imgDims.width) * finalWidth;

        const x = width * xPercent;
        // Flip Y axis: (Page Height - Visual Y) - Image Height
        const y = height - (height * yPercent) - finalHeight;

        // 4. Draw it
        page.drawImage(pngImage, {
            x: x,
            y: y,
            width: finalWidth,
            height: finalHeight,
        });

        // 5. Save
        return await pdfDoc.save();
    }
}

export const pdfEngine = new PdfEngine();