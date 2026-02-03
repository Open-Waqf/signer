import {css, html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {pdfEngine} from '../lib/pdf-engine';
import {fileService} from '../lib/file-service';
import {i18n} from '../lib/i18n-service';
import {Annotation, AnnotationType} from '../types';
import './signature-modal';

@customElement('pdf-workspace')
export class PdfWorkspace extends LitElement {
    @property() pdfName = '';
    @state() currentPage = 1; // 1-indexed for View
    @state() totalPages = 0;
    @state() scale = 1.0;

    // THE NEW CORE STATE
    @state() annotations: Annotation[] = [];
    @state() activeDragId: string | null = null;
    @state() dragOffset = {x: 0, y: 0};

    @query('#pdf-canvas') canvas!: HTMLCanvasElement;
    @query('.page-container') container!: HTMLDivElement;

    static styles = css`
        /* ... (Keep your existing Header/Toolbar styles) ... */

        :host {
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: #e5e7eb;
        }

        /* ... Copy existing Header/Toolbar CSS here ... */

        header {
            background: #fff;
            height: 60px;
            padding: 0 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #e5e7eb;
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

        .toolbar {
            background: #fff;
            padding: 8px 12px;
            display: flex;
            gap: 8px;
            overflow-x: auto;
            border-bottom: 1px solid #e5e7eb;
        }

        button {
            padding: 8px 14px;
            border-radius: 6px;
            border: 1px solid #e5e7eb;
            background: white;
            cursor: pointer;
        }

        button.primary {
            background: #2563eb;
            color: white;
            border: none;
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
            background-size: 20px 20px;
            direction: ltr !important;
        }

        .page-container {
            position: relative;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
            background: white;
        }

        /* Updated Draggable Style */

        .draggable {
            position: absolute;
            cursor: move;
            border: 2px dashed rgba(37, 99, 235, 0.0); /* Hidden by default */
            transition: border-color 0.2s;
        }

        .draggable:hover, .draggable.active {
            border-color: #2563eb;
            background: rgba(37, 99, 235, 0.05);
        }

        .draggable img {
            width: 100%;
            height: 100%;
            display: block;
            pointer-events: none;
        }

        .draggable span {
            background: rgba(255, 255, 255, 0.8);
            padding: 4px 8px;
            font-family: monospace;
            font-weight: bold;
            font-size: 14px;
            white-space: nowrap;
            border: 1px solid #ccc;
        }

        .delete-btn {
            position: absolute;
            top: -10px;
            right: -10px;
            width: 20px;
            height: 20px;
            background: red;
            color: white;
            border-radius: 50%;
            border: none;
            display: none;
            justify-content: center;
            align-items: center;
            font-size: 12px;
            cursor: pointer;
        }

        .draggable:hover .delete-btn {
            display: flex;
        }
    `;

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('lang-changed', () => this.requestUpdate());
        // Global mouseup to stop dragging anywhere
        window.addEventListener('mouseup', () => this.stopDrag());
        window.addEventListener('touchend', () => this.stopDrag());
    }

    // ... (Keep loadPdf, renderPage, changePage, zoom logic same as before) ...
    async loadPdf(file: Uint8Array, name: string) {
        this.pdfName = name;
        this.totalPages = await pdfEngine.load(file);
        this.currentPage = 1;
        this.scale = 1.0;
        this.annotations = []; // Reset on new file
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

    // --- ANNOTATION HELPERS ---

    @query('.viewport') viewport!: HTMLDivElement; // Add this query at the top

    addAnnotation(type: AnnotationType, data: string, aspectRatio = 1) {
        // 1. Get the Page's bounding box (The total drawing area)
        const pageRect = this.container.getBoundingClientRect();

        // 2. Get the Viewport's bounding box (The scrollable window)
        const viewportRect = this.viewport.getBoundingClientRect();

        // 3. Calculate the center point of the USER'S SCREEN
        const screenCenterX = viewportRect.left + (viewportRect.width / 2);
        const screenCenterY = viewportRect.top + (viewportRect.height / 2);

        // 4. Map screen coordinates to Page coordinates
        // (We subtract the page's offset to find the relative position)
        let relativeX = screenCenterX - pageRect.left;
        let relativeY = screenCenterY - pageRect.top;

        // 5. Convert to Percentage (0.0 to 1.0)
        let xPct = relativeX / pageRect.width;
        let yPct = relativeY / pageRect.height;

        // 6. Clamp values (ensure it doesn't spawn off-page if you are looking at the gray background)
        // We stick it to the edge if the user is scrolled way off
        xPct = Math.max(0.1, Math.min(0.9, xPct));
        yPct = Math.max(0.1, Math.min(0.9, yPct));

        // Default size logic
        const widthPct = type === 'initials' ? 0.15 : 0.25;

        const newAnn: Annotation = {
            id: Math.random().toString(36).substr(2, 9),
            type,
            page: this.currentPage - 1,
            xPct,  // <--- Uses calculated visible center
            yPct,  // <--- Uses calculated visible center
            widthPct,
            data,
            aspectRatio
        };

        this.annotations = [...this.annotations, newAnn];
    }

    deleteAnnotation(id: string) {
        this.annotations = this.annotations.filter(a => a.id !== id);
    }

    // --- MODAL HANDLERS ---

    openSignModal() {
        this._triggerModal('signature');
    }

    openInitialsModal() {
        this._triggerModal('initials');
    }

    _triggerModal(mode: 'signature' | 'initials') {
        const modal = document.createElement('signature-modal') as any;
        modal.mode = mode;
        modal.addEventListener('signed', (e: any) => {
            const img = new Image();
            img.src = e.detail;
            img.onload = () => {
                const ratio = img.height / img.width;
                this.addAnnotation(mode, e.detail, ratio);
            };
        });
        document.body.appendChild(modal);
    }

    addDateStamp() {
        const now = new Date();
        const dateStr = now.toISOString().replace('T', ' ').substring(0, 16);
        this.addAnnotation('date', dateStr, 0.3); // Aspect ratio for date box approx
    }

    // --- DRAG LOGIC (Percentages!) ---

    startDrag(e: MouseEvent | TouchEvent, id: string) {
        e.preventDefault();
        e.stopPropagation();

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

        // Find the annotation being dragged
        const ann = this.annotations.find(a => a.id === id);
        if (!ann) return;

        // Get Container Dimensions
        const rect = this.container.getBoundingClientRect();

        // Calculate current pixel position of the element
        const currentPxX = ann.xPct * rect.width;
        const currentPxY = ann.yPct * rect.height;

        // Calculate offset so it doesn't snap to top-left corner
        this.dragOffset = {
            x: clientX - rect.left - currentPxX,
            y: clientY - rect.top - currentPxY
        };

        this.activeDragId = id;

        // Listeners for move
        window.addEventListener('mousemove', this.handleMove);
        window.addEventListener('touchmove', this.handleMove, {passive: false});
    }

    handleMove = (e: MouseEvent | TouchEvent) => {
        if (!this.activeDragId) return;
        e.preventDefault();

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const rect = this.container.getBoundingClientRect();

        // Calculate new Position in Pixels
        let newX = clientX - rect.left - this.dragOffset.x;
        let newY = clientY - rect.top - this.dragOffset.y;

        // Clamp to boundaries
        const ann = this.annotations.find(a => a.id === this.activeDragId);
        if (!ann) return;

        // Convert back to Percentage immediately
        // Note: We clamp 0.0 to 1.0 (roughly) to keep inside page
        const newXPct = Math.max(0, Math.min(1, newX / rect.width));
        const newYPct = Math.max(0, Math.min(1, newY / rect.height));

        // Update State (Lit will re-render, creating the movement)
        this.annotations = this.annotations.map(a =>
            a.id === this.activeDragId
                ? {...a, xPct: newXPct, yPct: newYPct}
                : a
        );
    }

    stopDrag() {
        if (this.activeDragId) {
            this.activeDragId = null;
            window.removeEventListener('mousemove', this.handleMove);
            window.removeEventListener('touchmove', this.handleMove);
        }
    }

    // --- SAVE ---
    async saveDocument() {
        if (this.annotations.length === 0) {
            this.dispatchEvent(new CustomEvent('toast', {detail: i18n.t('savePdf'), bubbles: true, composed: true}));
            return;
        }

        this.dispatchEvent(new CustomEvent('set-loading', {detail: true, bubbles: true, composed: true}));
        await new Promise(r => setTimeout(r, 100));

        try {
            const now = new Date();
            const dateStr = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
            const cleanName = this.pdfName.replace('.pdf', '');
            const filename = `${cleanName}_signed_${dateStr}.pdf`;

            // Pass the WHOLE array to the engine
            const finalBytes = await pdfEngine.saveProfessional(this.annotations);
            await fileService.savePdf(filename, finalBytes);

            this.dispatchEvent(new CustomEvent('toast', {detail: i18n.t('savedMsg'), bubbles: true, composed: true}));
        } catch (e) {
            console.error(e);
            this.dispatchEvent(new CustomEvent('toast', {detail: 'Error Saving PDF', bubbles: true, composed: true}));
        } finally {
            this.dispatchEvent(new CustomEvent('set-loading', {detail: false, bubbles: true, composed: true}));
        }
    }

    // --- RENDER ---
    render() {
        return html`
            <header>
                <div class="brand"><span>${i18n.t('appTitle')}</span></div>
            </header>

            <div class="toolbar">
                <button class="primary" @click=${this.openSignModal}>${i18n.t('addSig')}</button>
                <button @click=${this.openInitialsModal}>${i18n.t('addInitials')}</button>
                <button @click=${this.addDateStamp}>${i18n.t('addDate')}</button>
                <div style="flex:1"></div>
                <button class="primary" @click=${this.saveDocument}>${i18n.t('savePdf')}</button>
            </div>

            <div class="toolbar" style="justify-content:center;">
                <button @click=${() => this.zoom(-0.2)}> -</button>
                <div class="nav-controls" style="margin: 0 10px;">
                    <button @click=${() => this.changePage(-1)} ?disabled=${this.currentPage === 1}>${i18n.t('prev')}
                    </button>
                    <span style="margin: 0 8px;">Page ${this.currentPage} / ${this.totalPages}</span>
                    <button @click=${() => this.changePage(1)} ?disabled=${this.currentPage === this.totalPages}>
                        ${i18n.t('next')}
                    </button>
                </div>
                <button @click=${() => this.zoom(0.2)}> +</button>
            </div>

            <div class="viewport">
                <div class="page-container">
                    <canvas id="pdf-canvas"></canvas>

                    ${this.annotations
                            .filter(ann => ann.page === (this.currentPage - 1)) // ONLY SHOW CURRENT PAGE
                            .map(ann => {
                                // Convert % to PX for rendering on top of the current canvas size
                                // We assume 'container' (page-container) matches the canvas size
                                // Note: During first render, container might be null, so fallback needed
                                // But Lit usually handles this well.

                                // We use CSS % for positioning to be inherently responsive!
                                // Left: xPct * 100%, Top: yPct * 100%
                                const style = `
                left: ${ann.xPct * 100}%; 
                top: ${ann.yPct * 100}%;
                width: ${ann.widthPct ? ann.widthPct * 100 + '%' : 'auto'};
              `;

                                return html`
                                    <div class="draggable ${this.activeDragId === ann.id ? 'active' : ''}"
                                         style="${style}"
                                         @mousedown=${(e: any) => this.startDrag(e, ann.id)}
                                         @touchstart=${(e: any) => this.startDrag(e, ann.id)}>

                                        <button class="delete-btn"
                                                @mousedown=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.deleteAnnotation(ann.id);
                                                }}
                                                @touchstart=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.deleteAnnotation(ann.id);
                                                }}>
                                            ×
                                        </button>

                                        ${ann.type === 'date'
                                                ? html`<span>${ann.data}</span>`
                                                : html`<img src="${ann.data}"/>`
                                        }
                                    </div>
                                `;
                            })
                    }
                </div>
            </div>
        `;
    }
}