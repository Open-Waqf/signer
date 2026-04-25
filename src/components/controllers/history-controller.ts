import {ReactiveController, ReactiveControllerHost} from 'lit';
import {Annotation} from '../../types';
import {redoHistory, takeSnapshot, undoHistory} from '../../features/workspace/history-store';
import {HapticService} from '../../lib/haptic-service';

export class HistoryController implements ReactiveController {
    host: ReactiveControllerHost;
    
    private history: Annotation[][] = [];
    private future: Annotation[][] = [];

    constructor(host: ReactiveControllerHost) {
        (this.host = host).addController(this);
    }

    hostConnected() {}

    get canUndo() {
        return this.history.length > 0;
    }

    get canRedo() {
        return this.future.length > 0;
    }

    snapshot(annotations: Annotation[]) {
        const next = takeSnapshot({history: this.history, future: this.future}, annotations);
        this.history = next.history;
        this.future = next.future;
        this.host.requestUpdate();
    }

    undo(currentAnnotations: Annotation[]): Annotation[] {
        const result = undoHistory({history: this.history, future: this.future}, currentAnnotations);
        if (!result.changed) return currentAnnotations;

        HapticService.impact();
        this.history = result.state.history;
        this.future = result.state.future;
        this.host.requestUpdate();
        return result.annotations;
    }

    redo(currentAnnotations: Annotation[]): Annotation[] {
        const result = redoHistory({history: this.history, future: this.future}, currentAnnotations);
        if (!result.changed) return currentAnnotations;

        HapticService.impact();
        this.history = result.state.history;
        this.future = result.state.future;
        this.host.requestUpdate();
        return result.annotations;
    }

    reset() {
        this.history = [];
        this.future = [];
        this.host.requestUpdate();
    }
}
