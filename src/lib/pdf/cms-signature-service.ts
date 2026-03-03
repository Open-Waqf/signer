import type {CertificateSigningConfig} from '../../types';

type ForgeLike = {
    util: {
        createBuffer: (input: string, encoding?: string) => any;
    };
    asn1: {
        fromDer: (buffer: any) => any;
    };
    pkcs12: {
        pkcs12FromAsn1: (asn1: any, strict: boolean, password: string) => any;
    };
    pki: {
        oids: Record<string, string>;
    };
};

function wipeBytes(bytes: Uint8Array | null | undefined) {
    if (bytes && bytes.length > 0) bytes.fill(0);
}

function bytesToBinary(bytes: Uint8Array): string {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, i + chunk);
        out += String.fromCharCode(...slice);
    }
    return out;
}

async function ensureNodeLikeGlobals() {
    const g = globalThis as any;
    if (!g.global) g.global = g;
    if (!g.process) g.process = {env: {}, browser: true};
    if (!g.process.env) g.process.env = {};
    if (!g.Buffer) {
        const {Buffer} = await import('buffer');
        g.Buffer = Buffer;
    }
}

async function getForge(): Promise<ForgeLike> {
    const mod = await import('node-forge');
    return (mod as any).default ?? (mod as any);
}

function extractCertName(p12: any, forge: ForgeLike): string | null {
    try {
        const certBags = p12.getBags({bagType: forge.pki.oids.certBag})?.[forge.pki.oids.certBag];
        const cert = certBags?.[0]?.cert;
        const attrs = cert?.subject?.attributes || [];
        const cn = attrs.find((a: any) => a?.name === 'commonName' || a?.shortName === 'CN')?.value;
        return cn || null;
    } catch {
        return null;
    }
}

export async function validatePkcs12Certificate(input: {
    p12Bytes: Uint8Array;
    password: string;
}): Promise<{certName: string | null}> {
    await ensureNodeLikeGlobals();
    const forge = await getForge();
    let binary = '';
    try {
        binary = bytesToBinary(input.p12Bytes);
        const der = forge.util.createBuffer(binary, 'raw');
        const asn1 = forge.asn1.fromDer(der);
        const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, input.password);
        return {certName: extractCertName(p12, forge)};
    } finally {
        binary = '';
    }
}

export async function signPdfWithCertificate(
    pdfBytes: Uint8Array,
    cert: CertificateSigningConfig
): Promise<Uint8Array> {
    await ensureNodeLikeGlobals();
    const [{PDFDocument}, {pdflibAddPlaceholder}, {default: signerEngine}, {P12Signer}] = await Promise.all([
        import('pdf-lib'),
        import('@signpdf/placeholder-pdf-lib'),
        import('@signpdf/signpdf'),
        import('@signpdf/signer-p12'),
    ]);

    const p12Copy = new Uint8Array(cert.p12Bytes);
    let passphrase = cert.password;
    try {
        const doc = await PDFDocument.load(pdfBytes, {updateMetadata: false});
        pdflibAddPlaceholder({
            pdfDoc: doc,
            reason: 'Document approval',
            contactInfo: 'offline',
            name: cert.signerName || 'Open Waqf User',
            location: 'On-device',
            signatureLength: 16000,
        });

        const withPlaceholder = await doc.save({useObjectStreams: false});
        const signer = new P12Signer(p12Copy, {passphrase});
        const signedBuffer = await signerEngine.sign(withPlaceholder, signer, new Date());
        return new Uint8Array(signedBuffer);
    } finally {
        p12Copy.fill(0);
        passphrase = '';
    }
}

export function wipeCertificateConfig(cert: CertificateSigningConfig | null | undefined) {
    if (!cert) return;
    wipeBytes(cert.p12Bytes);
    cert.password = '';
    cert.signerName = '';
}
