import {css, html, LitElement} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';
import {pdfEngine} from '../lib/pdf-engine';
import {fileService} from '../lib/file-service';
import './signature-modal';

@customElement('pdf-workspace')
export class PdfWorkspace extends LitElement {
    @property() pdfName = '';
    @property({type: Number}) currentPage = 1;
    @property({type: Number}) totalPages = 0;

    // State for the signature placement
    @property() signatureUrl: string | null = null;
    @property({type: Number}) sigX = 50; // Visual Position (Pixels)
    @property({type: Number}) sigY = 50;

    @query('#pdf-canvas') canvas!: HTMLCanvasElement;
    @query('.workspace') workspace!: HTMLDivElement;

    static styles = css`
        :host {
            display: block;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        header {
            padding: 10px;
            background: #fff;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .workspace {
            flex: 1;
            background: #e5e7eb;
            overflow: auto;
            display: flex;
            justify-content: center;
            padding: 20px;
            position: relative;
        }

        .page-container {
            position: relative;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
        }

        /* The Draggable Signature */

        .signature-layer {
            position: absolute;
            top: 0;
            left: 0;
            cursor: move;
            border: 2px dashed #2563eb;
            background: rgba(37, 99, 235, 0.1);
            width: 200px; /* Initial width */
        }

        .signature-layer img {
            width: 100%;
            pointer-events: none;
        }

        .btn {
            padding: 8px 16px;
            border-radius: 6px;
            background: #2563eb;
            color: white;
            border: none;
            cursor: pointer;
        }

        .btn:disabled {
            background: #ccc;
        }
    `;

    async loadPdf(file: Uint8Array, name: string) {
        this.pdfName = name;
        this.totalPages = await pdfEngine.load(file);
        this.currentPage = 1;
        this.requestUpdate();
        await this.updateComplete;
        this.renderPage();
    }

    async renderPage() {
        await pdfEngine.renderPage(this.currentPage, this.canvas);
    }

    openSignModal() {
        const modal = document.createElement('signature-modal');
        modal.addEventListener('signed', (e: any) => {
            this.signatureUrl = e.detail;
            // Reset position to center of view
            this.sigX = 100;
            this.sigY = 100;
        });
        document.body.appendChild(modal);
    }

    // Handle Dragging Logic
    startDrag(e: MouseEvent | TouchEvent) {
        e.preventDefault();
        const move = (ev: MouseEvent | TouchEvent) => {
            const clientX = 'touches' in ev ? ev.touches[0].clientX : (ev as MouseEvent).clientX;
            const clientY = 'touches' in ev ? ev.touches[0].clientY : (ev as MouseEvent).clientY;

            const rect = this.canvas.getBoundingClientRect();
            this.sigX = clientX - rect.left - 100; // Center offset
            this.sigY = clientY - rect.top - 25;
        };
        const stop = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('touchmove', move);
            window.removeEventListener('mouseup', stop);
            window.removeEventListener('touchend', stop);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('touchmove', move);
        window.addEventListener('mouseup', stop);
        window.addEventListener('touchend', stop);
    }

    async saveDocument() {
        if (!this.signatureUrl) {
            alert('Please add a signature first!');
            return;
        }

        // Calculate Percentages for the PDF Engine
        const rect = this.canvas.getBoundingClientRect();
        const xPercent = this.sigX / rect.width;
        const yPercent = this.sigY / rect.height;

        const modifiedPdf = await pdfEngine.saveWithSignature(
            this.signatureUrl,
            this.currentPage - 1, // 0-indexed
            xPercent,
            yPercent
        );

        await fileService.savePdf(`signed-${this.pdfName}`, modifiedPdf);
        alert('Document Saved!');
    }

    render() {
        return html`
            <header>
                <div>${this.pdfName || 'No Document Loaded'}</div>
                <div>
                    <button class="btn" @click=${this.openSignModal}>+ Add Signature</button>
                    <button class="btn" @click=${this.saveDocument}>Save & Download</button>
                </div>
            </header>

            <div class="workspace">
                <div class="page-container">
                    <canvas id="pdf-canvas"></canvas>

                    ${this.signatureUrl ? html`
                        <div class="signature-layer"
                             style="transform: translate(${this.sigX}px, ${this.sigY}px)"
                             @mousedown=${this.startDrag}
                             @touchstart=${this.startDrag}>
                            <img src="${this.signatureUrl}"/>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
}