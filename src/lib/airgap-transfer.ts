import {gzipSync, gunzipSync} from 'fflate';

type CompressionMode = 'gzip';

export type AirGapBuildOptions = {
    fragmentMaxLength?: number;
};

const DEFAULT_FRAGMENT_MAX_LENGTH = 220;

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

export class AirGapTransferSender {
    readonly sessionId: string;
    readonly totalShards: number;
    readonly compression: CompressionMode = 'gzip';
    readonly compressedSize: number;
    readonly originalSize: number;
    readonly fileName: string;

    private readonly encoder: any;

    private constructor(input: {
        sessionId: string;
        encoder: any;
        compressedSize: number;
        originalSize: number;
        fileName: string;
    }) {
        this.sessionId = input.sessionId;
        this.encoder = input.encoder;
        this.compressedSize = input.compressedSize;
        this.originalSize = input.originalSize;
        this.fileName = input.fileName;
        this.totalShards = this.encoder.fragmentsLength;
    }

    static async create(pdfBytes: Uint8Array, fileName: string, options?: AirGapBuildOptions): Promise<AirGapTransferSender> {
        await ensureNodeLikeGlobals();
        const {UR, UREncoder} = await import('@ngraveio/bc-ur');
        const source = Uint8Array.from(pdfBytes);
        const compressed = gzipSync(source);
        const ur = UR.from(compressed as any);
        const encoder = new UREncoder(
            ur,
            Math.max(120, options?.fragmentMaxLength ?? DEFAULT_FRAGMENT_MAX_LENGTH),
            0
        );

        return new AirGapTransferSender({
            sessionId: crypto.randomUUID(),
            encoder,
            compressedSize: compressed.length,
            originalSize: source.length,
            fileName: fileName || 'Transferred_Document.pdf',
        });
    }

    nextFrame(): string {
        return this.encoder.nextPart();
    }
}

export type DecoderProgress = {
    progress: number;
    received: number;
    total: number;
    done: boolean;
    fileName?: string;
    data?: Uint8Array;
};

export class AirGapTransferDecoder {
    private constructor(private readonly decoder: any) {
    }

    static async create(): Promise<AirGapTransferDecoder> {
        await ensureNodeLikeGlobals();
        const {URDecoder} = await import('@ngraveio/bc-ur');
        return new AirGapTransferDecoder(new URDecoder());
    }

    addFrame(raw: string): DecoderProgress {
        const normalized = (raw || '').trim();
        if (!normalized.toLowerCase().startsWith('ur:')) return this.progress();

        try {
            this.decoder.receivePart(normalized);
        } catch (_error) {
            // Ignore malformed frames and continue collecting.
        }
        return this.progress();
    }

    async finalizeIfComplete(): Promise<DecoderProgress> {
        const progress = this.progress();
        if (!progress.done) return progress;
        if (!this.decoder.isSuccess()) {
            throw new Error(this.decoder.resultError() || 'UR decoding failed');
        }

        const ur = this.decoder.resultUR();
        const compressedBuffer = ur.decodeCBOR();
        const compressed = new Uint8Array(compressedBuffer);
        const decompressed = gunzipSync(compressed);

        return {
            ...progress,
            fileName: 'Transferred_Document.pdf',
            data: decompressed,
        };
    }

    private progress(): DecoderProgress {
        const total = this.decoder.expectedPartCount();
        const received = this.decoder.receivedPartIndexes().length;
        return {
            progress: total > 0 ? Math.min(1, received / total) : this.decoder.getProgress(),
            received,
            total,
            done: this.decoder.isComplete(),
        };
    }
}
