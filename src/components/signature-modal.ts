import {css, html, LitElement} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';
import {i18n} from '../lib/i18n-service';
import {sharedStyles} from '../styles/shared-styles'; // ✨ Import Shared CSS

@customElement('signature-modal')
export class SignatureModal extends LitElement {
    @query('canvas') canvas!: HTMLCanvasElement;
    @property() mode: 'signature' | 'initials' = 'signature';

    private isDrawing = false;
    private ctx: CanvasRenderingContext2D | null = null;
    private points: { x: number, y: number }[] = [];
    private _resizeHandler: (() => void) | null = null;

    private originalData: string | null = null;
    private isDirty = false;

    static styles = [sharedStyles, css`
        canvas {
            border: 2px dashed #ccc;
            border-radius: 8px;
            touch-action: none;
            background: #fafafa;
            width: 100%;
            height: 250px;
            display: block;
            cursor: crosshair;
            margin-bottom: 20px;
        }

        .actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
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
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
    }

    loadSaved() {
        const storageKey = `signer_${this.mode}`;
        const saved = localStorage.getItem(storageKey);
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
                this.ctx.fillStyle = '#000';
                this.ctx.strokeStyle = '#000';
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
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.start(e.touches[0]);
        }, {passive: false});
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.draw(e.touches[0]);
        }, {passive: false});
        this.canvas.addEventListener('touchend', () => this.stop());
        this.canvas.addEventListener('mousedown', (e) => this.start(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stop());
    }

    start(e: { clientX: number, clientY: number }) {
        this.isDrawing = true;
        this.isDirty = true;
        this.points = [];
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
        this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.isDirty = true;
        this.originalData = null;
        localStorage.removeItem(`signer_${this.mode}`);
    }

    save() {
        if (!this.isDirty && this.originalData) {
            this.dispatchEvent(new CustomEvent('signed', {detail: this.originalData}));
            this.remove();
            return;
        }
        if (!this.isDirty && !this.originalData) {
            this.remove();
            return;
        }

        const exportCanvas = document.createElement('canvas');
        const MAX_WIDTH = 600;
        let [exportWidth, exportHeight] = [this.canvas.width, this.canvas.height];
        if (exportWidth > MAX_WIDTH) {
            exportHeight = (MAX_WIDTH / exportWidth) * exportHeight;
            exportWidth = MAX_WIDTH;
        }
        exportCanvas.width = exportWidth;
        exportCanvas.height = exportHeight;
        exportCanvas.getContext('2d')?.drawImage(this.canvas, 0, 0, exportWidth, exportHeight);

        const dataUrl = exportCanvas.toDataURL('image/png');
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
                    <canvas id="signature-pad"></canvas>
                    <div class="actions">
                        <button class="btn" @click=${() => this.remove()}>${i18n.t('cancel')}</button>
                        <button class="btn btn-danger" @click=${this.clear}>${i18n.t('clear')}</button>
                        <button class="btn btn-primary" @click=${this.save}>${i18n.t('done')}</button>
                    </div>
                </div>
            </div>
        `;
    }
}