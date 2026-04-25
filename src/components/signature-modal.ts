import {css, html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {i18n} from '../lib/i18n-service';
import {sharedStyles} from '../styles/shared-styles';
import {TranslationKey} from '../i18n/locales';
import {HapticService} from '../lib/haptic-service';
import type {DrawnSignaturePayload} from '../types';
import {
    clearLastUsed,
    loadLastUsed,
    loadPresets as loadPresetsFromDb,
    persistLastUsed,
    persistPresets as persistPresetsToDb
} from '../lib/preset-store';
import './owq-modal';

const INK_COLORS: Array<{ value: string; labelKey: TranslationKey }> = [
    {value: '#1a1a2e', labelKey: 'inkDark'},
    {value: '#1447e6', labelKey: 'inkBlue'},
    {value: '#c0392b', labelKey: 'inkRed'},
    {value: '#1e8449', labelKey: 'inkGreen'},
];

const MAX_PRESETS = 5;
const MIN_STROKE_DISTANCE = 6;

interface SignaturePreset {
    id: string;
    name: string;
    dataURL: string;
}

@customElement('signature-modal')
export class SignatureModal extends LitElement {
    @query('canvas') canvas!: HTMLCanvasElement;
    @property() mode: 'signature' | 'initials' = 'signature';
    @state() private inkColor = localStorage.getItem('signer_ink_color') ?? '#1a1a2e';
    @state() private presets: SignaturePreset[] = [];
    @state() private showSaveNameRow = false;
    @state() private saveNameValue = '';

    private isDrawing = false;
    private ctx: CanvasRenderingContext2D | null = null;
    private points: { x: number, y: number }[] = [];
    private hasCommittedStroke = false;
    private _resizeHandler: (() => void) | null = null;
    private _pointerDownHandler: ((e: PointerEvent) => void) | null = null;
    private _pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
    private _pointerUpHandler: ((e: PointerEvent) => void) | null = null;
    private _pointerCancelHandler: ((e: PointerEvent) => void) | null = null;
    private activePointerId: number | null = null;
    private _keyDownHandler: ((e: KeyboardEvent) => void) | null = null;

    @state() private originalData: string | null = null;
    @state() private isDirty = false;

        static styles = [sharedStyles, css`
        canvas {
            border: 2px dashed var(--border, #e5e7eb);
            border-radius: 8px;
            touch-action: none;
            background: color-mix(in srgb, var(--bg-surface, #ffffff), #000 2%);
            width: 100%;
            height: auto;
            min-height: 180px;
            aspect-ratio: 2 / 1;
            display: block;
            cursor: crosshair;
            margin-bottom: 20px;
        }

        @media (max-width: 480px) {
            canvas {
                min-height: 140px;
            }
        }

        .actions {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
            justify-content: stretch;
        }

        .color-strip {
            display: flex;
            gap: 12px;
            align-items: center;
            margin-bottom: 14px;
        }

        .color-swatch {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 3px solid transparent;
            cursor: pointer;
            padding: 0;
            flex-shrink: 0;
            transition: transform 0.15s, border-color 0.15s;
        }

        .color-swatch:hover {
            transform: scale(1.1);
        }

        .color-swatch.selected {
            border-color: var(--text-sub-strong, #4b5563);
            box-shadow: 0 0 0 2px var(--bg-surface, #fff), 0 0 0 4px var(--text-sub-strong, #4b5563);
        }

        .presets-section {
            margin-bottom: 14px;
        }

        .presets-label {
            font-size: 0.75rem;
            color: var(--text-sub, #6b7280);
            margin-bottom: 8px;
            text-align: start;
        }

        .presets-strip {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .preset-item {
            position: relative;
            cursor: pointer;
            border: 2px solid var(--border, #e5e7eb);
            border-radius: 6px;
            background: var(--bg-surface, #fff);
            padding: 0;
            width: 80px;
            height: 48px;
            overflow: visible;
            transition: border-color 0.15s;
        }

        .preset-item:hover {
            border-color: var(--primary, #1447e6);
            z-index: 10;
        }

        .preset-item img {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }

        .preset-delete {
            position: absolute;
            top: -6px;
            right: -6px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: rgba(220, 38, 38, 0.9);
            color: var(--bg-surface, #fff);
            border: none;
            cursor: pointer;
            font-size: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            line-height: 1;
            opacity: 0;
            transition: opacity 0.15s;
        }

        .preset-item:hover .preset-delete, .preset-item:active .preset-delete, .preset-delete:focus {
            opacity: 1;
        }

        .preset-name {
            font-size: 0.6rem;
            color: var(--text-sub, #6b7280);
            text-align: center;
            position: absolute;
            bottom: 0;
            inset-inline: 0;
            background: color-mix(in srgb, var(--bg-surface, #fff), transparent 20%);
            padding: 1px 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .no-presets {
            font-size: 0.75rem;
            color: var(--workspace-thumb-index, #9ca3af);
            text-align: start;
            font-style: italic;
        }

        .save-preset-row {
            display: flex;
            justify-content: flex-start;
            margin-bottom: 14px;
        }

        .save-name-row {
            display: flex;
            gap: 8px;
            align-items: stretch;
            flex-wrap: wrap;
            margin-bottom: 14px;
        }

        .save-name-row .input-field {
            flex: 1 1 100%;
            margin: 0;
        }

        .save-name-row .btn {
            flex: 1 1 calc(50% - 4px);
        }

        .save-preset-row .btn {
            width: 100%;
        }

        .actions .btn {
            width: 100%;
        }

        @media (max-width: 480px) {
            .actions {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .actions .btn-primary {
                grid-column: 1 / -1;
            }
        }

    `];

    async firstUpdated() {
        await new Promise(requestAnimationFrame);
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        this._resizeHandler = () => {
            this.resizeCanvas();
        };
        window.addEventListener('resize', this._resizeHandler!);
        this.setupEvents();
        await this.loadSaved();

        // Focus trap
        this._keyDownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Tab') {
                const focusables = this.shadowRoot!.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                const first = focusables[0] as HTMLElement;
                const last = focusables[focusables.length - 1] as HTMLElement;

                if (e.shiftKey) {
                    if (document.activeElement === first || this.shadowRoot!.activeElement === first) {
                        last.focus();
                        e.preventDefault();
                    }
                } else {
                    if (document.activeElement === last || this.shadowRoot!.activeElement === last) {
                        first.focus();
                        e.preventDefault();
                    }
                }
            }
            if (e.key === 'Escape') {
                this.remove();
            }
        };
        this.shadowRoot?.addEventListener('keydown', this._keyDownHandler as EventListener);
    }

    updated(changed: Map<string, unknown>) {
        if (changed.has('showSaveNameRow') && this.showSaveNameRow) {
            const input = this.shadowRoot?.querySelector<HTMLInputElement>('.save-name-row input');
            input?.focus();
            input?.select();
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        if (this.canvas) {
            if (this._pointerDownHandler) this.canvas.removeEventListener('pointerdown', this._pointerDownHandler);
            if (this._pointerMoveHandler) this.canvas.removeEventListener('pointermove', this._pointerMoveHandler);
            if (this._pointerUpHandler) this.canvas.removeEventListener('pointerup', this._pointerUpHandler);
            if (this._pointerCancelHandler) this.canvas.removeEventListener('pointercancel', this._pointerCancelHandler);
        }
        if (this._keyDownHandler) this.shadowRoot?.removeEventListener('keydown', this._keyDownHandler as EventListener);
    }

    async loadSaved() {
        // Load presets and migrate legacy single-key if needed
        let presets = await loadPresetsFromDb(this.mode);
        const legacyKey = `signer_${this.mode}`;
        const legacy = localStorage.getItem(legacyKey);
        if (legacy && presets.length === 0) {
            const defaultName = `${this.mode === 'signature' ? i18n.t('presetBaseSignature') : i18n.t('presetBaseInitials')} 1`;
            presets = [{id: Date.now().toString(), name: defaultName, dataURL: legacy}];
            await persistPresetsToDb(this.mode, presets);
        }
        this.presets = presets;

        // Load last-used drawing into canvas
        let saved = await loadLastUsed(this.mode);
        if (!saved) saved = localStorage.getItem(legacyKey);
        if (saved) {
            this.originalData = saved;
            this.drawFromData(saved);
        }
        localStorage.removeItem(`signer_presets_${this.mode}`);
        localStorage.removeItem(legacyKey);
    }

    drawFromData(dataUrl: string) {
        const img = new Image();
        img.onload = () => {
            if (!this.ctx) return;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            const {drawWidth, drawHeight, offsetX, offsetY} = this.getFittedImageLayout(img.width, img.height);

            this.ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        };
        img.src = dataUrl;
    }

    private getFittedImageLayout(imageWidth: number, imageHeight: number) {
        const maxWidth = this.canvas.width * 0.9;
        const maxHeight = this.canvas.height * 0.9;
        const fitScale = Math.min(
            maxWidth / Math.max(1, imageWidth),
            maxHeight / Math.max(1, imageHeight),
            1
        );
        const drawWidth = imageWidth * fitScale;
        const drawHeight = imageHeight * fitScale;
        return {
            drawWidth,
            drawHeight,
            offsetX: (this.canvas.width - drawWidth) / 2,
            offsetY: (this.canvas.height - drawHeight) / 2,
        };
    }

    private async buildPayloadFromDataUrl(dataUrl: string): Promise<DrawnSignaturePayload | null> {
        const img = new Image();
        const loaded = await new Promise<boolean>((resolve) => {
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = dataUrl;
        });
        if (!loaded) return null;
        const {drawWidth, drawHeight} = this.getFittedImageLayout(img.width, img.height);
        return {
            dataUrl,
            cropWidth: drawWidth,
            cropHeight: drawHeight,
            padWidth: this.canvas.width,
            padHeight: this.canvas.height,
        };
    }

    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const ratio = 3;
            const nextWidth = Math.round(rect.width * ratio);
            const nextHeight = Math.round(rect.height * ratio);
            if (this.canvas.width === nextWidth && this.canvas.height === nextHeight) return;

            // Preserve current drawing across viewport resizes (mobile URL/status bar changes).
            const snapshot = document.createElement('canvas');
            const hadPixels = this.canvas.width > 0 && this.canvas.height > 0;
            if (hadPixels) {
                snapshot.width = this.canvas.width;
                snapshot.height = this.canvas.height;
                snapshot.getContext('2d')?.drawImage(this.canvas, 0, 0);
            }

            this.canvas.width = nextWidth;
            this.canvas.height = nextHeight;

            if (this.ctx) {
                this.ctx.lineJoin = 'round';
                this.ctx.lineCap = 'round';
                this.ctx.lineWidth = 4 * ratio;
                this.ctx.fillStyle = this.inkColor;
                this.ctx.strokeStyle = this.inkColor;
                if (hadPixels) {
                    this.ctx.drawImage(snapshot, 0, 0, nextWidth, nextHeight);
                } else if (this.originalData) {
                    this.drawFromData(this.originalData);
                }
            }
        }
    }

    getMousePos(e: { clientX: number, clientY: number }) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
            y: (e.clientY - rect.top) * (this.canvas.height / rect.height)
        };
    }

    setupEvents() {
        this._pointerDownHandler = (e: PointerEvent) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            this.activePointerId = e.pointerId;
            this.canvas.setPointerCapture(e.pointerId);
            this.start(e);
        };
        this._pointerMoveHandler = (e: PointerEvent) => {
            if (this.activePointerId !== e.pointerId) return;
            e.preventDefault();
            this.draw(e);
        };
        this._pointerUpHandler = (e: PointerEvent) => {
            if (this.activePointerId !== e.pointerId) return;
            this.canvas.releasePointerCapture(e.pointerId);
            this.activePointerId = null;
            this.stop();
        };
        this._pointerCancelHandler = (e: PointerEvent) => {
            if (this.activePointerId !== e.pointerId) return;
            this.activePointerId = null;
            this.stop();
        };

        this.canvas.addEventListener('pointerdown', this._pointerDownHandler, {passive: false});
        this.canvas.addEventListener('pointermove', this._pointerMoveHandler, {passive: false});
        this.canvas.addEventListener('pointerup', this._pointerUpHandler);
        this.canvas.addEventListener('pointercancel', this._pointerCancelHandler);
    }

    start(e: { clientX: number, clientY: number }) {
        this.isDrawing = true;
        this.hasCommittedStroke = false;
        this.points = [];
        if (this.ctx) {
            this.ctx.fillStyle = this.inkColor;
            this.ctx.strokeStyle = this.inkColor;
        }
        const pos = this.getMousePos(e);
        this.points.push(pos);
    }

    draw(e: { clientX: number, clientY: number }) {
        if (!this.isDrawing || !this.ctx) return;
        const pos = this.getMousePos(e);
        if (!this.hasCommittedStroke) {
            const origin = this.points[0];
            if (!origin) return;
            const dx = pos.x - origin.x;
            const dy = pos.y - origin.y;
            if ((dx * dx) + (dy * dy) < MIN_STROKE_DISTANCE * MIN_STROKE_DISTANCE) {
                return;
            }

            this.hasCommittedStroke = true;
            this.isDirty = true;
            this.points.push(pos);
            this.ctx.beginPath();
            this.ctx.moveTo(origin.x, origin.y);
            this.ctx.lineTo(pos.x, pos.y);
            this.ctx.stroke();
            return;
        }

        this.points.push(pos);
        if (this.points.length > 2) {
            const [p1, p2, p3] = this.points.slice(-3);
            const mid1 = {x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2};
            const mid2 = {x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2};
            this.ctx.beginPath();
            this.ctx.moveTo(mid1.x, mid1.y);
            this.ctx.quadraticCurveTo(p2.x, p2.y, mid2.x, mid2.y);
            this.ctx.stroke();
        }
    }

    stop() {
        this.isDrawing = false;
        this.points = [];
        this.hasCommittedStroke = false;
    }

    clear() {
        HapticService.impact();
        this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.isDirty = false;
        this.originalData = null;
        this.showSaveNameRow = false;
        void clearLastUsed(this.mode);
    }

    private setInkColor(color: string) {
        HapticService.selection();
        this.inkColor = color;
        localStorage.setItem('signer_ink_color', color);
        if (this.ctx) {
            this.ctx.strokeStyle = color;
            this.ctx.fillStyle = color;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        this.isDirty = false;
        this.originalData = null;
    }

    private usePreset(preset: SignaturePreset) {
        HapticService.impact();
        this.originalData = preset.dataURL;
        this.isDirty = false;
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        this.drawFromData(preset.dataURL);
        // Update last-used cache
        void persistLastUsed(this.mode, preset.dataURL);
    }

    private deletePreset(id: string) {
        HapticService.impact();
        const target = this.presets.find(p => p.id === id);
        if (target && this.originalData === target.dataURL) {
            this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.originalData = null;
            this.isDirty = false;
            this.showSaveNameRow = false;
            void clearLastUsed(this.mode);
        }
        const updated = this.presets.filter(p => p.id !== id);
        this.presets = updated;
        void persistPresetsToDb(this.mode, updated);
    }

    private saveAsPreset() {
        HapticService.selection();
        if (this.presets.length >= MAX_PRESETS) return;
        const defaultName = `${this.mode === 'signature' ? i18n.t('presetBaseSignature') : i18n.t('presetBaseInitials')} ${this.presets.length + 1}`;
        this.saveNameValue = defaultName;
        this.showSaveNameRow = true;
    }

    private async confirmSavePreset() {
        const name = this.saveNameValue.trim();
        if (!name) return;

        const exportPayload = this.exportCanvas();
        if (!exportPayload) return;

        HapticService.success();
        const preset: SignaturePreset = {id: Date.now().toString(), name, dataURL: exportPayload.dataUrl};
        const updated = [...this.presets, preset];
        await persistPresetsToDb(this.mode, updated);
        this.presets = updated;
        this.showSaveNameRow = false;
        this.saveNameValue = '';
    }

    private exportCanvas(): DrawnSignaturePayload | null {
        const srcW = this.canvas.width;
        const srcH = this.canvas.height;
        if (srcW <= 0 || srcH <= 0) return null;

        const srcCtx = this.canvas.getContext('2d');
        if (!srcCtx) return null;
        const data = srcCtx.getImageData(0, 0, srcW, srcH).data;
        let minX = srcW;
        let minY = srcH;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < srcH; y++) {
            for (let x = 0; x < srcW; x++) {
                const a = data[(y * srcW + x) * 4 + 3];
                if (a > 8) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }

        const exportCanvas = document.createElement('canvas');
        if (maxX < minX || maxY < minY) {
            exportCanvas.width = srcW;
            exportCanvas.height = srcH;
            const exportCtx = exportCanvas.getContext('2d');
            if (!exportCtx) return null;
            exportCtx.drawImage(this.canvas, 0, 0);
            return {
                dataUrl: exportCanvas.toDataURL('image/png'),
                cropWidth: srcW,
                cropHeight: srcH,
                padWidth: srcW,
                padHeight: srcH,
            };
        }

        const padding = 18;
        const cropX = Math.max(0, minX - padding);
        const cropY = Math.max(0, minY - padding);
        const cropW = Math.min(srcW - cropX, (maxX - minX + 1) + padding * 2);
        const cropH = Math.min(srcH - cropY, (maxY - minY + 1) + padding * 2);
        const MAX_WIDTH = 2000;
        let w = cropW;
        let h = cropH;
        if (w > MAX_WIDTH) {
            h = Math.round((MAX_WIDTH / w) * h);
            w = MAX_WIDTH;
        }
        exportCanvas.width = w;
        exportCanvas.height = h;
        const exportCtx = exportCanvas.getContext('2d');
        if (!exportCtx) return null;
        exportCtx.imageSmoothingEnabled = true;
        exportCtx.imageSmoothingQuality = 'high';
        exportCtx.drawImage(this.canvas, cropX, cropY, cropW, cropH, 0, 0, w, h);
        return {
            dataUrl: exportCanvas.toDataURL('image/png'),
            cropWidth: cropW,
            cropHeight: cropH,
            padWidth: srcW,
            padHeight: srcH,
        };
    }

    async save() {
        if (!this.isDirty && this.originalData) {
            HapticService.impact();
            const originalPayload = await this.buildPayloadFromDataUrl(this.originalData);
            this.dispatchEvent(new CustomEvent<DrawnSignaturePayload | string>('signed', {
                detail: originalPayload ?? this.originalData
            }));
            this.remove();
            return;
        }
        if (!this.isDirty && !this.originalData) {
            this.remove();
            return;
        }

        const exportPayload = this.exportCanvas();
        if (!exportPayload) return;
        HapticService.success();
        void persistLastUsed(this.mode, exportPayload.dataUrl);
        this.dispatchEvent(new CustomEvent<DrawnSignaturePayload>('signed', {detail: exportPayload}));
        this.remove();
    }

    render() {
        return html`
            <owq-modal .open=${true}
                       .center=${true}
                       @modal-close=${() => this.remove()}>
                    <h3 class="modal-title">
                        ${this.mode === 'initials' ? i18n.t('addInitials') : i18n.t('addSig')}</h3>

                    <div class="presets-section">
                        <div class="presets-label">${i18n.t('savedPresets')}</div>
                        ${this.presets.length === 0 ? html`
                            <div class="no-presets">${i18n.t('noPresets')}</div>
                        ` : html`
                            <div class="presets-strip">
                                ${this.presets.map(p => html`
                                    <div class="preset-item" title="${p.name}" data-testid="preset-${p.id}" @click=${() => this.usePreset(p)}>
                                        <img src="${p.dataURL}" alt="${p.name}">
                                        <span class="preset-name">${p.name}</span>
                                        <button
                                            class="preset-delete"
                                            data-testid="btn-delete-preset-${p.id}"
                                            title="${i18n.t('deletePreset')}"
                                            aria-label="${i18n.t('deletePreset')}"
                                            @click=${(e: Event) => {
                                                e.stopPropagation();
                                                this.deletePreset(p.id);
                                            }}>✕</button>
                                    </div>
                                `)}
                            </div>
                        `}
                    </div>

                    <div class="color-strip" aria-label="${i18n.t('inkColor')}">
                        ${INK_COLORS.map(c => html`
                            <button
                                class="color-swatch ${this.inkColor === c.value ? 'selected' : ''}"
                                data-testid="color-${c.value}"
                                style="background:${c.value}"
                                title="${i18n.t(c.labelKey)}"
                                aria-label="${i18n.t(c.labelKey)}"
                                aria-pressed="${this.inkColor === c.value}"
                                @click=${() => this.setInkColor(c.value)}
                            ></button>
                        `)}
                    </div>

                    <canvas id="signature-pad" data-testid="signature-pad"></canvas>

                    ${(this.isDirty || this.originalData) && this.presets.length < MAX_PRESETS ? html`
                        ${this.showSaveNameRow ? html`
                            <div class="save-name-row">
                                <input
                                    type="text"
                                    class="input-field"
                                    data-testid="input-preset-name"
                                    .value=${this.saveNameValue}
                                    @input=${(e: Event) => { this.saveNameValue = (e.target as HTMLInputElement).value; }}
                                    @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.confirmSavePreset(); if (e.key === 'Escape') { this.showSaveNameRow = false; } }}
                                    placeholder="${i18n.t('presetName')}"
                                >
                                <button class="btn btn-primary btn-sm" data-testid="btn-confirm-preset"
                                        @click=${() => this.confirmSavePreset()}>
                                    ${i18n.t('savePresetShort')}
                                </button>
                                <button class="btn btn-sm"
                                        @click=${() => { this.showSaveNameRow = false; }}>
                                    ${i18n.t('cancel')}
                                </button>
                            </div>
                        ` : html`
                            <div class="save-preset-row">
                                <button class="btn btn-sm" data-testid="btn-save-preset"
                                        @click=${() => this.saveAsPreset()}>
                                    + ${i18n.t('savePresetShort')}
                                </button>
                            </div>
                        `}
                    ` : ''}

                    <div class="actions">
                        <button class="btn" @click=${() => this.remove()}>${i18n.t('cancel')}</button>
                        <button class="btn btn-danger" data-testid="btn-clear-sig" @click=${() => this.clear()}>${i18n.t('clear')}</button>
                        <button class="btn btn-primary" data-testid="btn-save-sig" @click=${() => this.save()}>${i18n.t('done')}</button>
                    </div>
            </owq-modal>
        `;
    }
}
