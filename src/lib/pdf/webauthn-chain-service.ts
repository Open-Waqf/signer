import {SignaturePayload} from '../../types';
import {WebAuthnService} from '../webauthn-service';

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

        if (payload.webauthnData?.publicKey && payload.webauthnData?.assertion) {
            try {
                const parsed = JSON.parse(payload.webauthnData.assertion);
                const challengeBytes = new Uint8Array(payload.challengeHash.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []);
                const ok = await WebAuthnService.verifyLocal(
                    payload.webauthnData.publicKey,
                    parsed.signature,
                    parsed.authData,
                    parsed.clientDataJSON,
                    challengeBytes
                );
                if (!ok) {
                    return {valid: false, failedSignerIndex: payload.signerIndex, signatures};
                }
            } catch {
                return {valid: false, failedSignerIndex: payload.signerIndex, signatures};
            }
        } else if (payload.isHardwareBacked) {
            return {valid: false, failedSignerIndex: payload.signerIndex, signatures};
        }
    }

    return {valid: true, signatures};
}
