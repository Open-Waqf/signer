import {css, html, LitElement} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';

@customElement('signature-modal')
export class SignatureModal extends LitElement {
    @query('canvas') canvas!: HTMLCanvasElement;
    @property() mode: 'signature' | 'initials' = 'signature';

    private isDrawing = false;
    private ctx: CanvasRenderingContext2D | null = null;
    private points: { x: number, y: number }[] = []; // Store points for smoothing
    private _resizeHandler: (() => void) | null = null;

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

        this._resizeHandler = () => this.resizeCanvas();
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
            const img = new Image();
            img.onload = () => this.ctx?.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
            img.src = saved;
        }
    }

    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;

            // Reset Context Styles
            if (this.ctx) {
                this.ctx.lineJoin = 'round';
                this.ctx.lineCap = 'round';
                this.ctx.lineWidth = 2;
                this.ctx.fillStyle = '#000'; // For dots
                this.ctx.strokeStyle = '#000'; // For lines
            }
        }
    }

    getMousePos(e: { clientX: number, clientY: number }) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    setupEvents() {
        // Touch (Passive false is critical for drawing)
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.start(e.touches[0]);
        }, {passive: false});
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.draw(e.touches[0]);
        }, {passive: false});
        this.canvas.addEventListener('touchend', () => this.stop());

        // Mouse
        this.canvas.addEventListener('mousedown', (e) => this.start(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stop());
    }

    start(e: { clientX: number, clientY: number }) {
        this.isDrawing = true;
        this.points = []; // Reset points
        const pos = this.getMousePos(e);
        this.points.push(pos);

        // Draw a single dot in case it's just a tap
        this.ctx?.beginPath();
        this.ctx?.arc(pos.x, pos.y, 1, 0, Math.PI * 2);
        this.ctx?.fill();
    }

    draw(e: { clientX: number, clientY: number }) {
        if (!this.isDrawing || !this.ctx) return;

        const pos = this.getMousePos(e);
        this.points.push(pos);

        // SMOOTHING ALGORITHM: Quadratic Curve
        // We draw from the previous mid-point to the current mid-point
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
        this.points = []; // Clear for next stroke
    }

    clear() {
        this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
        localStorage.removeItem(`signer_${this.mode}`);
    }

    save() {
        // 1. Crop empty space (Optional but nice)
        // 2. Downscale for memory safety
        const MAX_WIDTH = 500;
        let finalCanvas = this.canvas;

        if (this.canvas.width > MAX_WIDTH) {
            const scale = MAX_WIDTH / this.canvas.width;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = MAX_WIDTH;
            tempCanvas.height = this.canvas.height * scale;
            const tCtx = tempCanvas.getContext('2d');
            if (tCtx) {
                tCtx.drawImage(this.canvas, 0, 0, tempCanvas.width, tempCanvas.height);
                finalCanvas = tempCanvas;
            }
        }

        const dataUrl = finalCanvas.toDataURL('image/png');
        localStorage.setItem(`signer_${this.mode}`, dataUrl);

        this.dispatchEvent(new CustomEvent('signed', {detail: dataUrl}));
        this.remove();
    }

    close() {
        this.remove();
    }

    render() {
        // Note: Text here should ideally be i18n too, but keeping it simple for this snippet
        return html`
            <div class="card">
                <h3>${this.mode === 'initials' ? 'Draw Initials' : 'Draw Signature'}</h3>
                <canvas></canvas>
                <div class="actions">
                    <button class="btn-close" @click=${this.close}>Cancel</button>
                    <button class="btn-clear" @click=${this.clear}>Clear</button>
                    <button class="btn-save" @click=${this.save}>Use This</button>
                </div>
            </div>
        `;
    }
}