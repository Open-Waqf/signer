import {Annotation} from '../../types';

export type HistoryState = {
    history: Annotation[][];
    future: Annotation[][];
};

function cloneAnnotations(input: Annotation[]): Annotation[] {
    return JSON.parse(JSON.stringify(input));
}

export function takeSnapshot(state: HistoryState, annotations: Annotation[]): HistoryState {
    return {
        history: [...state.history, cloneAnnotations(annotations)],
        future: [],
    };
}

export function undoHistory(state: HistoryState, annotations: Annotation[]): {
    state: HistoryState;
    annotations: Annotation[];
    changed: boolean;
} {
    if (state.history.length === 0) {
        return {state, annotations, changed: false};
    }

    const nextHistory = [...state.history];
    const restored = nextHistory.pop()!;
    return {
        state: {
            history: nextHistory,
            future: [cloneAnnotations(annotations), ...state.future],
        },
        annotations: restored,
        changed: true,
    };
}

export function redoHistory(state: HistoryState, annotations: Annotation[]): {
    state: HistoryState;
    annotations: Annotation[];
    changed: boolean;
} {
    if (state.future.length === 0) {
        return {state, annotations, changed: false};
    }

    const [restored, ...nextFuture] = state.future;
    return {
        state: {
            history: [...state.history, cloneAnnotations(annotations)],
            future: nextFuture,
        },
        annotations: restored,
        changed: true,
    };
}

