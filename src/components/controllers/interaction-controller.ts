import {ReactiveController, ReactiveControllerHost} from 'lit';
import {Annotation} from '../../types';
import {computeDragMove, computeResizeWidthPct} from '../../features/workspace/interaction-controller';

export interface InteractionHost extends ReactiveControllerHost {
    annotations: Annotation[];
    selectedIds: string[];
    container: HTMLElement;
    shadowRoot: ShadowRoot | null;
    snapshot(): void;
    updateAnnotation(id: string, update: Partial<Annotation>): void;
    isDirty: boolean;
    annotationsChanged(next: Annotation[]): void;
}

export class InteractionController implements ReactiveController {
    host: InteractionHost;

    isDragging = false;
    isResizing = false;
    dragOffset = {x: 0, y: 0};
    marqueeBox: { left: number; top: number; width: number; height: number } | null = null;
    guideLines: { axis: 'x' | 'y', pos: number }[] = [];

    private interactionSnapshotTaken = false;

    private isMarqueeSelecting = false;
    private marqueeStart = {x: 0, y: 0};
    private marqueeCurrent = {x: 0, y: 0};
    private marqueeBaseIds: string[] = [];

    constructor(host: InteractionHost) {
        (this.host = host).addController(this);
    }

    hostConnected() {}

    startDragging(e: MouseEvent | TouchEvent, id: string, ann: Annotation) {
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const rect = this.host.container.getBoundingClientRect();

        this.isDragging = true;
        this.host.selectedIds = this.host.selectedIds.includes(id) ? this.host.selectedIds : [id];
        // Offset must be in pixels: computeDragMove subtracts dragOffset from a
        // pixel value (clientX - rect.left) and recomputes it in pixels each move.
        // Storing a fraction here made the first pointermove snap the annotation's
        // corner to the cursor ("teleport").
        this.dragOffset = {
            x: (clientX - rect.left) - ann.xPct * rect.width,
            y: (clientY - rect.top) - ann.yPct * rect.height,
        };
        this.interactionSnapshotTaken = false;

        this.host.requestUpdate();
    }

    startResizing(id: string) {
        this.isResizing = true;
        this.host.selectedIds = [id];
        this.interactionSnapshotTaken = false;

        this.host.requestUpdate();
    }

    handleGlobalMove(e: MouseEvent | TouchEvent) {
        if (this.isMarqueeSelecting && !('touches' in e)) {
            this.handleMarqueeMove(e as MouseEvent);
            return;
        }

        if (this.host.selectedIds.length === 0 || (!this.isDragging && !this.isResizing)) return;
        if (e.cancelable) e.preventDefault();

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const rect = this.host.container.getBoundingClientRect();
        const primaryId = this.host.selectedIds[0];
        const ann = this.host.annotations.find((a) => a.id === primaryId);
        if (!ann) return;

        if (this.isDragging) {
            this.handleDrag(clientX, clientY, rect, ann);
        } else if (this.isResizing) {
            this.handleResize(clientX, rect, ann, primaryId);
        }
    }

    private handleDrag(clientX: number, clientY: number, rect: DOMRect, ann: Annotation) {
        const contentEl = this.host.shadowRoot?.querySelector('.draggable.selected img, .draggable.selected .text-content') as HTMLElement;
        const move = computeDragMove({
            clientX,
            clientY,
            rect,
            ann,
            annotations: this.host.annotations,
            selectedIds: this.host.selectedIds,
            dragOffset: this.dragOffset,
            visualSize: contentEl && contentEl.offsetWidth > 0 && contentEl.offsetHeight > 0
                ? {
                    widthPct: contentEl.offsetWidth / rect.width,
                    heightPct: contentEl.offsetHeight / rect.height,
                }
                : undefined,
        });
        this.guideLines = move.guideLines;

        if (move.changed) {
            this.takeSnapshotIfNeeded();

            this.host.annotationsChanged(move.nextAnnotations);
            this.host.isDirty = true;
            this.dragOffset = move.nextDragOffset;
        }

        this.host.container.toggleAttribute('data-near-top', move.nextYPct < 0.1);
        this.host.container.toggleAttribute('data-near-right', move.nextXPct > 0.85);
        this.host.requestUpdate();
    }

    private handleResize(clientX: number, rect: DOMRect, ann: Annotation, primaryId: string) {
        const resized = computeResizeWidthPct({clientX, rect, ann});
        if (resized.changed) {
            this.takeSnapshotIfNeeded();

            this.host.updateAnnotation(primaryId, {widthPct: resized.widthPct});
        }
    }

    stopInteraction() {
        if (this.isMarqueeSelecting) {
            this.isMarqueeSelecting = false;
            this.marqueeBox = null;
            this.marqueeBaseIds = [];
        }
        this.isDragging = false;
        this.isResizing = false;
        this.interactionSnapshotTaken = false;
        this.guideLines = [];
        this.host.requestUpdate();
    }

    startMarquee(x: number, y: number, isMulti: boolean) {
        this.isMarqueeSelecting = true;
        this.marqueeStart = {x, y};
        this.marqueeCurrent = {x, y};
        this.marqueeBox = {left: x, top: y, width: 0, height: 0};
        this.marqueeBaseIds = isMulti ? [...this.host.selectedIds] : [];
        this.host.requestUpdate();
    }

    private handleMarqueeMove(e: MouseEvent) {
        const rect = this.host.container.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        this.marqueeCurrent = {x, y};
        this.marqueeBox = {
            left: Math.min(this.marqueeStart.x, this.marqueeCurrent.x),
            top: Math.min(this.marqueeStart.y, this.marqueeCurrent.y),
            width: Math.abs(this.marqueeStart.x - this.marqueeCurrent.x),
            height: Math.abs(this.marqueeStart.y - this.marqueeCurrent.y),
        };
        // This logic is still in the host for now to avoid moving the entire selection logic
        (this.host as any).updateMarqueeSelection(this.marqueeBaseIds.length > 0);
        this.host.requestUpdate();
    }

    private takeSnapshotIfNeeded() {
        if (!this.interactionSnapshotTaken) {
            this.host.snapshot();
            this.interactionSnapshotTaken = true;
        }
    }
}
