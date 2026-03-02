import {expect, test} from '@playwright/test';
import {verifySignatureChain} from '../src/lib/pdf/webauthn-chain-service';
import {SignaturePayload} from '../src/types';

test('webauthn-chain returns invalid for empty signatures', async () => {
    const result = await verifySignatureChain({
        fileData: new Uint8Array([1]),
        signatures: [],
        calculateDeterministicHashIgnoringSubject: async () => 'x',
    });
    expect(result.valid).toBeFalsy();
});

test('webauthn-chain detects previous-link mismatch', async () => {
    const signatures: SignaturePayload[] = [
        {
            signerIndex: 1,
            challengeHash: 'a'.repeat(64),
            openedDocumentHash: 'a'.repeat(64),
            previousHashManuallyVerified: true,
            timestampIso: new Date(0).toISOString(),
            signerAnnotationIds: [],
            validationLog: null,
            refId: 'R1',
            auditPageIncluded: true,
            hardwareFallbackUsed: false,
            isHardwareBacked: false,
            integrityAnchorHash: 'b'.repeat(64),
        },
        {
            signerIndex: 2,
            challengeHash: 'c'.repeat(64),
            openedDocumentHash: 'd'.repeat(64),
            previousHashManuallyVerified: true,
            timestampIso: new Date(0).toISOString(),
            signerAnnotationIds: [],
            validationLog: null,
            refId: 'R2',
            auditPageIncluded: true,
            hardwareFallbackUsed: false,
            isHardwareBacked: false,
        },
    ];

    const result = await verifySignatureChain({
        fileData: new Uint8Array([1, 2]),
        signatures,
        calculateDeterministicHashIgnoringSubject: async () => 'b'.repeat(64),
    });
    expect(result.valid).toBeFalsy();
    expect(result.failedSignerIndex).toBe(2);
});

