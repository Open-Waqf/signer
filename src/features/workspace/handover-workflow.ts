import {extractHex64} from '../../domain/hash';
import {extractPin6} from '../../domain/handover';
import {SignaturePayload} from '../../types';

export type HandoverDeps = {
    getFileHash: (bytes: Uint8Array) => Promise<string>;
    getSixDigitCode: (hash: string) => string;
    verifySignatureChain: (bytes: Uint8Array) => Promise<{ valid: boolean }>;
};

export type HandoverResult = {
    handoverResult: 'idle' | 'success' | 'fail';
    isVerified: boolean;
    previousHashManuallyVerified: boolean;
    validationMessageKey: 'handoverMismatchMsg' | 'handoverChainFailMsg' | 'handoverVerifiedMsg';
    shouldAutoClose: boolean;
};

export async function runHandoverCheck(input: {
    handoverInput: string;
    loadedBytes: Uint8Array;
    signaturesChain: SignaturePayload[];
    detectedRefId: string;
    deps: HandoverDeps;
}): Promise<HandoverResult> {
    const inputPin = extractPin6(input.handoverInput);
    const fullHashInput = extractHex64(input.handoverInput);
    const actual = await input.deps.getFileHash(input.loadedBytes);
    const expectedCode = input.deps.getSixDigitCode(actual);

    if (inputPin !== expectedCode && fullHashInput !== actual.toLowerCase()) {
        return {
            handoverResult: 'fail',
            isVerified: false,
            previousHashManuallyVerified: false,
            validationMessageKey: 'handoverMismatchMsg',
            shouldAutoClose: false,
        };
    }

    // The signer history must also be consistent (information, not proof).
    let verified = true;
    if (input.signaturesChain.length > 0) {
        const chainCheck = await input.deps.verifySignatureChain(input.loadedBytes);
        verified = chainCheck.valid;
    }

    if (!verified) {
        return {
            handoverResult: 'fail',
            isVerified: false,
            previousHashManuallyVerified: false,
            validationMessageKey: 'handoverChainFailMsg',
            shouldAutoClose: false,
        };
    }

    return {
        handoverResult: 'success',
        isVerified: true,
        previousHashManuallyVerified: true,
        validationMessageKey: 'handoverVerifiedMsg',
        shouldAutoClose: true,
    };
}
