// tests/utils.ts
import {PDFDocument, rgb, StandardFonts} from 'pdf-lib';

/**
 * Generates a clean, valid PDF with text for testing.
 * We do this here to keep the main test file clean.
 */
export async function generateTestPDF(): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    page.drawText('Open Waqf Contract: v1.0', {
        x: 50, y: 350, size: 24, font: font, color: rgb(0, 0, 0),
    });

    page.drawText('Signed by Automated Test Robot', {
        x: 50, y: 320, size: 12, font: font, color: rgb(0.5, 0.5, 0.5),
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}