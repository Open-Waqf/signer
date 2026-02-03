import {css, html, LitElement} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';

@customElement('signature-modal')
export class SignatureModal extends LitElement {
    @query('canvas') canvas!: HTMLCanvasElement;

    // NEW: specific mode to separate storage keys
    @property() mode: 'signature' | 'initials' = 'signature';

    private isDrawing = false;
    private ctx: CanvasRenderingContext2D | null = null;

    static styles = css`
        /* ... (Keep existing styles) ... */

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

    firstUpdated() {
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        this.setupEvents();

        // FIXED: Load from separate, prefixed keys
        const storageKey = `signer_${this.mode}`;
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            const img = new Image();
            img.onload = () => this.ctx?.drawImage(img, 0, 0);
            img.src = saved;
        }
    }

    // ... (Keep resizeCanvas, setupEvents, draw logic same as before) ...
    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.ctx!.lineWidth = 3;
        this.ctx!.lineCap = 'round';
        this.ctx!.strokeStyle = '#000';
    }

    setupEvents() {
        // Mouse
        this.canvas.addEventListener('mousedown', (e) => this.start(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stop());
        // Touch
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.start(e.touches[0]);
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.draw(e.touches[0]);
        });
        this.canvas.addEventListener('touchend', () => this.stop());
    }

    start(e: { clientX: number, clientY: number }) {
        this.isDrawing = true;
        const rect = this.canvas.getBoundingClientRect();
        this.ctx?.beginPath();
        this.ctx?.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    }

    draw(e: { clientX: number, clientY: number }) {
        if (!this.isDrawing) return;
        const rect = this.canvas.getBoundingClientRect();
        this.ctx?.lineTo(e.clientX - rect.left, e.clientY - rect.top);
        this.ctx?.stroke();
    }

    stop() {
        this.isDrawing = false;
    }

    clear() {
        this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // FIXED: Remove specific key
        localStorage.removeItem(`signer_${this.mode}`);
    }

    save() {
        // ... (Keep existing resize/optimization logic) ...
        const MAX_WIDTH = 500;
        let finalCanvas = this.canvas;
        if (this.canvas.width > MAX_WIDTH) {
            const scale = MAX_WIDTH / this.canvas.width;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = MAX_WIDTH;
            tempCanvas.height = this.canvas.height * scale;
            const tCtx = tempCanvas.getContext('2d');
            tCtx?.drawImage(this.canvas, 0, 0, tempCanvas.width, tempCanvas.height);
            finalCanvas = tempCanvas;
        }
        const dataUrl = finalCanvas.toDataURL('image/png', 0.8);

        // FIXED: Save with prefix
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