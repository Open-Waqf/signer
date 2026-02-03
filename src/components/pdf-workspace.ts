import {css, html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {pdfEngine} from '../lib/pdf-engine';
import {fileService} from '../lib/file-service';
import {i18n} from '../lib/i18n-service';
import './signature-modal';

type DragType = 'sig' | 'date';

@customElement('pdf-workspace')
export class PdfWorkspace extends LitElement {
    @property() pdfName = '';
    @state() currentPage = 1;
    @state() totalPages = 0;
    @state() scale = 1.0;

    @state() signatureUrl: string | null = null;
    @state() sigPos = {x: 50, y: 50};

    @state() addedDate: string | null = null;
    @state() datePos = {x: 100, y: 100};

    @state() isInitialsMode = false;

    @query('#pdf-canvas') canvas!: HTMLCanvasElement;

    static styles = css`
        :host {
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: #e5e7eb;
        }

        /* Header Polish */

        header {
            background: #fff;
            height: 60px;
            padding: 0 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #e5e7eb;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
            z-index: 20;
        }

        .brand {
            font-weight: 600;
            color: #1f2937;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .brand img {
            height: 32px;
            width: 32px;
            border-radius: 6px;
        }

        /* Language Button */

        .lang-btn {
            background: #f3f4f6;
            border: none;
            color: #374151;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 0.85rem;
            font-weight: 600;
            margin-left: 10px;
            cursor: pointer;
        }

        .lang-btn:hover {
            background: #e5e7eb;
        }

        .toolbar {
            background: #fff;
            padding: 8px 12px;
            display: flex;
            gap: 8px;
            align-items: center;
            overflow-x: auto;
            border-bottom: 1px solid #e5e7eb;
        }

        .viewport {
            flex: 1;
            overflow: auto;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 30px;
            position: relative;
            touch-action: none;
            background-image: radial-gradient(#d1d5db 1px, transparent 1px);
            background-size: 20px 20px; /* Dot pattern background */
        }

        .page-container {
            position: relative;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
            background: white;
            border-radius: 2px;
        }

        /* Draggable Items */

        .draggable {
            position: absolute;
            cursor: move;
            border: 2px dashed rgba(37, 99, 235, 0.5);
        }

        .draggable:hover, .draggable.active {
            border-color: #2563eb;
            background: rgba(37, 99, 235, 0.05);
        }

        .draggable img {
            width: 100%;
            pointer-events: none;
            display: block;
        }

        .draggable span {
            background: transparent;
            padding: 4px 8px;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            font-size: 16px;
            display: block;
            white-space: nowrap;
        }

        /* Buttons */

        button {
            padding: 8px 14px;
            border-radius: 6px;
            border: 1px solid #e5e7eb;
            background: white;
            cursor: pointer;
            font-size: 14px;
            white-space: nowrap;
            color: #374151;
        }

        button:hover {
            background: #f9fafb;
            border-color: #d1d5db;
        }

        button.primary {
            background: #2563eb;
            color: white;
            border: none;
        }

        button.primary:hover {
            background: #1d4ed8;
        }

        .divider {
            width: 1px;
            height: 24px;
            background: #e5e7eb;
            margin: 0 4px;
        }

        .nav-controls {
            display: flex;
            align-items: center;
            gap: 8px;
            font-variant-numeric: tabular-nums;
            font-size: 0.9rem;
        }
    `;

    async loadPdf(file: Uint8Array, name: string) {
        this.pdfName = name;
        this.totalPages = await pdfEngine.load(file);
        this.currentPage = 1;
        this.scale = 1.0;
        await this.updateComplete;
        this.renderPage();
    }

    async renderPage() {
        if (!this.canvas) return;
        await pdfEngine.renderPage(this.currentPage, this.canvas, 1.5 * this.scale);
    }

    changePage(offset: number) {
        const newPage = this.currentPage + offset;
        if (newPage >= 1 && newPage <= this.totalPages) {
            this.currentPage = newPage;
            this.renderPage();
        }
    }

    zoom(factor: number) {
        this.scale = Math.max(0.5, Math.min(3.0, this.scale + factor));
        this.renderPage();
    }

    openSignModal() {
        this.isInitialsMode = false;
        this._triggerModal();
    }

    openInitialsModal() {
        this.isInitialsMode = true;
        this._triggerModal();
    }

    _triggerModal() {
        const modal = document.createElement('signature-modal');
        modal.addEventListener('signed', (e: any) => {
            this.signatureUrl = e.detail;
            this.sigPos = {x: 100, y: 100};
        });
        document.body.appendChild(modal);
    }

    startDrag(e: MouseEvent | TouchEvent, type: DragType) {
        e.preventDefault();
        e.stopPropagation();
        const move = (ev: MouseEvent | TouchEvent) => {
            const clientX = 'touches' in ev ? ev.touches[0].clientX : (ev as MouseEvent).clientX;
            const clientY = 'touches' in ev ? ev.touches[0].clientY : (ev as MouseEvent).clientY;
            const rect = this.canvas.getBoundingClientRect();
            const newX = clientX - rect.left;
            const newY = clientY - rect.top;
            if (type === 'sig') this.sigPos = {x: newX, y: newY};
            else if (type === 'date') this.datePos = {x: newX, y: newY};
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
        if (!this.signatureUrl && !this.addedDate) {
            alert(i18n.t('savePdf'));
            return;
        }

        const rect = this.canvas.getBoundingClientRect();

        // Prepare Data Objects
        let sigData = null;
        let dateData = null;

        if (this.signatureUrl) {
            sigData = {
                base64: this.signatureUrl,
                xPct: this.sigPos.x / rect.width,
                yPct: this.sigPos.y / rect.height,
                page: this.currentPage - 1 // 0-indexed
            };
        }

        if (this.addedDate) {
            dateData = {
                dateString: this.addedDate, // Passed from addDateStamp()
                xPct: this.datePos.x / rect.width,
                yPct: this.datePos.y / rect.height,
                page: this.currentPage - 1
            };
        }

        try {
            // Call the new Engine Method
            const finalBytes = await pdfEngine.saveProfessional(sigData, dateData);

            await fileService.savePdf(`signed-${this.pdfName}`, finalBytes);
            alert(i18n.t('savedMsg'));
        } catch (e) {
            console.error(e);
            alert('Error saving PDF. Please try again.');
        }
    }

    // Update addDateStamp to use a cleaner format
    addDateStamp() {
        const now = new Date();
        // Format: "2024-02-03 14:30"
        this.addedDate = now.toISOString().replace('T', ' ').substring(0, 16);
        this.datePos = {x: 150, y: 150};
    }

    toggleLang() {
        const next = i18n.lang === 'en' ? 'ar' : 'en';
        i18n.setLanguage(next);
    }

    render() {
        return html`
            <header>
                <div class="brand">
                    <img src="/icons/icon-192x192.webp" alt="Logo" onerror="this.style.display='none'"/>
                    <span>${i18n.t('appTitle')}</span>
                </div>

                <div style="display:flex; align-items:center">
                    <button class="lang-btn" @click=${this.toggleLang}>
                        ${i18n.lang === 'en' ? 'عربي' : 'English'}
                    </button>
                </div>
            </header>

            <div class="toolbar">
                <button class="primary" @click=${this.openSignModal}>${i18n.t('addSig')}</button>
                <button @click=${this.openInitialsModal}>${i18n.t('addInitials')}</button>
                <button @click=${this.addDateStamp}>${i18n.t('addDate')}</button>

                <div style="flex:1"></div>
                <button class="primary" @click=${this.saveDocument}>${i18n.t('savePdf')}</button>
            </div>

            <div class="toolbar" style="background:#f9fafb; font-size:0.9em; justify-content:center;">
                <button @click=${() => this.zoom(-0.2)}> -</button>
                <div class="nav-controls">
                    <button @click=${() => this.changePage(-1)} ?disabled=${this.currentPage === 1}>${i18n.t('prev')}
                    </button>
                    <span>Page ${this.currentPage} / ${this.totalPages}</span>
                    <button @click=${() => this.changePage(1)} ?disabled=${this.currentPage === this.totalPages}>
                        ${i18n.t('next')}
                    </button>
                </div>
                <button @click=${() => this.zoom(0.2)}> +</button>
            </div>

            <div class="viewport">
                <div class="page-container">
                    <canvas id="pdf-canvas"></canvas>

                    ${this.signatureUrl ? html`
                        <div class="draggable active"
                             style="left: ${this.sigPos.x}px; top: ${this.sigPos.y}px; width: ${this.isInitialsMode ? '100px' : '200px'}"
                             @mousedown=${(e: any) => this.startDrag(e, 'sig')}
                             @touchstart=${(e: any) => this.startDrag(e, 'sig')}>
                            <img src="${this.signatureUrl}"/>
                        </div>
                    ` : ''}

                    ${this.addedDate ? html`
                        <div class="draggable active"
                             style="left: ${this.datePos.x}px; top: ${this.datePos.y}px;"
                             @mousedown=${(e: any) => this.startDrag(e, 'date')}
                             @touchstart=${(e: any) => this.startDrag(e, 'date')}>
                            <span>${this.addedDate}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    connectedCallback() {
        super.connectedCallback();
        // Listen for language changes and re-render
        window.addEventListener('lang-changed', () => this.requestUpdate());
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('lang-changed', () => this.requestUpdate());
    }
}