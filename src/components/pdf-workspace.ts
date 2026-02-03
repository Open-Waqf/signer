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
            overflow: hidden;
        }

        /* --- HEADER --- */

        header {
            background: #fff;
            height: 50px;
            padding: 0 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #e5e7eb;
            z-index: 20;
            flex-shrink: 0;
        }

        .brand {
            font-weight: 600;
            color: #1f2937;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .brand img {
            height: 28px;
            width: 28px;
            border-radius: 6px;
        }

        @media (max-width: 600px) {
            .mobile-hide {
                display: none;
            }
        }

        /* --- TOOLBARS --- */

        .toolbar {
            background: #fff;
            padding: 8px 12px;
            display: flex;
            gap: 8px;
            align-items: center;
            border-bottom: 1px solid #e5e7eb;
            flex-shrink: 0;
            height: 54px;

            /* Horizontal Scroll Logic */
            overflow-x: auto;
            white-space: nowrap;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;

            /* Add padding to right so last item isn't cut off */
            padding-right: 20px;
        }

        .toolbar::-webkit-scrollbar {
            display: none;
        }

        /* Secondary Toolbar (Zoom/Nav) */

        .toolbar-secondary {
            justify-content: space-between;
            background: #f9fafb;
            padding: 4px 12px;
            height: 44px;
        }

        .tool-group {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .page-indicator {
            font-variant-numeric: tabular-nums;
            font-size: 0.9rem;
            color: #555;
            margin: 0 8px;
            font-weight: 500;
        }

        /* --- VIEWPORT --- */

        .viewport {
            flex: 1;
            display: grid;
            place-items: start center;
            overflow: auto;
            padding: 20px;
            background-image: radial-gradient(#d1d5db 1px, transparent 1px);
            background-size: 20px 20px;
            touch-action: pan-x pan-y;
        }

        .page-container {
            position: relative;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
            background: white;
            border-radius: 2px;
            flex-shrink: 0;
        }

        /* --- BUTTON STYLES --- */

        button {
            padding: 8px 14px;
            border-radius: 6px;
            border: 1px solid #e5e7eb;
            background: white;
            cursor: pointer;
            flex-shrink: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        button.primary {
            background: #2563eb;
            color: white;
            border: none;
        }

        /* Mobile Specific Button Tweaks */
        @media (max-width: 600px) {
            .btn-label {
                display: none;
            }

            /* Make buttons squarer and larger for touch */
            button {
                padding: 0;
                width: 40px;
                height: 36px;
                font-size: 1.2rem;
            }

            /* Add gap to toolbar container */
            .toolbar {
                gap: 6px;
            }

            .toolbar-secondary {
                justify-content: center;
                gap: 15px;
            }
        }

        @media (min-width: 601px) {
            .btn-label {
                margin-left: 6px;
            }
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

        .text-content {
            display: block;
            background: transparent;
            white-space: nowrap;
            font-family: 'Helvetica', sans-serif;
            color: black;
            line-height: 1;
            pointer-events: none;
        }

        /* Controls */

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

        /* Style Popup */

        .style-popup {
            position: absolute;
            top: -50px;
            left: 50%;
            transform: translateX(-50%);
            background: #222;
            border-radius: 6px;
            padding: 4px;
            display: flex;
            gap: 6px;
            z-index: 200;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
            font-size: 14px;
            line-height: normal;
        }

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
            color: #fff;
            font-size: 14px;
            font-weight: bold;
            padding: 0;
            width: 32px;
            height: 32px;
        }

        .style-popup button:hover {
            background: #444;
        }

        .style-popup button.active {
            background: white;
            color: black;
            border-color: white;
        }

        .lang-select {
            background: #f9fafb;
            border: 1px solid #ddd;
            padding: 6px 10px;
            border-radius: 6px;
        }
    `;

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('lang-changed', () => this.requestUpdate());
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
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            this.undo();
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
            e.preventDefault();
            this.redo();
        }
    }

    // --- HISTORY ---
    snapshot() {
        const current = JSON.parse(JSON.stringify(this.annotations));
        this.history = [...this.history, current];
        this.future = [];
    }

    undo() {
        if (this.history.length === 0) return;
        this.future = [JSON.parse(JSON.stringify(this.annotations)), ...this.future];
        this.annotations = this.history.pop()!;
        this.selectedId = null;
    }

    redo() {
        if (this.future.length === 0) return;
        this.history = [...this.history, JSON.parse(JSON.stringify(this.annotations))];
        this.annotations = this.future.shift()!;
        this.selectedId = null;
    }

    // --- PDF LOADING ---
    async loadPdf(file: Uint8Array, name: string) {
        this.pdfName = name;
        this.totalPages = await pdfEngine.load(file);
        this.currentPage = 1;
        this.scale = 1.0;
        this.annotations = [];
        this.selectedId = null;
        await this.updateComplete;
        void this.renderPage();
    }

    async renderPage() {
        if (!this.canvas) return;
        await pdfEngine.renderPage(this.currentPage, this.canvas, 1.5 * this.scale);
    }

    changePage(offset: number) {
        const newPage = this.currentPage + offset;
        if (newPage >= 1 && newPage <= this.totalPages) {
            this.currentPage = newPage;
            this.selectedId = null;
            void this.renderPage();
        }
    }

    zoom(factor: number) {
        this.scale = Math.max(0.5, Math.min(3.0, this.scale + factor));
        void this.renderPage();
    }

    // --- ANNOTATIONS ---
    addAnnotation(type: AnnotationType, data: string, aspectRatio = 1) {
        this.snapshot();
        const pageRect = this.container.getBoundingClientRect();
        const viewportRect = this.viewport.getBoundingClientRect();

        const screenCenterX = viewportRect.left + (viewportRect.width / 2);
        const screenCenterY = viewportRect.top + (viewportRect.height / 2);

        let relativeX = screenCenterX - pageRect.left;
        let relativeY = screenCenterY - pageRect.top;

        let xPct = Math.max(0.1, Math.min(0.8, relativeX / pageRect.width));
        let yPct = Math.max(0.1, Math.min(0.8, relativeY / pageRect.height));

        const widthPct = type === 'initials' ? 0.15 : 0.25;

        // FIXED TS6385: Deprecated substr -> slice
        const newAnn: Annotation = {
            id: Math.random().toString(36).slice(2, 11),
            type,
            page: this.currentPage - 1,
            xPct,
            yPct,
            widthPct,
            data,
            aspectRatio
        };

        this.annotations = [...this.annotations, newAnn];
        this.selectedId = newAnn.id;
    }

    addTextAnnotation() {
        // FIXED TS2345: Explicit cast or fallback
        const text = (i18n.t('enterText') as string) || 'Type text';
        this.addAnnotation('date', text, 0.5);
    }

    handleTextEdit(id: string, currentText: string | undefined) {
        // FIXED TS2345: Explicit cast or fallback
        const promptMsg = (i18n.t('editText') as string) || 'Edit Text:';
        const safeCurrentText = currentText || '';
        const newText = prompt(promptMsg, safeCurrentText);

        if (newText !== null && newText.trim() !== "") {
            this.snapshot();
            this.annotations = this.annotations.map(a =>
                a.id === id ? {...a, data: newText} : a
            );
        }
    }

    deleteAnnotation(id: string) {
        this.snapshot();
        this.annotations = this.annotations.filter(a => a.id !== id);
        if (this.selectedId === id) this.selectedId = null;
    }

    updateAnnotation(id: string, updates: Partial<Annotation>) {
        this.annotations = this.annotations.map(a => a.id === id ? {...a, ...updates} : a);
    }

    updateStyle(id: string, style: Partial<Annotation>) {
        this.snapshot();
        this.annotations = this.annotations.map(a => a.id === id ? {...a, ...style} : a);
    }

    // --- INTERACTION ---
    onContainerClick() {
        this.selectedId = null;
    }

    startDrag(e: MouseEvent | TouchEvent, id: string) {
        if (e.target instanceof HTMLElement && (e.target.classList.contains('delete-btn') || e.target.classList.contains('resize-handle') || e.target.closest('.style-popup'))) return;

        this.snapshot();
        e.preventDefault();
        e.stopPropagation();

        this.selectedId = id;
        this.isDragging = true;

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const ann = this.annotations.find(a => a.id === id);
        if (!ann) return;

        const rect = this.container.getBoundingClientRect();
        this.dragOffset = {
            x: clientX - rect.left - (ann.xPct * rect.width),
            y: clientY - rect.top - (ann.yPct * rect.height)
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
        if (!this.selectedId || (!this.isDragging && !this.isResizing)) return;
        e.preventDefault();

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const rect = this.container.getBoundingClientRect();

        if (this.isDragging) {
            let newX = clientX - rect.left - this.dragOffset.x;
            let newY = clientY - rect.top - this.dragOffset.y;
            this.updateAnnotation(this.selectedId, {
                xPct: Math.max(0, Math.min(0.95, newX / rect.width)),
                yPct: Math.max(0, Math.min(0.95, newY / rect.height))
            });
        } else if (this.isResizing) {
            const ann = this.annotations.find(a => a.id === this.selectedId);
            if (!ann) return;
            const mouseRelX = clientX - rect.left;
            const newWidthPx = Math.max(mouseRelX - (ann.xPct * rect.width), rect.width * 0.05);
            this.updateAnnotation(this.selectedId, {widthPct: newWidthPx / rect.width});
        }
    };

    stopInteraction = () => {
        this.isDragging = false;
        this.isResizing = false;
    };

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
                this.addAnnotation(mode, e.detail, img.height / img.width);
            };
        });
        document.body.appendChild(modal);
    }

    addDateStamp() {
        const now = new Date();
        const dateStr = now.toISOString().replace('T', ' ').substring(0, 16);
        this.addAnnotation('date', dateStr, 0.3);
    }

    async saveDocument() {
        this.dispatchEvent(new CustomEvent('set-loading', {detail: true, bubbles: true, composed: true}));
        await new Promise(r => setTimeout(r, 100));
        try {
            const dateStr = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
            const filename = `${this.pdfName.replace('.pdf', '')}_signed_${dateStr}.pdf`;
            const finalBytes = await pdfEngine.saveProfessional(this.annotations);
            await fileService.savePdf(filename, finalBytes);
            // FIXED TS2345
            this.dispatchEvent(new CustomEvent('toast', {
                detail: (i18n.t('savedMsg') as string) || 'Saved',
                bubbles: true,
                composed: true
            }));
        } catch (e) {
            console.error(e);
            this.dispatchEvent(new CustomEvent('toast', {detail: 'Error Saving', bubbles: true, composed: true}));
        } finally {
            this.dispatchEvent(new CustomEvent('set-loading', {detail: false, bubbles: true, composed: true}));
        }
    }

    requestExit() {
        this.dispatchEvent(new CustomEvent('exit-workspace', {bubbles: true, composed: true}));
    }

    handleLangChange(e: Event) {
        i18n.setLanguage((e.target as HTMLSelectElement).value as any);
    }

    render() {
        return html`
            <header>
                <div class="brand">
                    <button @click=${this.requestExit}
                            style="margin-right:10px; padding:0; width:40px; border:none; background:transparent; font-size: 1.5rem;">
                        ←
                    </button>
                    <img src="/icons/icon-192.webp" alt="Open Waqf Signer Logo" onerror="this.style.display='none'"/>
                    <span class="mobile-hide">${i18n.t('appTitle')}</span>
                </div>
                <select class="lang-select" @change=${this.handleLangChange}>
                    <option value="en" ?selected=${i18n.lang === 'en'}>English</option>
                    <option value="ar" ?selected=${i18n.lang === 'ar'}>العربية</option>
                    <option value="fr" ?selected=${i18n.lang === 'fr'}>Français</option>
                </select>
            </header>

            <div class="toolbar">
                <button class="primary" @click=${this.openSignModal} title="${i18n.t('addSig')}">
                    ✒️<span class="btn-label">${i18n.t('addSig')}</span>
                </button>
                <button @click=${this.openInitialsModal} title="${i18n.t('addInitials')}">
                    Aa<span class="btn-label">${i18n.t('addInitials')}</span>
                </button>
                <button @click=${this.addTextAnnotation} title="${i18n.t('addText')}">
                    T<span class="btn-label">${i18n.t('addText')}</span>
                </button>
                <button @click=${this.addDateStamp} title="${i18n.t('addDate')}">
                    📅<span class="btn-label">${i18n.t('addDate')}</span>
                </button>

                <div style="width: 1px; height: 20px; background: #ddd; margin: 0 4px; flex-shrink: 0;"></div>

                <button @click=${this.undo} ?disabled=${this.history.length === 0} title="${i18n.t('undo')}">↩</button>
                <button @click=${this.redo} ?disabled=${this.future.length === 0} title="${i18n.t('redo')}">↪</button>

                <div style="flex:1"></div>

                <button class="primary" @click=${this.saveDocument} title="${i18n.t('savePdf')}">
                    💾<span class="btn-label">${i18n.t('savePdf')}</span>
                </button>
            </div>

            <div class="toolbar toolbar-secondary">
                <div class="tool-group">
                    <button @click=${() => this.zoom(-0.2)}>－</button>
                    <button @click=${() => this.zoom(0.2)}>＋</button>
                </div>

                <div class="tool-group">
                    <button @click=${() => this.changePage(-1)} ?disabled=${this.currentPage === 1}>‹</button>
                    <span class="page-indicator">${this.currentPage} / ${this.totalPages}</span>
                    <button @click=${() => this.changePage(1)} ?disabled=${this.currentPage === this.totalPages}>›
                    </button>
                </div>
            </div>

            <div class="viewport" @mousedown=${this.onContainerClick} @touchstart=${this.onContainerClick}>
                <div class="page-container">
                    <canvas id="pdf-canvas"></canvas>

                    ${this.annotations
                            .filter(ann => ann.page === (this.currentPage - 1))
                            .map(ann => {
                                const isSelected = this.selectedId === ann.id;
                                const boxStyle = `left: ${ann.xPct * 100}%; top: ${ann.yPct * 100}%; width: ${ann.widthPct ? ann.widthPct * 100 + '%' : 'auto'};`;
                                const textStyle = `font-size: ${ann.fontSize || 12}px; font-weight: ${ann.fontWeight || 'normal'};`;

                                return html`
                                    <div class="draggable ${isSelected ? 'selected' : ''}" style="${boxStyle}"
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
                                                <button @click=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.handleTextEdit(ann.id, ann.data);
                                                }}>✎
                                                </button>
                                                <div style="width:1px; background:#444; margin:0 2px;"></div>
                                                <button class="${ann.fontWeight === 'bold' ? 'active' : ''}"
                                                        @click=${(e: Event) => {
                                                            e.stopPropagation();
                                                            this.updateStyle(ann.id, {fontWeight: ann.fontWeight === 'bold' ? 'normal' : 'bold'});
                                                        }}>B
                                                </button>
                                                <button @click=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.updateStyle(ann.id, {fontSize: Math.max(8, (ann.fontSize || 12) - 2)});
                                                }}>A-
                                                </button>
                                                <button @click=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.updateStyle(ann.id, {fontSize: Math.min(60, (ann.fontSize || 12) + 2)});
                                                }}>A+
                                                </button>
                                            </div>
                                        ` : ''}

                                        ${ann.type !== 'date' ? html`
                                            <div class="resize-handle"
                                                 @mousedown=${(e: any) => this.startResize(e, ann.id)}
                                                 @touchstart=${(e: any) => this.startResize(e, ann.id)}></div>
                                            <img src="${ann.data}" alt="User annotation"/>
                                        ` : html`
                                            <span class="text-content" style="${textStyle}"
                                                  @dblclick=${(e: Event) => {
                                                      e.stopPropagation();
                                                      this.handleTextEdit(ann.id, ann.data);
                                                  }}>
                                                ${ann.data}
                                            </span>
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