import {pdfEngine} from '../../lib/pdf-engine';
import {extractHex64, strictOrNormalizedHash} from '../../domain/hash';

export type VerifyOutcome = {
    verifyFileHash: string;
    verifyResult: { status: 'success' | 'fail' | null, id?: string };
    chainStatus: { status: 'idle' | 'success' | 'fail', failedSignerIndex?: number, total?: number };
    expectedVerifyId: string | null;
};

export class VerifyController {
    async verifyFile(file: File, expectedVerifyId: string | null): Promise<VerifyOutcome> {
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        const meta = await pdfEngine.readMetadataID(new Uint8Array(buffer));
        const fileId = meta.id;
        const verifyFileHash = await pdfEngine.getFileHash(data);
        const chainCheck = await pdfEngine.verifySignatureChain(data);

        let status: 'success' | 'fail' | null = null;
        let nextExpected: string | null = expectedVerifyId;
        if (expectedVerifyId) {
            status = (fileId && fileId.toLowerCase() === expectedVerifyId.toLowerCase()) ? 'success' : 'fail';
            nextExpected = null;
        } else {
            status = fileId ? 'success' : 'fail';
        }

        const chainStatus = chainCheck.valid
            ? {status: 'success' as const, total: chainCheck.signatures.length}
            : {
                status: chainCheck.signatures.length > 0 ? 'fail' as const : 'idle' as const,
                failedSignerIndex: chainCheck.failedSignerIndex,
                total: chainCheck.signatures.length,
            };

        return {
            verifyFileHash,
            verifyResult: {status, id: fileId || undefined},
            chainStatus,
            expectedVerifyId: nextExpected,
        };
    }

    checkHash(input: string, actualHash: string): 'idle' | 'success' | 'fail' {
        const normalizedInput = strictOrNormalizedHash(input);
        if (!normalizedInput) return 'idle';
        return normalizedInput === actualHash.toLowerCase() ? 'success' : 'fail';
    }

    normalizedHashInput(input: string): string {
        const strict = extractHex64(input);
        if (strict) return strict;
        return strictOrNormalizedHash(input);
    }
}

