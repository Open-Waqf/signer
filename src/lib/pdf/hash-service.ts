import {PDFDocument} from 'pdf-lib';

export async function generateHashID(text: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').substring(0, 12).toUpperCase();
}

export async function calculateSHA256(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export function getSixDigitCode(hash: string): string {
    const normalized = hash.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    const seed = Number.parseInt(normalized.slice(0, 12) || '0', 16);
    return String(seed % 1000000).padStart(6, '0');
}

export async function calculateDeterministicHashIgnoringSubject(fileData: Uint8Array): Promise<string> {
    const pdfDoc = await PDFDocument.load(fileData, {updateMetadata: false});
    pdfDoc.setSubject('');
    pdfDoc.setCreationDate(new Date(0));
    pdfDoc.setModificationDate(new Date(0));
    const normalized = await pdfDoc.save();
    return calculateSHA256(normalized);
}

