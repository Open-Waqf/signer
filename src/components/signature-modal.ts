import {css, html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {i18n} from '../lib/i18n-service';
import {sharedStyles} from '../styles/shared-styles';
import {TranslationKey} from '../i18n/locales';
import {HapticService} from '../lib/haptic-service';

const INK_COLORS: Array<{ value: string; labelKey: TranslationKey }> = [
    {value: '#1a1a2e', labelKey: 'inkDark'},
    {value: '#1447e6', labelKey: 'inkBlue'},
    {value: '#c0392b', labelKey: 'inkRed'},
    {value: '#1e8449', labelKey: 'inkGreen'},
];

const MAX_PRESETS = 5;

interface SignaturePreset {
    id: string;
    name: string;
    dataURL: string;
}

function loadPresets(mode: string): SignaturePreset[] {
    try {
        return JSON.parse(localStorage.getItem(`signer_presets_${mode}`) ?? '[]');
    } catch {
        return [];
    }
}

function persistPresets(mode: string, presets: SignaturePreset[]) {
    localStorage.setItem(`signer_presets_${mode}`, JSON.stringify(presets));
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
    private _resizeHandler: (() => void) | null = null;
    private _touchStartHandler: ((e: TouchEvent) => void) | null = null;
    private _touchMoveHandler: ((e: TouchEvent) => void) | null = null;
    private _touchEndHandler: (() => void) | null = null;
    private _mouseDownHandler: ((e: MouseEvent) => void) | null = null;
    private _mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
    private _mouseUpHandler: (() => void) | null = null;

    @state() private originalData: string | null = null;
    @state() private isDirty = false;

    static styles = [sharedStyles, css`
        canvas {
            border: 2px dashed #ccc;
            border-radius: 8px;
            touch-action: none;
            background: #fafafa;
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
            display: flex;
            gap: 10px;
            justify-content: flex-end;
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
            border-color: #444;
            box-shadow: 0 0 0 2px #fff, 0 0 0 4px #444;
        }

        .presets-section {
            margin-bottom: 14px;
        }

        .presets-label {
            font-size: 0.75rem;
            color: #6b7280;
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
            border: 2px solid #e5e7eb;
            border-radius: 6px;
            background: #fff;
            padding: 0;
            width: 80px;
            height: 48px;
            overflow: hidden;
            transition: border-color 0.15s;
        }

        .preset-item:hover {
            border-color: var(--primary, #1447e6);
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
            color: #fff;
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
            color: #6b7280;
            text-align: center;
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(255,255,255,0.8);
            padding: 1px 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .no-presets {
            font-size: 0.75rem;
            color: #9ca3af;
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
            align-items: center;
            margin-bottom: 14px;
        }

    `];

    async firstUpdated() {
        await new Promise(requestAnimationFrame);
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        this._resizeHandler = () => {
            this.resizeCanvas();
            if (!this.isDirty && this.originalData) {
                this.drawFromData(this.originalData);
            }
        };
        window.addEventListener('resize', this._resizeHandler!);
        this.setupEvents();
        this.loadSaved();

        // Focus trap
        this.shadowRoot?.addEventListener('keydown', ((e: KeyboardEvent) => {
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
        }) as EventListener);
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
            if (this._touchStartHandler) this.canvas.removeEventListener('touchstart', this._touchStartHandler);
            if (this._touchMoveHandler) this.canvas.removeEventListener('touchmove', this._touchMoveHandler);
            if (this._touchEndHandler) this.canvas.removeEventListener('touchend', this._touchEndHandler);
            if (this._mouseDownHandler) this.canvas.removeEventListener('mousedown', this._mouseDownHandler);
            if (this._mouseMoveHandler) this.canvas.removeEventListener('mousemove', this._mouseMoveHandler);
            if (this._mouseUpHandler) this.canvas.removeEventListener('mouseup', this._mouseUpHandler);
        }
    }

    loadSaved() {
        // Load presets and migrate legacy single-key if needed
        let presets = loadPresets(this.mode);
        const legacyKey = `signer_${this.mode}`;
        const legacy = localStorage.getItem(legacyKey);
        if (legacy && presets.length === 0) {
            const defaultName = this.mode === 'signature' ? 'Signature 1' : 'Initials 1';
            presets = [{id: Date.now().toString(), name: defaultName, dataURL: legacy}];
            persistPresets(this.mode, presets);
        }
        this.presets = presets;

        // Load last-used drawing into canvas
        const saved = localStorage.getItem(legacyKey);
        if (saved) {
            this.originalData = saved;
            this.drawFromData(saved);
        }
    }

    drawFromData(dataUrl: string) {
        const img = new Image();
        img.onload = () => this.ctx?.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        img.src = dataUrl;
    }

    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const ratio = 3;
            this.canvas.width = rect.width * ratio;
            this.canvas.height = rect.height * ratio;

            if (this.ctx) {
                this.ctx.lineJoin = 'round';
                this.ctx.lineCap = 'round';
                this.ctx.lineWidth = 4 * ratio;
                this.ctx.fillStyle = this.inkColor;
                this.ctx.strokeStyle = this.inkColor;
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
        this._touchStartHandler = (e: TouchEvent) => {
            e.preventDefault();
            this.start(e.touches[0]);
        };
        this._touchMoveHandler = (e: TouchEvent) => {
            e.preventDefault();
            this.draw(e.touches[0]);
        };
        this._touchEndHandler = () => this.stop();
        this._mouseDownHandler = (e: MouseEvent) => this.start(e);
        this._mouseMoveHandler = (e: MouseEvent) => this.draw(e);
        this._mouseUpHandler = () => this.stop();

        this.canvas.addEventListener('touchstart', this._touchStartHandler, {passive: false});
        this.canvas.addEventListener('touchmove', this._touchMoveHandler, {passive: false});
        this.canvas.addEventListener('touchend', this._touchEndHandler);
        this.canvas.addEventListener('mousedown', this._mouseDownHandler);
        this.canvas.addEventListener('mousemove', this._mouseMoveHandler);
        this.canvas.addEventListener('mouseup', this._mouseUpHandler);
    }

    start(e: { clientX: number, clientY: number }) {
        this.isDrawing = true;
        this.isDirty = true;
        this.points = [];
        if (this.ctx) {
            this.ctx.fillStyle = this.inkColor;
            this.ctx.strokeStyle = this.inkColor;
        }
        const pos = this.getMousePos(e);
        this.points.push(pos);
        this.ctx?.beginPath();
        this.ctx?.arc(pos.x, pos.y, this.ctx!.lineWidth / 2, 0, Math.PI * 2);
        this.ctx?.fill();
    }

    draw(e: { clientX: number, clientY: number }) {
        if (!this.isDrawing || !this.ctx) return;
        const pos = this.getMousePos(e);
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
    }

    clear() {
        HapticService.impact();
        this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.isDirty = false;
        this.originalData = null;
        this.showSaveNameRow = false;
        localStorage.removeItem(`signer_${this.mode}`);
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
        localStorage.setItem(`signer_${this.mode}`, preset.dataURL);
    }

    private deletePreset(id: string) {
        HapticService.impact();
        const target = this.presets.find(p => p.id === id);
        if (target && this.originalData === target.dataURL) {
            this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.originalData = null;
            this.isDirty = false;
            this.showSaveNameRow = false;
            localStorage.removeItem(`signer_${this.mode}`);
        }
        const updated = this.presets.filter(p => p.id !== id);
        this.presets = updated;
        persistPresets(this.mode, updated);
    }

    private saveAsPreset() {
        HapticService.selection();
        if (this.presets.length >= MAX_PRESETS) return;
        const defaultName = `${this.mode === 'signature' ? 'Signature' : 'Initials'} ${this.presets.length + 1}`;
        this.saveNameValue = defaultName;
        this.showSaveNameRow = true;
    }

    private confirmSavePreset() {
        const name = this.saveNameValue.trim();
        if (!name) return;

        const dataUrl = this.exportCanvas();
        if (!dataUrl) return;

        HapticService.success();
        const preset: SignaturePreset = {id: Date.now().toString(), name, dataURL: dataUrl};
        const updated = [...this.presets, preset];
        this.presets = updated;
        persistPresets(this.mode, updated);
        this.showSaveNameRow = false;
        this.saveNameValue = '';
    }

    private exportCanvas(): string | null {
        const exportCanvas = document.createElement('canvas');
        const MAX_WIDTH = 600;
        let [w, h] = [this.canvas.width, this.canvas.height];
        if (w > MAX_WIDTH) {
            h = (MAX_WIDTH / w) * h;
            w = MAX_WIDTH;
        }
        exportCanvas.width = w;
        exportCanvas.height = h;
        exportCanvas.getContext('2d')?.drawImage(this.canvas, 0, 0, w, h);
        return exportCanvas.toDataURL('image/png');
    }

    save() {
        if (!this.isDirty && this.originalData) {
            HapticService.impact();
            this.dispatchEvent(new CustomEvent('signed', {detail: this.originalData}));
            this.remove();
            return;
        }
        if (!this.isDirty && !this.originalData) {
            this.remove();
            return;
        }

        const dataUrl = this.exportCanvas();
        if (!dataUrl) return;
        HapticService.success();
        localStorage.setItem(`signer_${this.mode}`, dataUrl);
        this.dispatchEvent(new CustomEvent('signed', {detail: dataUrl}));
        this.remove();
    }

    render() {
        return html`
            <div class="modal-overlay">
                <div class="modal-card center">
                    <h3 style="margin-top:0;">
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
                                    ${i18n.t('savePreset')}
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
                                    + ${i18n.t('savePreset')}
                                </button>
                            </div>
                        `}
                    ` : ''}

                    <div class="actions">
                        <button class="btn" @click=${() => this.remove()}>${i18n.t('cancel')}</button>
                        <button class="btn btn-danger" data-testid="btn-clear-sig" @click=${() => this.clear()}>${i18n.t('clear')}</button>
                        <button class="btn btn-primary" data-testid="btn-save-sig" @click=${() => this.save()}>${i18n.t('done')}</button>
                    </div>
                </div>
            </div>
        `;
    }
}
