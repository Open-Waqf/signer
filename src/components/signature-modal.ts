import {css, html, LitElement} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';
import {i18n} from '../lib/i18n-service';

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

    static styles = css`
        :host {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            direction: ltr;
            backdrop-filter: blur(2px); /* Makes it look nicer */
        }

        .card {
            background: white;
            padding: 20px;
            border-radius: 12px;
            width: 90%;
            max-width: 500px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        }

        canvas {
            border: 2px dashed #ccc;
            border-radius: 8px;
            touch-action: none;
            background: #fafafa;
            width: 100%;
            height: 250px;
            display: block;
            cursor: crosshair;
        }

        .actions {
            margin-top: 15px;
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }

        button {
            padding: 10px 20px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-weight: bold;
            font-family: inherit;
        }

        .btn-clear {
            background: #fee2e2;
            color: #b91c1c;
        }

        .btn-save {
            background: #10b981;
            color: white;
        }

        .btn-close {
            background: #f3f4f6;
            color: #374151;
        }
    `;

    async firstUpdated() {
        await new Promise(requestAnimationFrame);
        this.ctx = this.canvas.getContext('2d');

        this.resizeCanvas();

        // Handle window resizing
        this._resizeHandler = () => {
            this.resizeCanvas();
            // If we have an original image and user hasn't drawn new stuff, restore it after resize
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
        img.onload = () => {
            // Draw image to fill the canvas (strech to fit)
            this.ctx?.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        };
        img.src = dataUrl;
    }

    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {

            // 🚀 FIX 1: FORCE HIGH RESOLUTION
            // We multiply physical pixels by 3 for Retina quality
            const ratio = 3;

            this.canvas.width = rect.width * ratio;
            this.canvas.height = rect.height * ratio;

            if (this.ctx) {
                this.ctx.lineJoin = 'round';
                this.ctx.lineCap = 'round';

                // Scale line width too (4 * 3 = 12px) so it doesn't look like a needle
                this.ctx.lineWidth = 4 * ratio;

                this.ctx.fillStyle = '#000';
                this.ctx.strokeStyle = '#000';
            }
        }
    }

    getMousePos(e: { clientX: number, clientY: number }) {
        const rect = this.canvas.getBoundingClientRect();
        // Since canvas.width is now 3x rect.width, this scaleX will automatically be 3.
        // This preserves your existing drawing logic perfectly!
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
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
        this.isDirty = true; // ✨ User is modifying the signature
        this.points = [];
        const pos = this.getMousePos(e);
        this.points.push(pos);

        // Draw a single dot for a click/tap
        this.ctx?.beginPath();
        // Adjust dot size for high-res (2 * ratio approx)
        this.ctx?.arc(pos.x, pos.y, this.ctx.lineWidth / 2, 0, Math.PI * 2);
        this.ctx?.fill();
    }

    draw(e: { clientX: number, clientY: number }) {
        if (!this.isDrawing || !this.ctx) return;

        const pos = this.getMousePos(e);
        this.points.push(pos);

        // SMOOTHING ALGORITHM
        if (this.points.length > 2) {
            const lastTwo = this.points.slice(-3);
            const p1 = lastTwo[0];
            const p2 = lastTwo[1];
            const p3 = lastTwo[2];

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
        this.isDirty = true; // ✨ We modified it
        this.originalData = null; // ✨ Clean slate
        localStorage.removeItem(`signer_${this.mode}`);
    }

    save() {
        // 🚀 FIX 2: NO-TOUCH LOGIC
        // If we have original data and the user didn't draw anything new,
        // return the clean original. DO NOT re-save/re-compress.
        if (!this.isDirty && this.originalData) {
            this.dispatchEvent(new CustomEvent('signed', {detail: this.originalData}));
            this.remove();
            return;
        }

        // If user drew something but cleared it (empty canvas)
        if (!this.isDirty && !this.originalData) {
            this.remove();
            return;
        }

        // Only reach here if user actually DREW something new.
        // We export the High-Res canvas directly.
        // Note: I removed the downscaling loop because it causes blur.
        // A 1500px wide signature is fine for modern devices.
        const dataUrl = this.canvas.toDataURL('image/png');

        localStorage.setItem(`signer_${this.mode}`, dataUrl);
        this.dispatchEvent(new CustomEvent('signed', {detail: dataUrl}));
        this.remove();
    }

    close() {
        this.remove();
    }

    render() {
        // ✨ FIX 3: TRANSLATIONS
        const title = this.mode === 'initials' ? i18n.t('addInitials') : i18n.t('addSig');

        return html`
            <div class="card">
                <h3>${title}</h3>
                <canvas></canvas>
                <div class="actions">
                    <button class="btn-close" @click=${this.close}>${i18n.t('cancel')}</button>
                    <button class="btn-clear" @click=${this.clear}>${i18n.t('clear')}</button>
                    <button class="btn-save" @click=${this.save}>${i18n.t('done')}</button>
                </div>
            </div>
        `;
    }
}