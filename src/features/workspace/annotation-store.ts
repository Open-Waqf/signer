import {Annotation, AnnotationType} from '../../types';

export function isAnnotationLocked(annotations: Annotation[], id: string): boolean {
    return !!annotations.find((a) => a.id === id)?.lockedByChain;
}

export function createCenteredAnnotation(input: {
    type: AnnotationType;
    data: string;
    aspectRatio?: number;
    widthPct?: number;
    currentPage: number;
    pageRect: DOMRect;
    viewportRect: DOMRect;
    generateId: () => string;
    /** Items already placed: a new one never lands exactly on top of one of them. */
    existing?: Annotation[];
}): Annotation {
    const aspectRatio = input.aspectRatio ?? 1;
    const screenCenterX = input.viewportRect.left + input.viewportRect.width / 2;
    const screenCenterY = input.viewportRect.top + input.viewportRect.height / 2;
    const relativeX = screenCenterX - input.pageRect.left;
    const relativeY = screenCenterY - input.pageRect.top;
    const xPct = Math.max(0.1, Math.min(0.8, relativeX / input.pageRect.width));
    let yPct = Math.max(0.1, Math.min(0.8, relativeY / input.pageRect.height));
    // Same spot as an item on this page (e.g. a date added right after a signature):
    // move the new one down a step, so both stay visible and easy to grab.
    const page = input.currentPage - 1;
    const taken = (y: number) => (input.existing ?? []).some((a) =>
        a.page === page && Math.abs(a.xPct - xPct) < 0.05 && Math.abs(a.yPct - y) < 0.05);
    for (let step = 0; step < 8 && taken(yPct); step++) {
        yPct = yPct + 0.07 > 0.9 ? 0.1 + step * 0.01 : yPct + 0.07;
    }
    const widthPct = input.widthPct ?? (input.type === 'initials' ? 0.15 : 0.25);

    return {
        id: input.generateId(),
        type: input.type,
        page: input.currentPage - 1,
        xPct,
        yPct,
        widthPct,
        data: input.data,
        aspectRatio,
        lockedByChain: false,
    };
}

export function deleteAnnotationById(annotations: Annotation[], id: string): Annotation[] {
    return annotations.filter((a) => a.id !== id);
}

export function updateAnnotationById(annotations: Annotation[], id: string, updates: Partial<Annotation>): Annotation[] {
    return annotations.map((a) => (a.id === id ? {...a, ...updates} : a));
}

export function applyAnnotationStyle(annotations: Annotation[], id: string, style: Partial<Annotation>): Annotation[] {
    return annotations.map((a) => (a.id === id ? {...a, ...style} : a));
}

export function applyToAllPages(input: {
    annotations: Annotation[];
    id: string;
    totalPages: number;
    generateId: () => string;
}): { annotations: Annotation[]; addedCount: number } {
    const sourceAnn = input.annotations.find((a) => a.id === input.id);
    if (!sourceAnn) return {annotations: input.annotations, addedCount: 0};

    const newAnnotations: Annotation[] = [];
    for (let p = 0; p < input.totalPages; p++) {
        if (p === sourceAnn.page) continue;
        const exists = input.annotations.some((a) =>
            a.page === p &&
            a.type === sourceAnn.type &&
            Math.abs(a.xPct - sourceAnn.xPct) < 0.01 &&
            Math.abs(a.yPct - sourceAnn.yPct) < 0.01 &&
            a.data === sourceAnn.data
        );
        if (!exists) {
            newAnnotations.push({...sourceAnn, id: input.generateId(), page: p});
        }
    }

    if (newAnnotations.length === 0) return {annotations: input.annotations, addedCount: 0};
    return {
        annotations: [...input.annotations, ...newAnnotations],
        addedCount: newAnnotations.length,
    };
}
