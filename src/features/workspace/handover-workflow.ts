import {extractHex64} from '../../domain/hash';
import {extractPin6} from '../../domain/handover';
import {SignaturePayload} from '../../types';

export type LegacyAssertion = {
    publicKey?: string;
    assertion: string;
};

export type HandoverDeps = {
    getFileHash: (bytes: Uint8Array) => Promise<string>;
    getSixDigitCode: (hash: string) => string;
    verifySignatureChain: (bytes: Uint8Array) => Promise<{ valid: boolean }>;
    verifyLocalAssertion: (
        publicKey: string,
        signature: string,
        authData: string,
        clientDataJSON: string
    ) => Promise<boolean>;
};

export type HandoverResult = {
    handoverResult: 'idle' | 'success' | 'fail';
    isVerified: boolean;
    previousHashManuallyVerified: boolean;
    validationMessageKey: 'handoverMismatchMsg' | 'handoverHardwareFailMsg' | 'handoverVerifiedMsg';
    appendHardwareVerifiedSuffix: boolean;
    shouldAutoClose: boolean;
};

export async function runHandoverCheck(input: {
    handoverInput: string;
    loadedBytes: Uint8Array;
    signaturesChain: SignaturePayload[];
    detectedAssertions: LegacyAssertion[];
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
            appendHardwareVerifiedSuffix: false,
            shouldAutoClose: false,
        };
    }

    let hwVerified = true;
    if (input.signaturesChain.length > 0) {
        const chainCheck = await input.deps.verifySignatureChain(input.loadedBytes);
        hwVerified = chainCheck.valid;
    } else if (input.detectedAssertions.length > 0) {
        for (const a of input.detectedAssertions) {
            if (!a?.publicKey) continue;
            const parsed = JSON.parse(a.assertion);
            const ok = await input.deps.verifyLocalAssertion(
                a.publicKey,
                parsed.signature,
                parsed.authData,
                parsed.clientDataJSON
            );
            if (!ok) hwVerified = false;
        }
    }

    if (!hwVerified) {
        return {
            handoverResult: 'fail',
            isVerified: false,
            previousHashManuallyVerified: false,
            validationMessageKey: 'handoverHardwareFailMsg',
            appendHardwareVerifiedSuffix: false,
            shouldAutoClose: false,
        };
    }

    return {
        handoverResult: 'success',
        isVerified: true,
        previousHashManuallyVerified: true,
        validationMessageKey: 'handoverVerifiedMsg',
        appendHardwareVerifiedSuffix: input.detectedAssertions.length > 0,
        shouldAutoClose: true,
    };
}
