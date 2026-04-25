import {PageSizes, PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import QRCode from 'qrcode';
import {SignaturePayload} from '../../types';
import {AppConfig} from '../../config';
import {AUDIT_MARKER_PREFIX} from './constants';

function pageContainsAuditMarker(pageText: string): boolean {
    return pageText.includes(AUDIT_MARKER_PREFIX);
}

export async function removeTrailingAuditPages(pdfDoc: PDFDocument, sourceBytes: Uint8Array): Promise<boolean> {
    if (pdfDoc.getPageCount() <= 1) return false;
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

export async function textToImage(
    text: string,
    fontSize: number = 12,
    isBold: boolean = false,
    fontFamily: string = 'Amiri',
    color: string = '#000000',
    direction: CanvasDirection = 'inherit'
): Promise<Uint8Array> {
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
    ctx.direction = direction;
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

    const primaryColor = rgb(0.05, 0.2, 0.45); // Official Navy Blue
    const secondaryColor = rgb(0.3, 0.3, 0.3);

    const drawLabel = async (text: string, x: number, y: number, size = 10, bold = false, color = rgb(0, 0, 0)) => {
        const hasNonAscii = /[^\x00-\x7F]/.test(text);
        if (!hasNonAscii) {
            page.drawText(text, {x, y, size, font: bold ? fontBold : font, color});
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

    // Draw borders
    const m = 24;
    page.drawRectangle({
        x: m, y: m, width: width - m * 2, height: height - m * 2,
        borderWidth: 2, borderColor: primaryColor
    });
    page.drawRectangle({
        x: m + 3, y: m + 3, width: width - (m + 3) * 2, height: height - (m + 3) * 2,
        borderWidth: 0.5, borderColor: primaryColor
    });

    // Header Background
    page.drawRectangle({
        x: m + 3, y: height - 110, width: width - (m + 3) * 2, height: 110 - (m + 3),
        color: rgb(0.96, 0.98, 1.0)
    });

    await drawLabel(`${AUDIT_MARKER_PREFIX}${docId}`, 4, 4, 1, false);

    let y = height - 60;
    const dateStr = new Date().toLocaleString();
    const verifyUrl = `${AppConfig.website}/?id=${docId}`;

    await drawLabel('OPEN WAQF DIGITAL AUDIT TRAIL', 50, y, 18, true, primaryColor);

    const qrBytes = await generateQRCode(verifyUrl);
    if (qrBytes.length > 0) {
        const qrImg = await pdfDoc.embedPng(qrBytes);
        const qrSize = 70;
        const qrY = height - 95;
        page.drawImage(qrImg, {x: width - qrSize - 40, y: qrY, width: qrSize, height: qrSize});
        await drawLabel(`Ref: ${docId}`, width - qrSize - 40, qrY - 12, 7, false, secondaryColor);
    }

    y -= 60; // Push below header
    
    // Document Info section
    page.drawRectangle({
        x: 50, y: y - 48, width: width - 100, height: 60,
        color: rgb(0.98, 0.98, 0.98), borderWidth: 0.5, borderColor: rgb(0.8, 0.8, 0.8)
    });
    
    y -= 15;
    await drawLabel('Document:', 60, y, 10, true, primaryColor);
    await drawLabel(filename, 150, y, 10, false, secondaryColor);
    y -= 16;
    await drawLabel('Date Generated:', 60, y, 10, true, primaryColor);
    await drawLabel(dateStr, 150, y, 10, false, secondaryColor);
    y -= 16;
    await drawLabel('Validator Engine:', 60, y, 10, true, primaryColor);
    await drawLabel('Open Waqf Signer (Local/Offline Verifier)', 150, y, 10, false, secondaryColor);

    y -= 40;
    await drawLabel('CRYPTOGRAPHIC SIGNATURE LOG', 50, y, 14, true, primaryColor);
    page.drawLine({start: {x: 50, y: y - 6}, end: {x: width - 50, y: y - 6}, thickness: 1, color: primaryColor});
    y -= 30;

    if (validationLog) {
        await drawLabel(`SECURITY ALERT: ${validationLog}`, 50, y, 9, true, rgb(0.8, 0.1, 0.1));
        y -= 20;
    }

    for (const sig of signatures) {
        const boxHeight = 75 + (sig.signerIndex > 1 ? 25 : 0) + (sig.hardwareFallbackUsed ? 15 : 0);
        if (y - boxHeight < 50) break; // Need enough space for the box
        
        y -= boxHeight;
        
        page.drawRectangle({
            x: 50, y: y, width: width - 100, height: boxHeight,
            borderWidth: 0.5, borderColor: rgb(0.8, 0.8, 0.8),
            color: rgb(0.99, 0.99, 1.0)
        });

        // Header for signer
        page.drawRectangle({
            x: 50, y: y + boxHeight - 20, width: width - 100, height: 20,
            color: rgb(0.94, 0.96, 0.98)
        });
        
        let textY = y + boxHeight - 14;
        await drawLabel(`SIGNATURE INDEX: ${sig.signerIndex}`, 60, textY, 10, true, primaryColor);
        
        textY -= 18;
        if (sig.signerIndex > 1) {
            await drawLabel(`State Hash (Prior to Sign): ${sig.openedDocumentHash.slice(0, 32)}...`, 60, textY, 8, false, secondaryColor);
            textY -= 12;
            await drawLabel(`Prior Chain Verified: `, 60, textY, 8, true, secondaryColor);
            await drawLabel(sig.previousHashManuallyVerified ? 'YES' : 'NO (WARNING)', 160, textY, 8, true, sig.previousHashManuallyVerified ? rgb(0.1, 0.6, 0.2) : rgb(0.8, 0.1, 0.1));
            textY -= 14;
        }

        await drawLabel(`Hardware Proof:`, 60, textY, 8, true, secondaryColor);
        await drawLabel(sig.isHardwareBacked ? 'EMBEDDED (WebAuthn Cryptography)' : 'VISUAL ONLY', 160, textY, 8, true, sig.isHardwareBacked ? rgb(0.1, 0.6, 0.2) : secondaryColor);
        textY -= 12;
        
        await drawLabel(`Timestamp:`, 60, textY, 8, true, secondaryColor);
        await drawLabel(sig.tsaVerified ? 'RFC 3161 Cryptographic (Verified)' : 'Local Device Clock (Unverified)', 160, textY, 8, false, secondaryColor);
        textY -= 12;
        
        await drawLabel(`Time Value:`, 60, textY, 8, true, secondaryColor);
        await drawLabel(sig.timestampIso || 'N/A', 160, textY, 8, false, secondaryColor);

        if (sig.hardwareFallbackUsed) {
            textY -= 14;
            await drawLabel('WARNING: Hardware proof was requested but could not be embedded.', 60, textY, 8, true, rgb(0.8, 0.4, 0));
        }

        y -= 10; // Margin between boxes
    }

    await drawLabel('Valid only if the cryptographic chain and document hash remain intact.', 50, 35, 8, false, secondaryColor);
}
