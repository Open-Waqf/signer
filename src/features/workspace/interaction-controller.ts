import {Annotation} from '../../types';

export type GuideLine = { axis: 'x' | 'y'; pos: number };

export function computeDragMove(input: {
    clientX: number;
    clientY: number;
    rect: DOMRect;
    ann: Annotation;
    annotations: Annotation[];
    selectedIds: string[];
    dragOffset: { x: number; y: number };
    visualSize?: { widthPct: number; heightPct: number };
}): {
    changed: boolean;
    nextAnnotations: Annotation[];
    nextDragOffset: { x: number; y: number };
    guideLines: GuideLine[];
    nextXPct: number;
    nextYPct: number;
} {
    let visualWidthPct = input.ann.widthPct || 0.1;
    let visualHeightPct = visualWidthPct * (input.ann.aspectRatio || 1);
    if (input.visualSize) {
        visualWidthPct = input.visualSize.widthPct;
        visualHeightPct = input.visualSize.heightPct;
    }

    const newX = input.clientX - input.rect.left - input.dragOffset.x;
    const newY = input.clientY - input.rect.top - input.dragOffset.y;
    const maxXPct = Math.max(0, 1 - visualWidthPct);
    const maxYPct = Math.max(0, 1 - visualHeightPct);
    let nextXPct = Math.max(0, Math.min(maxXPct, newX / input.rect.width));
    let nextYPct = Math.max(0, Math.min(maxYPct, newY / input.rect.height));

    const centerX = nextXPct + visualWidthPct / 2;
    const centerY = nextYPct + visualHeightPct / 2;
    const SNAP_THRESHOLD = 0.007;
    const guideLines: GuideLine[] = [];

    if (Math.abs(centerX - 0.5) < SNAP_THRESHOLD) {
        guideLines.push({axis: 'x', pos: 0.5});
    }
    if (Math.abs(centerY - 0.5) < SNAP_THRESHOLD) {
        guideLines.push({axis: 'y', pos: 0.5});
    }

    const otherAnns = input.annotations.filter((a) => a.page === input.ann.page && a.id !== input.ann.id);
    for (const other of otherAnns) {
        const otherWidthPct = other.widthPct || 0.1;
        const otherHeightPct = otherWidthPct * (other.aspectRatio || 1);
        const otherCenterX = other.xPct + otherWidthPct / 2;
        const otherCenterY = other.yPct + otherHeightPct / 2;

        if (Math.abs(centerX - otherCenterX) < SNAP_THRESHOLD) {
            guideLines.push({axis: 'x', pos: otherCenterX});
        }

        if (Math.abs(centerY - otherCenterY) < SNAP_THRESHOLD) {
            guideLines.push({axis: 'y', pos: otherCenterY});
        }
    }

    if (Math.abs(nextXPct - input.ann.xPct) <= 0.0005 && Math.abs(nextYPct - input.ann.yPct) <= 0.0005) {
        return {
            changed: false,
            nextAnnotations: input.annotations,
            nextDragOffset: input.dragOffset,
            guideLines,
            nextXPct,
            nextYPct,
        };
    }

    const dx = nextXPct - input.ann.xPct;
    const dy = nextYPct - input.ann.yPct;
    const nextAnnotations = input.annotations.map((a) => {
        if (input.selectedIds.includes(a.id)) {
            return {...a, xPct: a.xPct + dx, yPct: a.yPct + dy};
        }
        return a;
    });

    return {
        changed: true,
        nextAnnotations,
        nextDragOffset: {
            x: input.clientX - input.rect.left - nextXPct * input.rect.width,
            y: input.clientY - input.rect.top - nextYPct * input.rect.height,
        },
        guideLines,
        nextXPct,
        nextYPct,
    };
}

export function computeResizeWidthPct(input: {
    clientX: number;
    rect: DOMRect;
    ann: Annotation;
}): { changed: boolean; widthPct: number } {
    const mouseRelX = input.clientX - input.rect.left;
    const newWidthPx = Math.max(mouseRelX - input.ann.xPct * input.rect.width, input.rect.width * 0.05);
    const nextWidthPct = Math.min(0.8, newWidthPx / input.rect.width);
    return {
        changed: Math.abs(nextWidthPct - (input.ann.widthPct || 0)) > 0.0005,
        widthPct: nextWidthPct,
    };
}
