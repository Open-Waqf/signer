import {expect, test} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
import {AUDIT_MARKER_PREFIX} from '../src/lib/pdf/constants';
import {getHexToRgb, removeTrailingAuditPages} from '../src/lib/pdf/audit-page-service';

test('audit-page-service hex color conversion', async () => {
    const rgb = getHexToRgb()('#336699');
    expect(rgb.red).toBeCloseTo(0.2, 5);
    expect(rgb.green).toBeCloseTo(0.4, 5);
    expect(rgb.blue).toBeCloseTo(0.6, 5);
});

test('audit-page-service removes trailing page when audit marker is present', async () => {
    const sourceDoc = await PDFDocument.create();
    sourceDoc.addPage([300, 300]).drawText('Main content', {x: 20, y: 250});
    sourceDoc.addPage([300, 300]).drawText(`${AUDIT_MARKER_PREFIX}ABC123`, {x: 4, y: 4, size: 1});
    const sourceBytes = await sourceDoc.save();

    const editableDoc = await PDFDocument.load(sourceBytes);
    const removed = await removeTrailingAuditPages(editableDoc, sourceBytes);

    expect(removed).toBeTruthy();
    expect(editableDoc.getPageCount()).toBe(1);
});

test('audit-page-service keeps trailing page when audit marker is missing', async () => {
    const sourceDoc = await PDFDocument.create();
    sourceDoc.addPage([300, 300]).drawText('Main content', {x: 20, y: 250});
    sourceDoc.addPage([300, 300]).drawText('Not an audit page', {x: 20, y: 250});
    const sourceBytes = await sourceDoc.save();

    const editableDoc = await PDFDocument.load(sourceBytes);
    const removed = await removeTrailingAuditPages(editableDoc, sourceBytes);

    expect(removed).toBeFalsy();
    expect(editableDoc.getPageCount()).toBe(2);
});
