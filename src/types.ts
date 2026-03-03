export type AnnotationType = 'signature' | 'initials' | 'date' | 'stamp' | 'identity' | 'biometric';

export interface Annotation {
    id: string;            // Unique ID to track items
    type: AnnotationType;
    page: number;          // Which page is this on? (0-index)
    xPct: number;          // 0.0 to 1.0 (Percentage of page width)
    yPct: number;          // 0.0 to 1.0 (Percentage of page height)
    widthPct: number;      // Width relative to page width
    data?: string;         // Base64 image or Text string
    aspectRatio?: number;  // height/width ratio (for images)
    fontSize?: number; // e.g. 12, 18, 24
    fontWeight?: 'normal' | 'bold';
    fontFamily?: string;
    color?: string; // hex color e.g. #000000
    
    // WebAuthn / Hardware Proofs
    publicKey?: string;    // SPKI Public Key (Base64)
    assertion?: string;    // JSON stringified WebAuthn response (sig, authData, clientData)
    lockedByChain?: boolean;
}

export interface SignaturePayload {
    signerIndex: number;
    challengeHash: string;
    openedDocumentHash: string;
    integrityAnchorHash?: string;
    previousHashManuallyVerified: boolean;
    timestampIso: string;
    tsaVerified?: boolean;
    tsaProvider?: string;
    tsaTokenBase64?: string;
    tsaFailureReason?: string;
    signerAnnotationIds: string[];
    validationLog?: string | null;
    refId?: string;
    auditPageIncluded?: boolean;
    hardwareFallbackUsed?: boolean;
    isHardwareBacked?: boolean;
    webauthnData?: {
        publicKey: string;
        assertion: string;
    };
}

export interface CertificateSigningConfig {
    p12Bytes: Uint8Array;
    password: string;
    signerName?: string;
}
