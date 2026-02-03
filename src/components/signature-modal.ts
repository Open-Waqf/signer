import {css, html, LitElement} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';

@customElement('signature-modal')
export class SignatureModal extends LitElement {
    @query('canvas') canvas!: HTMLCanvasElement;
    @property() mode: 'signature' | 'initials' = 'signature';

    private isDrawing = false;
    private ctx: CanvasRenderingContext2D | null = null;
    // Track listener to remove it later
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
            /* Fix: Force LTR so coordinates don't flip in Arabic */
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
        }

        h3 {
            margin-top: 0;
            color: #333;
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
        // Wait for layout to settle
        await new Promise(requestAnimationFrame);

        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        // Bind resize handler safely
        this._resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this._resizeHandler!);

        this.setupEvents();

        // Load saved data
        const storageKey = `signer_${this.mode}`;
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            const img = new Image();
            img.onload = () => this.ctx?.drawImage(img, 0, 0);
            img.src = saved;
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
    }

    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            // Set Bitmap size to match CSS size
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;

            // Re-apply context styles after resize clears them
            if (this.ctx) {
                this.ctx.lineWidth = 3;
                this.ctx.lineCap = 'round';
                this.ctx.strokeStyle = '#000';
            }
        }
    }

    // --- ROBUST COORDINATE CALCULATION ---
    getMousePos(e: { clientX: number, clientY: number }) {
        const rect = this.canvas.getBoundingClientRect();

        // Calculate scaling factors (Bitmap Resolution / CSS Size)
        // This fixes the offset if browser is zoomed or on high-DPI screens
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    setupEvents() {
        // Mouse
        this.canvas.addEventListener('mousedown', (e) => this.start(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stop());
        // Touch (Passive: false prevents scrolling while drawing)
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.start(e.touches[0]);
        }, {passive: false});
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.draw(e.touches[0]);
        }, {passive: false});
        this.canvas.addEventListener('touchend', () => this.stop());
    }

    start(e: { clientX: number, clientY: number }) {
        this.isDrawing = true;
        const pos = this.getMousePos(e); // Use helper
        this.ctx?.beginPath();
        this.ctx?.moveTo(pos.x, pos.y);
    }

    draw(e: { clientX: number, clientY: number }) {
        if (!this.isDrawing) return;
        const pos = this.getMousePos(e); // Use helper
        this.ctx?.lineTo(pos.x, pos.y);
        this.ctx?.stroke();
    }

    stop() {
        this.isDrawing = false;
    }

    clear() {
        this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
        localStorage.removeItem(`signer_${this.mode}`);
    }

    save() {
        // Optimization: Downscale huge images to prevent memory crash
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