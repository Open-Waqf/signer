import type {VerifyOutcome} from './verify-controller';

export type VerifyResult = {
    status: 'success' | 'fail' | 'pending_file' | null;
    id?: string;
    /** Checked against the reference of a verify link (?id=...). */
    fromLink?: boolean;
};

export type VerifyAnswer = {
    kind: 'intact' | 'changed' | 'unconfirmed';
    reason: 'hashMatch' | 'hashMismatch' | 'otherFile' | 'recordOnly' | 'noRecord';
};

/**
 * One plain answer for the person checking a file (step 6). Only the fingerprint the
 * sender gave can prove the file is unchanged: the record and the signer history inside
 * the file can be written by anyone, so on their own they never say "Intact".
 */
export function verifyAnswer(result: VerifyResult, integrity: 'idle' | 'success' | 'fail'): VerifyAnswer {
    if (integrity === 'fail') return {kind: 'changed', reason: 'hashMismatch'};
    if (result.fromLink && result.status === 'fail') return {kind: 'changed', reason: 'otherFile'};
    if (integrity === 'success') return {kind: 'intact', reason: 'hashMatch'};
    return {kind: 'unconfirmed', reason: result.status === 'success' ? 'recordOnly' : 'noRecord'};
}

export type VerifyChainStatus = {
    status: 'idle' | 'success' | 'fail';
    failedSignerIndex?: number;
    total?: number;
};

export const initialVerifyResult = (): VerifyResult => ({status: null});

export const initialChainStatus = (): VerifyChainStatus => ({status: 'idle'});

export const pendingVerifyResult = (id: string): VerifyResult => ({status: 'pending_file', id});

export const verifyOutcomeState = (outcome: VerifyOutcome) => ({
    verifyFileHash: outcome.verifyFileHash,
    verifyResult: outcome.verifyResult,
    expectedVerifyId: outcome.expectedVerifyId,
    verifyHashInput: '',
    integrityStatus: 'idle' as const,
    chainStatus: outcome.chainStatus,
    hasStandardSignature: outcome.hasStandardSignature,
    showVerifyModal: true,
});
