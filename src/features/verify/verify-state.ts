import type {VerifyOutcome} from './verify-controller';

export type VerifyResult = {
    status: 'success' | 'fail' | 'pending_file' | null;
    id?: string;
};

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
