import {PageSizes, PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import QRCode from 'qrcode';
import {SignaturePayload} from '../../types';
import {AppConfig} from '../../config';
import {AUDIT_MARKER_PREFIX} from './constants';

function pageContainsAuditMarker(pageText: string): boolean {
    return pageText.includes(AUDIT_MARKER_PREFIX);
}

export async function removeTrailingAuditPages(pdfDoc: PDFDocument, sourceBytes: Uint8Array): Promise<boolean> {
    if (pdfDoc.getPageCount() <= 1) return false;
    const pdfjsLib = typeof window === 'undefined'
        ? await import('pdfjs-dist/legacy/build/pdf.mjs')
        : await import('pdfjs-dist');
    const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(sourceBytes)});
    const srcDoc = await loadingTask.promise;
    const lastPage = await srcDoc.getPage(srcDoc.numPages);
    const textContent = await lastPage.getTextContent();
    const text = (textContent.items || []).map((i: any) => i.str || '').join(' ');
    const hasMarker = pageContainsAuditMarker(text);
    srcDoc.destroy();
    if (hasMarker && pdfDoc.getPageCount() > 1) {
        pdfDoc.removePage(pdfDoc.getPageCount() - 1);
        return true;
    }
    return false;
}

function hexToRgb(hex: string) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return rgb(r, g, b);
}

export function getHexToRgb() {
    return hexToRgb;
}

export async function textToImage(text: string, fontSize: number = 12, isBold: boolean = false, fontFamily: string = 'Amiri', color: string = '#000000'): Promise<Uint8Array> {
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

async function generateQRCode(text: string): Promise<Uint8Array> {
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

export async function appendAuditPage(
    pdfDoc: PDFDocument,
    signatures: SignaturePayload[],
    filename: string,
    docId: string,
    validationLog: string | null
) {
    const page = pdfDoc.addPage(PageSizes.A4);
    const {width, height} = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const drawLabel = async (text: string, x: number, y: number, size = 10, bold = false) => {
        const hasNonAscii = /[^\x00-\x7F]/.test(text);
        if (!hasNonAscii) {
            page.drawText(text, {x, y, size, font: bold ? fontBold : font, color: rgb(0, 0, 0)});
            return;
        }

        const textImage = await textToImage(text, size, bold, 'Amiri', '#000000');
        const pngImage = await pdfDoc.embedPng(textImage);
        const imageScale = 1 / 3;
        const drawWidth = pngImage.width * imageScale;
        const drawHeight = pngImage.height * imageScale;
        // Convert top-ish text baseline into image bottom-left anchor for pdf-lib.
        page.drawImage(pngImage, {
            x,
            y: y - (drawHeight - size * 0.8),
            width: drawWidth,
            height: drawHeight,
        });
    };

    await drawLabel(`${AUDIT_MARKER_PREFIX}${docId}`, 4, 4, 1, false);

    let y = height - 50;
    const dateStr = new Date().toLocaleString();
    const verifyUrl = `${AppConfig.website}/?id=${docId}`;

    await drawLabel('OPEN WAQF AUDIT TRAIL', 50, y, 16, true);

    const qrBytes = await generateQRCode(verifyUrl);
    if (qrBytes.length > 0) {
        const qrImg = await pdfDoc.embedPng(qrBytes);
        const qrSize = 80;
        const qrY = y - qrSize + 10;
        page.drawImage(qrImg, {x: width - qrSize - 50, y: qrY, width: qrSize, height: qrSize});
        await drawLabel(`Ref: ${docId}`, width - qrSize - 50, qrY - 15, 8);
    }

    y -= 40;
    await drawLabel('Document:', 50, y, 10, true);
    await drawLabel(filename, 140, y, 10);
    y -= 20;
    await drawLabel('Date:', 50, y, 10, true);
    await drawLabel(dateStr, 140, y, 10);
    y -= 20;
    await drawLabel('Validator:', 50, y, 10, true);
    await drawLabel('Open Waqf Signer (Local/Offline)', 140, y, 10);

    y -= 40;
    page.drawLine({start: {x: 50, y}, end: {x: width - 50, y}, thickness: 1, color: rgb(0.8, 0.8, 0.8)});
    y -= 26;
    await drawLabel('SIGNATURE CHAIN LOG', 50, y, 12, true);
    y -= 20;

    if (validationLog) {
        await drawLabel(`SECURITY NOTE: ${validationLog}`, 50, y, 9);
        y -= 18;
    }

    for (const sig of signatures) {
        if (y < 95) break;
        await drawLabel(`Signer ${sig.signerIndex}`, 50, y, 10, true);
        y -= 14;
        if (sig.signerIndex > 1) {
            await drawLabel(`Opened Hash: ${sig.openedDocumentHash.slice(0, 16)}...`, 55, y, 8);
            y -= 11;
        }
        await drawLabel(`Hardware Proof Embedded: ${sig.isHardwareBacked ? 'YES (Cryptographic Proof)' : 'NO (Visual Only)'}`, 55, y, 8);
        y -= 11;
        if (sig.tsaVerified) {
            await drawLabel('Timestamp: RFC 3161 Cryptographic (Verified by FreeTSA)', 55, y, 8);
        } else {
            await drawLabel('Timestamp: Local Device Clock (Offline - Unverified)', 55, y, 8);
        }
        y -= 11;
        await drawLabel(`Timestamp Value: ${sig.timestampIso || 'N/A'}`, 55, y, 8);
        y -= 11;
        if (sig.signerIndex > 1) {
            await drawLabel(`Verified Previous: ${sig.previousHashManuallyVerified ? 'YES' : 'NO'}`, 55, y, 8);
            y -= 14;
        } else {
            y -= 3;
        }
        if (sig.hardwareFallbackUsed) {
            await drawLabel('WARNING: Hardware requested but proof could not be embedded. Saved as visual-only.', 55, y, 8);
            y -= 14;
        }

        if (!sig.previousHashManuallyVerified && sig.signerIndex > 1) {
            await drawLabel(`WARNING: Signer ${sig.signerIndex} signed without manually verifying Signer ${sig.signerIndex - 1}. Prior-chain trust was not confirmed manually.`, 55, y, 8);
            y -= 14;
        }
    }

    await drawLabel('Valid only if cryptographic chain remains intact.', 50, 40, 8);
}
