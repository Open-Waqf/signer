import {expect, test} from '@playwright/test';
import {AirGapTransferDecoder, AirGapTransferSender} from '../src/lib/airgap-transfer';

function makeSampleBytes(size: number): Uint8Array {
    const out = new Uint8Array(size);
    for (let i = 0; i < out.length; i++) out[i] = i % 251;
    return out;
}

test('air-gap transfer supports late join decoding', async () => {
    const source = makeSampleBytes(4096);
    const sender = await AirGapTransferSender.create(source, 'late_join.pdf', {
        fragmentMaxLength: 120,
    });
    const decoder = await AirGapTransferDecoder.create();

    const frames: string[] = [];
    for (let i = 0; i < sender.totalShards * 10; i++) {
        frames.push(sender.nextFrame());
    }

    // Simulate joining after stream has been running.
    for (let i = Math.floor(sender.totalShards * 2.5); i < frames.length; i++) {
        decoder.addFrame(frames[i]);
        const progress = await decoder.finalizeIfComplete();
        if (progress.done && progress.data) {
            expect(progress.data).toEqual(source);
            return;
        }
    }

    throw new Error('Decoder did not complete with late join frame stream');
});

test('air-gap decoder survives interrupted frame intake', async () => {
    const source = makeSampleBytes(3072);
    const sender = await AirGapTransferSender.create(source, 'interrupted.pdf', {
        fragmentMaxLength: 96,
    });
    const decoder = await AirGapTransferDecoder.create();

    for (let i = 0; i < sender.totalShards * 2; i++) {
        decoder.addFrame(sender.nextFrame());
    }

    // Simulate camera obstruction: no frames for a while.
    await new Promise((resolve) => setTimeout(resolve, 20));

    for (let i = 0; i < sender.totalShards * 8; i++) {
        decoder.addFrame(sender.nextFrame());
        const result = await decoder.finalizeIfComplete();
        if (result.done && result.data) {
            expect(result.data).toEqual(source);
            return;
        }
    }

    throw new Error('Decoder did not recover from interrupted intake');
});
