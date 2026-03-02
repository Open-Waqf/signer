import {expect, test} from '@playwright/test';
import {Annotation} from '../src/types';
import {applyToAllPages, deleteAnnotationById, updateAnnotationById} from '../src/features/workspace/annotation-store';
import {redoHistory, takeSnapshot, undoHistory} from '../src/features/workspace/history-store';

function ann(id: string, page: number, data = 'x'): Annotation {
    return {
        id,
        type: 'stamp',
        page,
        xPct: 0.2,
        yPct: 0.2,
        widthPct: 0.25,
        data,
        aspectRatio: 1,
        lockedByChain: false,
    };
}

test('history-store undo/redo roundtrip', async () => {
    const a1 = ann('a1', 0);
    const a2 = ann('a2', 0);
    const initial = [a1];
    const withSnap = takeSnapshot({history: [], future: []}, initial);
    const undoRes = undoHistory(withSnap, [a2]);
    expect(undoRes.changed).toBeTruthy();
    expect(undoRes.annotations[0].id).toBe('a1');

    const redoRes = redoHistory(undoRes.state, undoRes.annotations);
    expect(redoRes.changed).toBeTruthy();
    expect(redoRes.annotations[0].id).toBe('a2');
});

test('annotation-store applyToAllPages avoids duplicates', async () => {
    const base = ann('a1', 0, 'same');
    const existingOnPage2 = {...ann('a2', 1, 'same'), xPct: base.xPct, yPct: base.yPct, type: base.type};
    const result = applyToAllPages({
        annotations: [base, existingOnPage2],
        id: 'a1',
        totalPages: 3,
        generateId: () => 'new-id',
    });
    expect(result.addedCount).toBe(1);
    expect(result.annotations.some((a) => a.page === 2 && a.id === 'new-id')).toBeTruthy();
});

test('annotation-store delete and update by id', async () => {
    const input = [ann('a1', 0), ann('a2', 1)];
    const updated = updateAnnotationById(input, 'a2', {xPct: 0.8});
    expect(updated.find((a) => a.id === 'a2')?.xPct).toBe(0.8);
    const removed = deleteAnnotationById(updated, 'a1');
    expect(removed.map((a) => a.id)).toEqual(['a2']);
});

