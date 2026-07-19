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
    validationMessageKey: 'handoverMismatchMsg' | 'handoverHardwareFailMsg' | 'handoverChainFailMsg' | 'handoverVerifiedMsg';
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

    let verified = true;
    // Track which kind of verification failed so the message is accurate: a
    // signer-chain/integrity failure is not the same as a hardware-assertion
    // failure (a prior signer may not have used hardware at all).
    let failureKind: 'chain' | 'hardware' = 'chain';
    if (input.signaturesChain.length > 0) {
        const chainCheck = await input.deps.verifySignatureChain(input.loadedBytes);
        verified = chainCheck.valid;
        failureKind = 'chain';
    } else if (input.detectedAssertions.length > 0) {
        failureKind = 'hardware';
        for (const a of input.detectedAssertions) {
            if (!a?.publicKey) continue;
            const parsed = JSON.parse(a.assertion);
            const ok = await input.deps.verifyLocalAssertion(
                a.publicKey,
                parsed.signature,
                parsed.authData,
                parsed.clientDataJSON
            );
            if (!ok) verified = false;
        }
    }

    if (!verified) {
        return {
            handoverResult: 'fail',
            isVerified: false,
            previousHashManuallyVerified: false,
            validationMessageKey: failureKind === 'hardware' ? 'handoverHardwareFailMsg' : 'handoverChainFailMsg',
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
