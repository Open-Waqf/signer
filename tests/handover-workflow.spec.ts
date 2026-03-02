import {expect, test} from '@playwright/test';
import {runHandoverCheck} from '../src/features/workspace/handover-workflow';
import {SignaturePayload} from '../src/types';

const bytes = new Uint8Array([1, 2, 3]);
const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function baseDeps(overrides?: Partial<Parameters<typeof runHandoverCheck>[0]['deps']>) {
    return {
        getFileHash: async () => hash,
        getSixDigitCode: () => '123456',
        verifySignatureChain: async () => ({valid: true}),
        verifyLocalAssertion: async () => true,
        ...overrides,
    };
}

test('handover-workflow mismatch returns fail result', async () => {
    const result = await runHandoverCheck({
        handoverInput: '999999',
        loadedBytes: bytes,
        signaturesChain: [] as SignaturePayload[],
        detectedAssertions: [],
        detectedRefId: 'REF1',
        deps: baseDeps(),
    });

    expect(result.handoverResult).toBe('fail');
    expect(result.validationMessageKey).toBe('handoverMismatchMsg');
    expect(result.shouldAutoClose).toBeFalsy();
});

test('handover-workflow valid hash with valid chain succeeds', async () => {
    const result = await runHandoverCheck({
        handoverInput: hash,
        loadedBytes: bytes,
        signaturesChain: [{signerIndex: 1} as SignaturePayload],
        detectedAssertions: [],
        detectedRefId: 'REF2',
        deps: baseDeps(),
    });

    expect(result.handoverResult).toBe('success');
    expect(result.validationMessageKey).toBe('handoverVerifiedMsg');
    expect(result.shouldAutoClose).toBeTruthy();
});

test('handover-workflow valid code but invalid hardware proof fails', async () => {
    const result = await runHandoverCheck({
        handoverInput: '123456',
        loadedBytes: bytes,
        signaturesChain: [] as SignaturePayload[],
        detectedAssertions: [{
            publicKey: 'pk',
            assertion: JSON.stringify({
                signature: 'sig',
                authData: 'auth',
                clientDataJSON: 'client',
            }),
        }],
        detectedRefId: 'REF3',
        deps: baseDeps({
            verifyLocalAssertion: async () => false,
        }),
    });

    expect(result.handoverResult).toBe('fail');
    expect(result.validationMessageKey).toBe('handoverHardwareFailMsg');
    expect(result.shouldAutoClose).toBeFalsy();
});

