import {PDFDocument, PDFName} from 'pdf-lib';

self.onmessage = async (event: MessageEvent) => {
    const {id, type, data} = event.data;

    try {
        if (type === 'CALCULATE_SHA256') {
            const hash = await calculateSHA256(data);
            self.postMessage({id, hash});
        } else if (type === 'CALCULATE_DETERMINISTIC_HASH') {
            const hash = await calculateDeterministicHashIgnoringSubject(data);
            self.postMessage({id, hash});
        }
    } catch (error: any) {
        self.postMessage({id, error: error?.message || 'Unknown worker error'});
    }
};

async function calculateSHA256(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

async function calculateDeterministicHashIgnoringSubject(fileData: Uint8Array): Promise<string> {
    const pdfDoc = await PDFDocument.load(fileData, {updateMetadata: false});
    pdfDoc.setSubject('');
    pdfDoc.setCreationDate(new Date(0));
    pdfDoc.setModificationDate(new Date(0));
    // The signer chain payload is mirrored into a redundant /OpenWaqfChain info-dict
    // key by setSignaturesSubject(). It must be excluded from the deterministic hash
    // exactly like Subject — otherwise the integrity anchor computed over the
    // provisional payload (before finalization) never matches the finalized payload
    // stored in the saved file, breaking chain verification and the handover flow.
    try {
        const infoDict = (pdfDoc as any).getInfoDict();
        infoDict.delete(PDFName.of('OpenWaqfChain'));
    } catch {
        // No info dict present (or key already absent) — nothing to strip.
    }
    const normalized = await pdfDoc.save();
    return calculateSHA256(normalized);
}
