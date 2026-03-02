import {expect, test} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
import {readMetadataID, setSignaturesSubject} from '../src/lib/pdf/metadata-service';
import {SignaturePayload} from '../src/types';

test('metadata-service roundtrips signature subject data', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setKeywords(['ref:ABC123']);

    const signatures: SignaturePayload[] = [{
        signerIndex: 1,
        challengeHash: 'a'.repeat(64),
        openedDocumentHash: 'b'.repeat(64),
        previousHashManuallyVerified: true,
        timestampIso: new Date(0).toISOString(),
        signerAnnotationIds: ['x1'],
        validationLog: null,
        refId: 'ABC123',
        auditPageIncluded: true,
        hardwareFallbackUsed: false,
        isHardwareBacked: false,
    }];
    setSignaturesSubject(doc, signatures);
    const bytes = new Uint8Array(await doc.save());

    const meta = await readMetadataID(bytes);
    expect(meta.id).toBe('ABC123');
    expect(meta.signatures).toHaveLength(1);
    expect(meta.signatures[0].openedDocumentHash).toBe('b'.repeat(64));
});

