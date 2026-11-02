import {SignaturePayload} from '../../types';

// Consistency of the signer history in the file. Information, not proof: anyone can
// write such a history (see the Verify screen).
export async function verifySignatureChain(input: {
    fileData: Uint8Array;
    signatures: SignaturePayload[];
    calculateDeterministicHashIgnoringSubject: (bytes: Uint8Array) => Promise<string>;
    hasStandardSignature?: boolean;
}): Promise<{ valid: boolean, failedSignerIndex?: number, signatures: SignaturePayload[] }> {
    const {signatures, hasStandardSignature} = input;
    if (signatures.length === 0) return {valid: false, signatures: []};
    const latest = signatures[signatures.length - 1];
    if (latest.integrityAnchorHash && !hasStandardSignature) {
        const currentAnchor = await input.calculateDeterministicHashIgnoringSubject(input.fileData);
        if (currentAnchor !== latest.integrityAnchorHash) {
            return {valid: false, failedSignerIndex: latest.signerIndex, signatures};
        }
    }

    for (let i = signatures.length - 1; i >= 0; i--) {
        const payload = signatures[i];
        if (!payload.openedDocumentHash || !payload.challengeHash) {
            return {valid: false, failedSignerIndex: payload.signerIndex, signatures};
        }

        if (i > 0) {
            const previous = signatures[i - 1];
            const expectedPreviousHash = previous.integrityAnchorHash || previous.challengeHash;
            if (!expectedPreviousHash || payload.openedDocumentHash !== expectedPreviousHash) {
                return {valid: false, failedSignerIndex: payload.signerIndex, signatures};
            }
        }

        // Older files may carry a WebAuthn assertion from the removed "hardware signing"
        // feature. It is kept in the file but not checked: its check never worked reliably
        // (DER vs raw signatures) and proved nothing about the file anyway.
    }

    return {valid: true, signatures};
}
