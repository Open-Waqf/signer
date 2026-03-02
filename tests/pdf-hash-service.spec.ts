import {expect, test} from '@playwright/test';
import {calculateSHA256, generateHashID, getSixDigitCode} from '../src/lib/pdf/hash-service';

test('hash-service produces deterministic SHA-256 and id', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash1 = await calculateSHA256(bytes);
    const hash2 = await calculateSHA256(bytes);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);

    const id1 = await generateHashID('abc');
    const id2 = await generateHashID('abc');
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(12);
});

test('hash-service six digit code is stable', async () => {
    const code = getSixDigitCode('a'.repeat(64));
    expect(code).toMatch(/^\d{6}$/);
    expect(getSixDigitCode('a'.repeat(64))).toBe(code);
});

