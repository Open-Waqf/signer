import {expect, test} from '@playwright/test';
import {verifySignatureChain} from '../src/lib/pdf/signature-chain-service';
import {SignaturePayload} from '../src/types';

test('signature-chain returns invalid for empty signatures', async () => {
    const result = await verifySignatureChain({
        fileData: new Uint8Array([1]),
        signatures: [],
        calculateDeterministicHashIgnoringSubject: async () => 'x',
    });
    expect(result.valid).toBeFalsy();
});

test('signature-chain detects previous-link mismatch', async () => {
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


test('signature-chain: an older file with a hardware assertion still shows a consistent history', async () => {
    // From the removed hardware-signing feature: the assertion stays in the file but is not
    // checked any more (that check never worked reliably and proved nothing about the file).
    const signatures: SignaturePayload[] = [{
        signerIndex: 1,
        challengeHash: 'a'.repeat(64),
        openedDocumentHash: 'a'.repeat(64),
        previousHashManuallyVerified: true,
        timestampIso: new Date(0).toISOString(),
        signerAnnotationIds: [],
        validationLog: null,
        refId: 'R1',
        auditPageIncluded: false,
        hardwareFallbackUsed: false,
        isHardwareBacked: true,
        webauthnData: {publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE', assertion: JSON.stringify({signature: 'AA', authData: 'AA', clientDataJSON: 'AA'})},
        integrityAnchorHash: 'b'.repeat(64),
    }];
    const result = await verifySignatureChain({
        fileData: new Uint8Array([1, 2]),
        signatures,
        calculateDeterministicHashIgnoringSubject: async () => 'b'.repeat(64),
    });
    expect(result.valid).toBe(true);
});
