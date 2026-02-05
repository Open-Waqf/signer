import {css, html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {Capacitor} from '@capacitor/core';
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

    // Proof Modal State
    @state() showProofModal = false;
    @state() lastSavedId: string | null = null;
    @state() lastSavedHash: string | null = null;

    @state() annotations: Annotation[] = [];
    @state() includeAudit = false;

    // Interaction State
    @state() selectedId: string | null = null;
    @state() isDragging = false;
    @state() isResizing = false;
    @state() dragOffset = {x: 0, y: 0};

    // History
    @state() history: Annotation[][] = [];
    @state() future: Annotation[][] = [];

    // Save/share cache
    @state() lastSaved: { filename: string; uri?: string } | null = null;
    private lastSavedBytes: Uint8Array | null = null;
    @state() outputFilename = '';

    @state() isDirty = false;
    private interactionSnapshotTaken = false;
    private interactionChanged = false;

    @query('#pdf-canvas') canvas!: HTMLCanvasElement;
    @query('.page-container') container!: HTMLDivElement;
    @query('.viewport') viewport!: HTMLDivElement;

    private get hasEdits(): boolean {
        return this.annotations.length > 0 || this.includeAudit;
    }

    // 1. ✨ UPDATED IDENTITY TOOL: Auto-Save & Pre-Fill
    addIdentity() {
        // Load saved email
        const savedEmail = localStorage.getItem('user_email') || '';

        const email = prompt(i18n.t('identityPrompt') || 'Enter your email:', savedEmail);

        if (email) {
            // Save for next time
            localStorage.setItem('user_email', email);

            const text = `${i18n.t('signedBy') || 'Signed by'}: ${email}`;
            this.addAnnotation('identity', text, 0);
        }
    }

    sendProofEmail() {
        if (!this.lastSavedId) return;

        // Use translation with replacements
        const subject = (i18n.t('emailSubject') || 'Signature Receipt: {id}').replace('{id}', this.lastSavedId);

        // Replace BOTH {id} and {hash}
        let body = (i18n.t('emailBody') || 'Ref: {id} Hash: {hash}');
        body = body.replace('{id}', this.lastSavedId);
        body = body.replace('{hash}', this.lastSavedHash || 'N/A');

        const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(mailto, '_blank');
        this.showProofModal = false;
    }

    static styles = css`
        :host {
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: #e5e7eb;
            overflow: hidden;
        }

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

        .toolbar {
            background: #fff;
            padding: 8px 12px;
            display: flex;
            gap: 8px;
            align-items: center;
            border-bottom: 1px solid #e5e7eb;
            flex-shrink: 0;
            height: 54px;
            overflow-x: auto;
            white-space: nowrap;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            padding-right: 20px;
        }

        .toolbar::-webkit-scrollbar {
            display: none;
        }

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
            opacity: 1;
        }

        button:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        button.primary {
            background: #2563eb;
            color: white;
            border: none;
        }

        @media (max-width: 600px) {
            .btn-label {
                display: none;
            }

            button {
                padding: 0;
                width: 40px;
                height: 36px;
                font-size: 1.2rem;
            }

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
            font-family: 'WaqfCustom', sans-serif;
            color: black;
            line-height: 1;
            pointer-events: none;
        }

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

        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
            backdrop-filter: blur(2px);
        }

        .modal {
            background: white;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            width: 90%;
            max-width: 500px;
        }
    `;

    private onLangChanged = () => this.requestUpdate();

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('lang-changed', this.onLangChanged);
        window.addEventListener('mousemove', this.handleGlobalMove);
        window.addEventListener('touchmove', this.handleGlobalMove as any, {passive: false});
        window.addEventListener('mouseup', this.stopInteraction);
        window.addEventListener('touchend', this.stopInteraction);
        window.addEventListener('keydown', this.handleKeyboard);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('lang-changed', this.onLangChanged);
        window.removeEventListener('mousemove', this.handleGlobalMove);
        window.removeEventListener('touchmove', this.handleGlobalMove as any);
        window.removeEventListener('mouseup', this.stopInteraction);
        window.removeEventListener('touchend', this.stopInteraction);
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
    };

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
        this.isDirty = true;
    }

    redo() {
        if (this.future.length === 0) return;
        this.history = [...this.history, JSON.parse(JSON.stringify(this.annotations))];
        this.annotations = this.future.shift()!;
        this.selectedId = null;
        this.isDirty = true;
    }

    async loadPdf(file: Uint8Array, name: string) {
        this.pdfName = name;
        this.totalPages = await pdfEngine.load(file);
        this.currentPage = 1;
        this.scale = 1.0;
        this.annotations = [];
        this.selectedId = null;
        this.includeAudit = false;
        this.isDirty = false;
        this.lastSaved = null;
        this.lastSavedBytes = null;
        this.history = [];
        this.future = [];

        const cleanName = name.replace(/_signed_\d{4}-\d{2}-\d{2}.*$/, '').replace(/\.pdf$/i, '');
        this.outputFilename = `${cleanName}_signed_${new Date().toISOString().slice(0, 10)}`;

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

    addAnnotation(type: AnnotationType, data: string, aspectRatio = 1) {
        this.snapshot();
        const pageRect = this.container.getBoundingClientRect();
        const viewportRect = this.viewport.getBoundingClientRect();
        const screenCenterX = viewportRect.left + viewportRect.width / 2;
        const screenCenterY = viewportRect.top + viewportRect.height / 2;
        const relativeX = screenCenterX - pageRect.left;
        const relativeY = screenCenterY - pageRect.top;
        const xPct = Math.max(0.1, Math.min(0.8, relativeX / pageRect.width));
        const yPct = Math.max(0.1, Math.min(0.8, relativeY / pageRect.height));
        const widthPct = type === 'initials' ? 0.15 : 0.25;

        const newAnn: Annotation = {
            id: Math.random().toString(36).slice(2, 11),
            type,
            page: this.currentPage - 1,
            xPct,
            yPct,
            widthPct,
            data,
            aspectRatio,
        };

        this.annotations = [...this.annotations, newAnn];
        this.selectedId = newAnn.id;
        this.isDirty = true;
    }

    addTextAnnotation() {
        const text = (i18n.t('enterText') as string) || 'Type text';
        this.addAnnotation('date', text, 0.5);
    }

    handleTextEdit(id: string, currentText: string | undefined) {
        const promptMsg = (i18n.t('editText') as string) || 'Edit Text:';
        const safeCurrentText = currentText || '';
        const newText = prompt(promptMsg, safeCurrentText);

        if (newText !== null && newText.trim() !== '') {
            this.snapshot();
            this.annotations = this.annotations.map((a) => (a.id === id ? {...a, data: newText} : a));
            this.isDirty = true;
        }
    }

    deleteAnnotation(id: string) {
        this.snapshot();
        this.annotations = this.annotations.filter((a) => a.id !== id);
        if (this.selectedId === id) this.selectedId = null;
        this.isDirty = true;
    }

    updateAnnotation(id: string, updates: Partial<Annotation>) {
        this.annotations = this.annotations.map((a) => (a.id === id ? {...a, ...updates} : a));
    }

    updateStyle(id: string, style: Partial<Annotation>) {
        this.snapshot();
        this.annotations = this.annotations.map((a) => (a.id === id ? {...a, ...style} : a));
        this.isDirty = true;
    }

    onContainerClick() {
        this.selectedId = null;
    }

    startDrag(e: MouseEvent | TouchEvent, id: string) {
        if (e.target instanceof HTMLElement && (e.target.classList.contains('delete-btn') || e.target.classList.contains('resize-handle') || e.target.closest('.style-popup'))) return;
        e.preventDefault();
        e.stopPropagation();
        this.selectedId = id;
        this.isDragging = true;
        this.interactionSnapshotTaken = false;
        this.interactionChanged = false;
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const ann = this.annotations.find((a) => a.id === id);
        if (!ann) return;
        const rect = this.container.getBoundingClientRect();
        this.dragOffset = {
            x: clientX - rect.left - ann.xPct * rect.width,
            y: clientY - rect.top - ann.yPct * rect.height,
        };
    }

    startResize(e: MouseEvent | TouchEvent, id: string) {
        e.preventDefault();
        e.stopPropagation();
        this.isResizing = true;
        this.selectedId = id;
        this.interactionSnapshotTaken = false;
        this.interactionChanged = false;
    }

    handleGlobalMove = (e: MouseEvent | TouchEvent) => {
        if (!this.selectedId || (!this.isDragging && !this.isResizing)) return;
        e.preventDefault();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const rect = this.container.getBoundingClientRect();
        const ann = this.annotations.find((a) => a.id === this.selectedId);
        if (!ann) return;
        const takeSnapshotIfNeeded = () => {
            if (!this.interactionSnapshotTaken) {
                this.snapshot();
                this.interactionSnapshotTaken = true;
            }
        };

        if (this.isDragging) {
            const newX = clientX - rect.left - this.dragOffset.x;
            const newY = clientY - rect.top - this.dragOffset.y;
            const nextXPct = Math.max(0, Math.min(0.95, newX / rect.width));
            const nextYPct = Math.max(0, Math.min(0.95, newY / rect.height));
            if (Math.abs(nextXPct - ann.xPct) > 0.0005 || Math.abs(nextYPct - ann.yPct) > 0.0005) {
                takeSnapshotIfNeeded();
                this.interactionChanged = true;
                this.updateAnnotation(this.selectedId, {xPct: nextXPct, yPct: nextYPct});
            }
        } else if (this.isResizing) {
            const mouseRelX = clientX - rect.left;
            const newWidthPx = Math.max(mouseRelX - ann.xPct * rect.width, rect.width * 0.05);
            const nextWidthPct = newWidthPx / rect.width;
            if (Math.abs(nextWidthPct - (ann.widthPct || 0)) > 0.0005) {
                takeSnapshotIfNeeded();
                this.interactionChanged = true;
                this.updateAnnotation(this.selectedId, {widthPct: nextWidthPct});
            }
        }
    };

    stopInteraction = () => {
        const changed = this.interactionChanged;
        this.isDragging = false;
        this.isResizing = false;
        this.interactionSnapshotTaken = false;
        this.interactionChanged = false;
        if (changed) this.isDirty = true;
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
            img.onload = () => this.addAnnotation(mode, e.detail, img.height / img.width);
        });
        document.body.appendChild(modal);
    }

    addDateStamp() {
        const now = new Date();
        const dateStr = now.toISOString().replace('T', ' ').substring(0, 16);
        this.addAnnotation('date', dateStr, 0.3);
    }

    private toast(msg: string) {
        this.dispatchEvent(new CustomEvent('toast', {detail: msg, bubbles: true, composed: true}));
    }

    public reset() {
        pdfEngine.destroy();
        this.annotations = [];
        this.history = [];
        this.future = [];
        this.lastSaved = null;
        this.lastSavedBytes = null;
        this.pdfName = '';
        this.outputFilename = '';
        this.isDirty = false;
        if (this.canvas) {
            const context = this.canvas.getContext('2d');
            context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.canvas.height = 0;
        }
    }

    async saveDocument(opts?: { silentWeb?: boolean; showToast?: boolean }) {
        const silentWeb = !!opts?.silentWeb;
        const showToast = opts?.showToast ?? true;

        if (!this.hasEdits) {
            this.toast((i18n.t('noChanges') as string) || 'No changes to save.');
            return;
        }

        this.dispatchEvent(new CustomEvent('set-loading', {detail: true, bubbles: true, composed: true}));
        await new Promise((r) => setTimeout(r, 50));

        try {
            const filename = `${this.outputFilename}.pdf`;
            let finalBytes: Uint8Array;
            let finalDocId: string;
            let finalHash: string;

            try {
                const result = await pdfEngine.saveProfessional(this.annotations, this.pdfName, this.includeAudit);
                finalBytes = result.pdfBytes;
                finalDocId = result.docId;
                finalHash = result.finalHash;
            } catch (saveError: any) {
                console.error("PDF Generation Failed:", saveError);
                if (saveError.toString().includes('memory') || saveError.toString().includes('allocation')) {
                    throw new Error('OOM');
                }
                throw saveError;
            }

            this.lastSavedBytes = finalBytes;

            if (!Capacitor.isNativePlatform() && silentWeb) {
                this.lastSaved = {filename};
            } else {
                this.lastSaved = await fileService.savePdf(filename, finalBytes);
            }

            this.isDirty = false;

            const hasIdentity = this.annotations.some(a => a.type === 'identity');

            if (hasIdentity) {
                this.lastSavedId = finalDocId;
                this.lastSavedHash = finalHash;
                this.showProofModal = true;
            } else if (showToast) {
                this.toast(((i18n.t('savedMsg') as string) || 'Saved') as string);
            }
        } catch (e: any) {
            console.error(e);
            if (e.message === 'OOM') {
                this.toast("⚠️ Device out of memory. Try a smaller file.");
            } else {
                this.toast("❌ Error Saving: " + (e.message || "Unknown error"));
            }
        } finally {
            this.dispatchEvent(new CustomEvent('set-loading', {detail: false, bubbles: true, composed: true}));
        }
    }

    handleStampUpload(e: Event) {
        const input = e.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = (evt) => {
                const result = evt.target?.result as string;
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0);
                        const pngData = canvas.toDataURL('image/png');
                        this.addAnnotation('stamp', pngData, img.height / img.width);
                        canvas.remove();
                    }
                };
                img.src = result;
            };
            reader.readAsDataURL(file);
        }
        input.value = '';
    }

    async shareLatest() {
        if (!this.hasEdits) {
            this.toast((i18n.t('noChanges') as string) || 'No changes to share.');
            return;
        }
        if (this.isDirty || !this.lastSavedBytes || !this.lastSaved) {
            await this.saveDocument({silentWeb: !Capacitor.isNativePlatform(), showToast: false});
        }
        if (!this.lastSaved || !this.lastSavedBytes) return;
        await fileService.sharePdf(this.lastSaved, this.lastSavedBytes);
    }

    requestExit() {
        this.dispatchEvent(new CustomEvent('exit-workspace', {bubbles: true, composed: true}));
    }

    handleLangChange(e: Event) {
        i18n.setLanguage((e.target as HTMLSelectElement).value as any);
    }

    handleImageError(e: Event) {
        const img = e.target as HTMLImageElement;
        img.style.display = 'none';
    }

    render() {
        const saveDisabled = !this.pdfName || !this.hasEdits;
        const shareDisabled = !this.pdfName || !this.hasEdits;

        return html`
            <header>
                <div class="brand">
                    <button @click=${this.requestExit}
                            style="margin-right:10px; padding:0; width:40px; border:none; background:transparent; font-size: 1.5rem;">
                        ←
                    </button>
                    <img src="/icons/icon-192.webp" alt="${i18n.t('appTitle')}" @error=${this.handleImageError}/>
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
                <button @click=${this.addIdentity} title="${i18n.t('addIdentity')}">
                    🆔<span class="btn-label">${i18n.t('addIdentity') || 'Identity'}</span>
                </button>
                <button @click=${() => this.shadowRoot?.getElementById('stamp-input')?.click()}
                        title="${i18n.t('addStamp')}">
                    🏢<span class="btn-label">${i18n.t('addStamp')}</span>
                </button>
                <button @click=${this.addDateStamp} title="${i18n.t('addDate')}">
                    📅<span class="btn-label">${i18n.t('addDate')}</span>
                </button>
                <div style="width: 1px; height: 20px; background: #ddd; margin: 0 4px; flex-shrink: 0;"></div>
                <button @click=${this.undo} ?disabled=${this.history.length === 0} title="${i18n.t('undo')}">↩</button>
                <button @click=${this.redo} ?disabled=${this.future.length === 0} title="${i18n.t('redo')}">↪</button>
                <div style="flex:1"></div>
                <label style="display:flex; align-items:center; gap:6px; margin-right:10px; font-size:0.8rem; cursor:pointer;"
                       title="${i18n.t('addAuditPage')}">
                    <input type="checkbox" ?checked=${this.includeAudit} @change=${(e: Event) => {
                        this.includeAudit = (e.target as HTMLInputElement).checked;
                        this.isDirty = true;
                    }}/>
                    <span class="btn-label">${i18n.t('auditTrail')}</span>
                    <span class="mobile-hide" style="font-size:1rem;">📋</span>
                </label>
                <button class="primary" @click=${() => this.saveDocument({silentWeb: false, showToast: true})}
                        ?disabled=${saveDisabled}
                        title=${saveDisabled ? ((i18n.t('noChanges') as string) || 'No changes to save') : (i18n.t('savePdf') as string)}>
                    💾<span class="btn-label">${i18n.t('savePdf')}</span>
                </button>
                <button @click=${this.shareLatest} ?disabled=${shareDisabled}
                        title=${shareDisabled ? ((i18n.t('noChanges') as string) || 'No changes to share') : (i18n.t('sharePdf') as string)}>
                    📤<span class="btn-label">${i18n.t('sharePdf')}</span>
                </button>
            </div>

            <input type="file" id="stamp-input" accept="image/*" style="display: none"
                   @change=${this.handleStampUpload}/>

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
                            .filter((ann) => ann.page === this.currentPage - 1)
                            .map((ann) => {
                                const isSelected = this.selectedId === ann.id;
                                const isText = ann.type === 'date' || ann.type === 'identity';
                                const boxStyle = `left:${ann.xPct * 100}%; top:${ann.yPct * 100}%; width:${isText ? 'auto' : (ann.widthPct ? ann.widthPct * 100 + '%' : 'auto')};`;
                                const textStyle = `font-size:${ann.fontSize || 12}px; font-weight:${ann.fontWeight || 'normal'};`;

                                return html`
                                    <div class="draggable ${isSelected ? 'selected' : ''}" style="${boxStyle}"
                                         @mousedown=${(e: any) => this.startDrag(e, ann.id)}
                                         @touchstart=${(e: any) => this.startDrag(e, ann.id)}
                                    >
                                        <button class="delete-btn"
                                                @mousedown=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.deleteAnnotation(ann.id);
                                                }}
                                                @touchstart=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.deleteAnnotation(ann.id);
                                                }}
                                        >×
                                        </button>

                                        ${isSelected && isText ? html`
                                            <div class="style-popup" @mousedown=${(e: Event) => e.stopPropagation()}
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

                                        ${!isText ? html`
                                            <div class="resize-handle"
                                                 @mousedown=${(e: any) => this.startResize(e, ann.id)}
                                                 @touchstart=${(e: any) => this.startResize(e, ann.id)}></div>
                                            <img src="${ann.data}" alt="User annotation"/>
                                        ` : html`
                                            <span class="text-content" style="${textStyle}" @dblclick=${(e: Event) => {
                                                e.stopPropagation();
                                                this.handleTextEdit(ann.id, ann.data);
                                            }}>
                                            ${ann.data}
                                        </span>
                                        `}
                                    </div>
                                `;
                            })}
                </div>
            </div>

            ${this.showProofModal ? html`
                <div class="modal-overlay">
                    <div class="modal" style="text-align:center;">
                        <h2 style="color:#16a34a; margin-top:0;">
                            ${i18n.t('proveIdentityTitle') || 'Document Saved!'}</h2>
                        <p style="color:#4b5563; font-size:0.95rem;">
                            ${i18n.t('proveIdentityMsg') || 'Send a verification receipt to the receiver:'}
                        </p>

                        <div style="background:#f3f4f6; padding:12px; margin:15px 0; border-radius:8px; text-align:left;">
                            <div style="font-size:0.8rem; color:#6b7280; margin-bottom:4px;">
                                ${i18n.t('internalRefLabel')}
                            </div>
                            <div style="font-family:monospace; font-size:1rem; color:#1f2937; margin-bottom:12px;">
                                ${this.lastSavedId}
                            </div>

                            <div style="font-size:0.8rem; color:#6b7280; margin-bottom:4px;">
                                ${i18n.t('integrityHashLabel')}
                            </div>
                            <div style="font-family:monospace; font-size:0.75rem; color:#1f2937; word-break:break-all; background:#e5e7eb; padding:4px; border-radius:4px;">
                                ${this.lastSavedHash}
                            </div>
                        </div>

                        <button @click=${this.sendProofEmail} class="primary"
                                style="width:100%; margin-bottom:12px; justify-content:center; padding:12px;">
                            ${i18n.t('sendProofEmail') || '📧 Send Proof Email'}
                        </button>

                        <button @click=${() => this.showProofModal = false}
                                style="width:100%; justify-content:center; padding:12px; background:transparent; color:#6b7280; border:1px solid #e5e7eb;">
                            ${i18n.t('justDownload') || 'Close'}
                        </button>
                    </div>
                </div>
            ` : ''}
        `;
    }
}