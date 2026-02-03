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
    @state() currentPage = 1;
    @state() totalPages = 0;
    @state() scale = 1.0;

    @state() annotations: Annotation[] = [];

    // Interaction State
    @state() selectedId: string | null = null;
    @state() isDragging = false;
    @state() isResizing = false;
    @state() dragOffset = {x: 0, y: 0};

    // --- HISTORY STATE ---
    @state() history: Annotation[][] = [];
    @state() future: Annotation[][] = [];

    @query('#pdf-canvas') canvas!: HTMLCanvasElement;
    @query('.page-container') container!: HTMLDivElement;
    @query('.viewport') viewport!: HTMLDivElement;

    static styles = css`
        :host {
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: #e5e7eb;
        }

        header {
            background: #fff;
            height: 60px;
            padding: 0 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #e5e7eb;
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
            background-size: 20px 20px;
            direction: ltr !important;
        }

        .page-container {
            position: relative;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
            background: white;
            border-radius: 2px;
        }

        /* --- ANNOTATIONS --- */

        .draggable {
            position: absolute;
            cursor: grab;
            user-select: none;
            border: 1px dashed transparent;
        }

        .draggable.selected {
            border: 1px solid #2563eb;
            background: rgba(37, 99, 235, 0.05);
            z-index: 100;
        }

        .draggable img {
            width: 100%;
            height: 100%;
            display: block;
            pointer-events: none;
        }

        /* The Date Text Span */

        .text-content {
            display: block;
            background: transparent;
            white-space: nowrap;
            font-family: 'Helvetica', sans-serif;
            color: black;
            line-height: 1; /* Fix vertical alignment */
            pointer-events: none; /* Let clicks pass to the container */
        }

        /* --- CONTROLS --- */

        .delete-btn {
            position: absolute;
            top: -12px;
            right: -12px;
            width: 24px;
            height: 24px;
            background: white;
            color: #ef4444;
            border: 1px solid #e5e7eb;
            border-radius: 50%;
            display: none;
            justify-content: center;
            align-items: center;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            font-size: 16px;
        }

        .draggable.selected .delete-btn {
            display: flex;
        }

        .resize-handle {
            position: absolute;
            bottom: -6px;
            right: -6px;
            width: 12px;
            height: 12px;
            background: #2563eb;
            border: 2px solid white;
            border-radius: 50%;
            cursor: nwse-resize;
            display: none;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .draggable.selected .resize-handle {
            display: block;
        }

        /* --- STYLE POPUP (Fixed) --- */

        .style-popup {
            position: absolute;
            top: -45px;
            left: 50%;
            transform: translateX(-50%);
            background: #222; /* Darker background */
            border-radius: 6px;
            padding: 4px;
            display: flex;
            gap: 4px;
            z-index: 200;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
            /* Reset inherited fonts */
            font-size: 14px;
            line-height: normal;
        }

        /* Triangle Arrow */

        .style-popup::after {
            content: '';
            position: absolute;
            bottom: -5px;
            left: 50%;
            transform: translateX(-50%);
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 5px solid #222;
        }

        .style-popup button {
            background: transparent;
            border: 1px solid #444;
            color: #fff; /* White Text */
            font-size: 12px;
            font-weight: bold;
            padding: 4px 8px;
            min-width: 30px;
            cursor: pointer;
            border-radius: 4px;
        }

        .style-popup button:hover {
            background: #444;
        }

        .style-popup button.active {
            background: white;
            color: black;
            border-color: white;
        }

        /* Nav & Shared Controls */

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

        .lang-select {
            background: #f9fafb;
            border: 1px solid #ddd;
            padding: 6px 10px;
            border-radius: 6px;
        }

        .hidden {
            display: none;
        }
    `;

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('lang-changed', () => this.requestUpdate());

        // Global listeners for Drag/Resize end
        window.addEventListener('mousemove', this.handleGlobalMove);
        window.addEventListener('touchmove', this.handleGlobalMove, {passive: false});
        window.addEventListener('mouseup', this.stopInteraction);
        window.addEventListener('touchend', this.stopInteraction);
        window.addEventListener('keydown', this.handleKeyboard);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (e: KeyboardEvent) => {
        // Ctrl+Z or Cmd+Z
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            this.undo();
        }
        // Ctrl+Y or Cmd+Y or Ctrl+Shift+Z
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
            e.preventDefault();
            this.redo();
        }
    }

    // --- HISTORY LOGIC ---

    snapshot() {
        // Save current state to history
        // JSON parse/stringify is a simple way to deep clone the array
        const current = JSON.parse(JSON.stringify(this.annotations));
        this.history = [...this.history, current];
        this.future = []; // Clear future when new action happens
    }

    undo() {
        if (this.history.length === 0) return;

        // Save current to future
        const current = JSON.parse(JSON.stringify(this.annotations));
        this.future = [current, ...this.future];

        // Pop from history
        const previous = this.history[this.history.length - 1];
        this.history = this.history.slice(0, -1);

        this.annotations = previous;
        this.selectedId = null; // Deselect to avoid ghost UI
    }

    redo() {
        if (this.future.length === 0) return;

        // Save current to history
        const current = JSON.parse(JSON.stringify(this.annotations));
        this.history = [...this.history, current];

        // Pop from future
        const next = this.future[0];
        this.future = this.future.slice(1);

        this.annotations = next;
        this.selectedId = null;
    }

    async loadPdf(file: Uint8Array, name: string) {
        this.pdfName = name;
        this.totalPages = await pdfEngine.load(file);
        this.currentPage = 1;
        this.scale = 1.0;
        this.annotations = [];
        this.selectedId = null;
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
            this.selectedId = null; // Deselect on page turn
            this.renderPage();
        }
    }

    zoom(factor: number) {
        this.scale = Math.max(0.5, Math.min(3.0, this.scale + factor));
        this.renderPage();
    }

    // --- ANNOTATION HELPERS ---

    addAnnotation(type: AnnotationType, data: string, aspectRatio = 1) {
        this.snapshot();
        // Smart Placement: Center on Screen
        const pageRect = this.container.getBoundingClientRect();
        const viewportRect = this.viewport.getBoundingClientRect();

        const screenCenterX = viewportRect.left + (viewportRect.width / 2);
        const screenCenterY = viewportRect.top + (viewportRect.height / 2);

        let relativeX = screenCenterX - pageRect.left;
        let relativeY = screenCenterY - pageRect.top;

        let xPct = Math.max(0.1, Math.min(0.8, relativeX / pageRect.width));
        let yPct = Math.max(0.1, Math.min(0.8, relativeY / pageRect.height));

        const widthPct = type === 'initials' ? 0.15 : 0.25;

        const newAnn: Annotation = {
            id: Math.random().toString(36).substr(2, 9),
            type,
            page: this.currentPage - 1,
            xPct,
            yPct,
            widthPct,
            data,
            aspectRatio
        };

        this.annotations = [...this.annotations, newAnn];
        this.selectedId = newAnn.id; // Auto-select new item
    }

    deleteAnnotation(id: string) {
        this.snapshot();
        this.annotations = this.annotations.filter(a => a.id !== id);
        if (this.selectedId === id) this.selectedId = null;
    }

    selectAnnotation(e: Event, id: string) {
        e.stopPropagation(); // Stop click from bubbling to container
        this.selectedId = id;
    }

    onContainerClick() {
        // Clicked empty space? Deselect.
        this.selectedId = null;
    }

    // --- INTERACTION LOGIC (Drag & Resize) ---

    startDrag(e: MouseEvent | TouchEvent, id: string) {
        if (e.target instanceof HTMLElement && e.target.classList.contains('delete-btn')) return;
        if (e.target instanceof HTMLElement && e.target.classList.contains('resize-handle')) return;

        this.snapshot();
        e.preventDefault();
        e.stopPropagation();

        this.selectedId = id; // Select on drag start
        this.isDragging = true;

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

        const ann = this.annotations.find(a => a.id === id);
        if (!ann) return;

        const rect = this.container.getBoundingClientRect();
        const currentPxX = ann.xPct * rect.width;
        const currentPxY = ann.yPct * rect.height;

        this.dragOffset = {
            x: clientX - rect.left - currentPxX,
            y: clientY - rect.top - currentPxY
        };
    }

    startResize(e: MouseEvent | TouchEvent, id: string) {
        this.snapshot();
        e.preventDefault();
        e.stopPropagation();
        this.isResizing = true;
        this.selectedId = id;
    }

    handleGlobalMove = (e: MouseEvent | TouchEvent) => {
        if (!this.selectedId) return;
        if (!this.isDragging && !this.isResizing) return;

        e.preventDefault(); // Stop scrolling

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const rect = this.container.getBoundingClientRect();

        if (this.isDragging) {
            // --- DRAG LOGIC ---
            let newX = clientX - rect.left - this.dragOffset.x;
            let newY = clientY - rect.top - this.dragOffset.y;

            // Clamp to page
            const newXPct = Math.max(0, Math.min(0.95, newX / rect.width));
            const newYPct = Math.max(0, Math.min(0.95, newY / rect.height));

            this.updateAnnotation(this.selectedId, {xPct: newXPct, yPct: newYPct});
        } else if (this.isResizing) {
            // --- RESIZE LOGIC ---
            const ann = this.annotations.find(a => a.id === this.selectedId);
            if (!ann) return;

            // Calculate new width based on mouse position relative to object Left
            const objectLeftPx = ann.xPct * rect.width;
            const mouseRelX = clientX - rect.left;

            let newWidthPx = mouseRelX - objectLeftPx;

            // Min width constraint (e.g. 5% of page)
            newWidthPx = Math.max(newWidthPx, rect.width * 0.05);

            const newWidthPct = newWidthPx / rect.width;

            this.updateAnnotation(this.selectedId, {widthPct: newWidthPct});
        }
    };

    stopInteraction = () => {
        this.isDragging = false;
        this.isResizing = false;
    };

    updateAnnotation(id: string, updates: Partial<Annotation>) {
        this.annotations = this.annotations.map(a => a.id === id ? {...a, ...updates} : a);
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
        this.addAnnotation('date', dateStr, 0.3);
    }

    handleLangChange(e: Event) {
        const select = e.target as HTMLSelectElement;
        i18n.setLanguage(select.value as any);
    }

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

    // Helper to dispatch exit event
    requestExit() {
        this.dispatchEvent(new CustomEvent('exit-workspace', {
            bubbles: true,
            composed: true
        }));
    }

    updateStyle(id: string, style: Partial<Annotation>) {
        this.snapshot(); // Add to Undo History
        this.annotations = this.annotations.map(a =>
            a.id === id ? {...a, ...style} : a
        );
    }

    render() {
        return html`
            <header>
                <div class="brand">
                    <button @click=${this.requestExit}
                            style="margin-right:10px; padding: 4px 8px; border:none; background:transparent; font-size: 1.2rem; cursor: pointer;">
                        ←
                    </button>
                    <img src="/icons/icon-192.webp" alt="Logo" onerror="this.style.display='none'"/>
                    <span class="mobile-hide">${i18n.t('appTitle')}</span>
                </div>
                <select class="lang-select" @change=${this.handleLangChange}>
                    <option value="en" ?selected=${i18n.lang === 'en'}>English</option>
                    <option value="ar" ?selected=${i18n.lang === 'ar'}>العربية</option>
                    <option value="fr" ?selected=${i18n.lang === 'fr'}>Français</option>
                </select>
            </header>

            <div class="toolbar">
                <button class="primary" @click=${this.openSignModal}>${i18n.t('addSig')}</button>
                <button @click=${this.openInitialsModal}>${i18n.t('addInitials')}</button>
                <button @click=${this.addDateStamp}>${i18n.t('addDate')}</button>
                <div style="width: 1px; height: 20px; background: #ddd; margin: 0 4px;"></div>
                <button @click=${this.undo} ?disabled=${this.history.length === 0} title="${i18n.t('undo')}">↩</button>
                <button @click=${this.redo} ?disabled=${this.future.length === 0} title="${i18n.t('redo')}">↪</button>
                <div style="flex:1"></div>
                <button class="primary" @click=${this.saveDocument}>${i18n.t('savePdf')}</button>
            </div>

            <div class="toolbar" style="justify-content:center;">
                <button @click=${() => this.zoom(-0.2)}> -</button>
                <span style="margin: 0 15px;">Page ${this.currentPage} / ${this.totalPages}</span>
                <button @click=${() => this.zoom(0.2)}> +</button>
                <div style="width:10px"></div>
                <button @click=${() => this.changePage(-1)} ?disabled=${this.currentPage === 1}>${i18n.t('prev')}
                </button>
                <button @click=${() => this.changePage(1)} ?disabled=${this.currentPage === this.totalPages}>
                    ${i18n.t('next')}
                </button>
            </div>

            <div class="viewport" @mousedown=${this.onContainerClick} @touchstart=${this.onContainerClick}>
                <div class="page-container">
                    <canvas id="pdf-canvas"></canvas>

                    ${this.annotations
                            .filter(ann => ann.page === (this.currentPage - 1))
                            .map(ann => {
                                const isSelected = this.selectedId === ann.id;

                                // 1. CONTAINER STYLE (Position Only)
                                const boxStyle = `
                                    left: ${ann.xPct * 100}%; 
                                    top: ${ann.yPct * 100}%;
                                    width: ${ann.widthPct ? ann.widthPct * 100 + '%' : 'auto'};
                                `;

                                // 2. TEXT STYLE (Font Appearance Only)
                                const textStyle = `
                                    font-size: ${ann.fontSize || 12}px; 
                                    font-weight: ${ann.fontWeight || 'normal'};
                                `;

                                return html`
                                    <div class="draggable ${isSelected ? 'selected' : ''}"
                                         style="${boxStyle}"
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

                                        ${isSelected && ann.type === 'date' ? html`
                                            <div class="style-popup"
                                                 @mousedown=${(e: Event) => e.stopPropagation()}
                                                 @touchstart=${(e: Event) => e.stopPropagation()}>

                                                <button class="${ann.fontWeight === 'bold' ? 'active' : ''}"
                                                        @click=${(e: Event) => {
                                                            e.stopPropagation(); // Stop drag start
                                                            this.updateStyle(ann.id, {fontWeight: ann.fontWeight === 'bold' ? 'normal' : 'bold'});
                                                        }}>
                                                    B
                                                </button>

                                                <button @click=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.updateStyle(ann.id, {fontSize: Math.max(8, (ann.fontSize || 12) - 2)});
                                                }}>
                                                    A-
                                                </button>

                                                <button @click=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.updateStyle(ann.id, {fontSize: Math.min(60, (ann.fontSize || 12) + 2)});
                                                }}>
                                                    A+
                                                </button>
                                            </div>
                                        ` : ''}

                                        ${ann.type !== 'date' ? html`
                                            <div class="resize-handle"
                                                 @mousedown=${(e: any) => this.startResize(e, ann.id)}
                                                 @touchstart=${(e: any) => this.startResize(e, ann.id)}>
                                            </div>
                                            <img src="${ann.data}"/>
                                        ` : html`
                                            <span class="text-content" style="${textStyle}">${ann.data}</span>
                                        `}
                                    </div>
                                `;
                            })
                    }
                </div>
            </div>
        `;
    }
}