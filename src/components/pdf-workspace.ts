import {css, html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {Capacitor} from '@capacitor/core';
import {pdfEngine} from '../lib/pdf-engine';
import {fileService} from '../lib/file-service';
import {i18n} from '../lib/i18n-service';
import {Annotation, AnnotationType} from '../types';
import './signature-modal';

const ICONS = {
    sign: html`
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>`,
    text: html`
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 7 4 4 20 4 20 7"/>
            <line x1="9" y1="20" x2="15" y2="20"/>
            <line x1="12" y1="4" x2="12" y2="20"/>
        </svg>`,
    identity: html`
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2"/>
            <circle cx="8" cy="12" r="3"/>
            <line x1="14" y1="10" x2="19" y2="10"/>
            <line x1="14" y1="14" x2="19" y2="14"/>
        </svg>`,
    stamp: html`
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5"/>
            <path d="M8 10a4 4 0 0 1 8 0v4.5H8z"/>
            <path d="M12 2v4"/>
        </svg>`,
    date: html`
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>`,
    footer: html`
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>`,
    audit: html`
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
        </svg>`,
    save: html`
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
        </svg>`,
    share: html`
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
        </svg>`
};

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
    @state() includeFooter = false; // Controls the "Page ID" footer

    @state() validationMsg: string | null = null;

    @state() annotations: Annotation[] = [];
    @state() includeAudit = false;

    @state() showHandoverModal = false;
    @state() handoverHashInput = '';
    @state() handoverResult: 'idle' | 'success' | 'fail' = 'idle';
    @state() detectedRefId = '';

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

    private loadedBytes: Uint8Array | null = null;

    @state() isVerified = false;

    @query('#pdf-canvas') canvas!: HTMLCanvasElement;
    @query('.page-container') container!: HTMLDivElement;
    @query('.viewport') viewport!: HTMLDivElement;

    @state() guideX: number | null = null;
    @state() guideY: number | null = null;

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
        let body = (i18n.t('emailBody') || '');
        body = body.replace('{id}', this.lastSavedId);
        body = body.replace('{hash}', this.lastSavedHash || 'N/A'); // Adds the hash

        const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(mailto, '_blank');
        this.showProofModal = false;
    }

    copyHash() {
        if (this.lastSavedHash) {
            navigator.clipboard.writeText(this.lastSavedHash);
            this.toast((i18n.t('linkCopied') as string) || 'Copied to clipboard!');
        }
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

        button.toggle {
            background: white;
            color: #6b7280; /* Gray text */
            border: 1px solid #e5e7eb;
            transition: all 0.2s ease;
        }

        button.toggle.active {
            background: #eff6ff; /* Light Blue Background */
            color: #2563eb; /* Blue Text */
            border: 1px solid #2563eb; /* Blue Border */
            font-weight: 600;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
        }

        button.toggle:hover {
            background: #f9fafb;
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
                width: 44px;
                height: 44px;
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
            height: auto;
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
        this.loadedBytes = file;
        this.validationMsg = null;
        this.lastSavedId = null;
        this.lastSavedHash = null;
        this.totalPages = await pdfEngine.load(file);
        const existingID = await pdfEngine.readMetadataID(file);
        if (existingID) {
            this.includeAudit = true;
            this.toast(i18n.t('previousSigDetected'));

            this.detectedRefId = existingID;
            this.handoverHashInput = '';
            this.handoverResult = 'idle';
            this.showHandoverModal = true;
        } else {
            this.includeAudit = false;
        }
        this.currentPage = 1;
        this.scale = 1.0;
        this.annotations = [];
        this.selectedId = null;
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

    async checkHandover() {
        if (!this.loadedBytes) return;
        const input = this.handoverHashInput.replace(/[\s\n-]/g, '').trim().toLowerCase();
        const actual = await pdfEngine.getFileHash(this.loadedBytes);

        if (input === actual.toLowerCase()) {
            this.handoverResult = 'success';
            this.isVerified = true;
            setTimeout(() => {
                this.showHandoverModal = false;
                this.toast(i18n.t('integrityVerified'));
            }, 1500);
        } else {
            this.handoverResult = 'fail';
            this.isVerified = false;
        }
    }

    async renderPage() {
        if (!this.canvas) return;
        const renderScale = Math.min(3.0, 1.5 * this.scale);
        await pdfEngine.renderPage(this.currentPage, this.canvas, renderScale);
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

    applyToAllPages(id: string) {
        this.snapshot();
        const sourceAnn = this.annotations.find(a => a.id === id);
        if (!sourceAnn) return;

        const newAnnotations: Annotation[] = [];

        for (let p = 0; p < this.totalPages; p++) {
            if (p === sourceAnn.page) continue;

            // Check if an identical annotation already exists here to prevent stacking
            const exists = this.annotations.some(a =>
                a.page === p &&
                a.type === sourceAnn.type &&
                Math.abs(a.xPct - sourceAnn.xPct) < 0.01 &&
                Math.abs(a.yPct - sourceAnn.yPct) < 0.01 &&
                a.data === sourceAnn.data
            );

            if (!exists) {
                newAnnotations.push({
                    ...sourceAnn,
                    id: Math.random().toString(36).slice(2, 11),
                    page: p
                });
            }
        }

        if (newAnnotations.length > 0) {
            this.annotations = [...this.annotations, ...newAnnotations];
            this.isDirty = true;
            const msg = i18n.t('appliedToPages').replace('{count}', newAnnotations.length.toString());
            this.toast(msg);
        }
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

            let nextXPct = Math.max(0, Math.min(0.95, newX / rect.width));
            let nextYPct = Math.max(0, Math.min(0.95, newY / rect.height));

            let visualWidthPct = ann.widthPct || 0.1;
            let visualHeightPct = visualWidthPct * (ann.aspectRatio || 1);

            const contentEl = this.shadowRoot?.querySelector('.draggable.selected img, .draggable.selected .text-content') as HTMLElement;
            if (contentEl) {
                visualWidthPct = contentEl.offsetWidth / rect.width;
                visualHeightPct = contentEl.offsetHeight / rect.height;
            }

            const centerX = nextXPct + (visualWidthPct / 2);
            const centerY = nextYPct + (visualHeightPct / 2);

            this.guideX = null;
            this.guideY = null;

            // Snap to horizontal center
            if (Math.abs(centerX - 0.5) < 0.02) {
                nextXPct = 0.5 - (visualWidthPct / 2);
                this.guideX = 0.5;
            }

            // Snap to vertical center
            if (Math.abs(centerY - 0.5) < 0.02) {
                nextYPct = 0.5 - (visualHeightPct / 2);
                this.guideY = 0.5;
            }

            if (Math.abs(nextXPct - ann.xPct) > 0.0005 || Math.abs(nextYPct - ann.yPct) > 0.0005) {
                takeSnapshotIfNeeded();
                this.interactionChanged = true;
                this.updateAnnotation(this.selectedId, {xPct: nextXPct, yPct: nextYPct});
            }
        } else if (this.isResizing) {
            const mouseRelX = clientX - rect.left;
            const newWidthPx = Math.max(mouseRelX - ann.xPct * rect.width, rect.width * 0.05);
            const nextWidthPct = Math.min(0.8, newWidthPx / rect.width);
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
        this.guideX = null;
        this.guideY = null;
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
                const result = await pdfEngine.saveProfessional(
                    this.annotations, this.pdfName, this.includeAudit,
                    this.includeFooter,
                    this.validationMsg);
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
                if (Capacitor.isNativePlatform() && showToast) {
                    setTimeout(() => {
                        this.toast(i18n.t('exportingFile'));
                        fileService.sharePdf(this.lastSaved!, this.lastSavedBytes!);
                    }, 200); // Short delay to ensure UI is ready
                }
            }

            this.isDirty = false;

            this.lastSavedId = finalDocId;
            this.lastSavedHash = finalHash;
            this.showProofModal = true;

            if (showToast) {
                this.toast(((i18n.t('savedMsg') as string) || 'Saved') as string);
            }
        } catch (e: any) {
            console.error(e);
            if (e.message === 'OOM') {
                this.toast(i18n.t('outOfMemory'));
            } else {
                this.toast(`${i18n.t('errorSaving')}: ${e.message || "Unknown"}`);
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
                    <button @click=${this.requestExit} style="...">←</button>
                    <img src="/icons/icon-192.webp" alt="${i18n.t('appTitle')}" @error=${this.handleImageError}/>
                    <span class="mobile-hide">${i18n.t('appTitle')}</span>
                    ${this.isVerified ? html`<span
                            style="background: #10b981; color: white; padding: 2px 6px; border-radius: 12px; font-size: 0.7rem; font-weight: bold; margin-left: 8px;">VERIFIED</span>` : ''}
                </div>
                <select class="lang-select" @change=${this.handleLangChange}>
                    <option value="en" ?selected=${i18n.lang === 'en'}>English</option>
                    <option value="ar" ?selected=${i18n.lang === 'ar'}>العربية</option>
                    <option value="fr" ?selected=${i18n.lang === 'fr'}>Français</option>
                </select>
            </header>

            <div class="toolbar">
                <button class="primary" @click=${this.openSignModal} title="${i18n.t('addSig')}">
                    ${ICONS.sign}<span class="btn-label">${i18n.t('addSig')}</span>
                </button>
                <button @click=${this.openInitialsModal} title="${i18n.t('addInitials')}">
                    ${ICONS.text}<span class="btn-label">${i18n.t('addInitials')}</span>
                </button>
                <button @click=${this.addTextAnnotation} title="${i18n.t('addText')}">
                    ${ICONS.text}<span class="btn-label">${i18n.t('addText')}</span>
                </button>
                <button @click=${this.addIdentity} title="${i18n.t('addIdentity')}">
                    ${ICONS.identity}<span class="btn-label">${i18n.t('addIdentity') || 'Identity'}</span>
                </button>
                <button @click=${() => this.shadowRoot?.getElementById('stamp-input')?.click()}
                        title="${i18n.t('addStamp')}">
                    ${ICONS.stamp}<span class="btn-label">${i18n.t('addStamp')}</span>
                </button>
                <button @click=${this.addDateStamp} title="${i18n.t('addDate')}">
                    ${ICONS.date}<span class="btn-label">${i18n.t('addDate')}</span>
                </button>
                <div style="width: 1px; height: 20px; background: #ddd; margin: 0 4px; flex-shrink: 0;"></div>
                <button @click=${this.undo} ?disabled=${this.history.length === 0} title="${i18n.t('undo')}"
                        aria-label="${i18n.t('undo') || 'Undo'}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 7v6h6"/>
                        <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                    </svg>
                </button>
                <button @click=${this.redo} ?disabled=${this.future.length === 0} title="${i18n.t('redo')}"
                        aria-label="${i18n.t('redo') || 'Redo'}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 7v6h-6"/>
                        <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
                    </svg>
                </button>
                <div style="flex:1"></div>
                <button class="toggle ${this.includeFooter ? 'active' : ''}"
                        @click=${() => {
                            this.includeFooter = !this.includeFooter;
                            this.isDirty = true;
                            const msg = this.includeFooter
                                    ? (i18n.t('footerOn') || "Footer Enabled")
                                    : (i18n.t('footerOff') || "Footer Disabled");
                            this.toast(msg as string);
                        }}
                        title="${i18n.t('addPageFooter')}">
                    ${ICONS.footer}<span class="btn-label mobile-hide">${i18n.t('pageFooter')}</span>
                </button>

                <button class="toggle ${this.includeAudit ? 'active' : ''}"
                        @click=${() => {
                            this.includeAudit = !this.includeAudit;
                            this.isDirty = true;
                            const msg = this.includeAudit
                                    ? (i18n.t('auditOn') || "Audit Trail Enabled")
                                    : (i18n.t('auditOff') || "Audit Trail Disabled");
                            this.toast(msg as string);
                        }}
                        title="${i18n.t('addAuditPage')}">
                    ${ICONS.audit}<span class="btn-label">${i18n.t('auditTrail')}</span>
                </button>
                <button class="primary" @click=${() => this.saveDocument({silentWeb: false, showToast: true})}
                        ?disabled=${saveDisabled}
                        title=${saveDisabled ? ((i18n.t('noChanges') as string) || 'No changes to save') : (i18n.t('savePdf') as string)}>
                    ${ICONS.save}<span class="btn-label">${i18n.t('savePdf')}</span>
                </button>
                <button @click=${this.shareLatest} ?disabled=${shareDisabled}
                        title=${shareDisabled ? ((i18n.t('noChanges') as string) || 'No changes to share') : (i18n.t('sharePdf') as string)}>
                    ${ICONS.share}<span class="btn-label">${i18n.t('sharePdf')}</span>
                </button>
            </div>

            <input type="file" id="stamp-input" accept="image/*" style="display: none"
                   @change=${this.handleStampUpload}/>

            <div class="toolbar toolbar-secondary">
                <div class="tool-group">
                    <button title=${i18n.t('zoomOut')} aria-label=${i18n.t('zoomOut')}
                            @click=${() => this.zoom(-0.2)}>
                        －
                    </button>
                    <button title=${i18n.t('zoomIn')} aria-label=${i18n.t('zoomIn')}
                            @click=${() => this.zoom(0.2)}>
                        ＋
                    </button>
                </div>
                <div class="tool-group">
                    <button title=${i18n.t('prev')} aria-label=${i18n.t('prev')}
                            @click=${() => this.changePage(-1)} ?disabled=${this.currentPage === 1}>‹
                    </button>
                    <span class="page-indicator">${this.currentPage} / ${this.totalPages}</span>
                    <button title=${i18n.t('next')} aria-label=${i18n.t('next')}
                            @click=${() => this.changePage(1)} ?disabled=${this.currentPage === this.totalPages}>›
                    </button>
                </div>
            </div>

            <div class="viewport" @mousedown=${this.onContainerClick} @touchstart=${this.onContainerClick}>
                <div class="page-container">
                    ${this.guideX !== null ? html`
                        <div style="position:absolute; left:${this.guideX * 100}%; top:0; bottom:0; width:1px; background:#ef4444; z-index:50;"></div>` : ''}
                    ${this.guideY !== null ? html`
                        <div style="position:absolute; top:${this.guideY * 100}%; left:0; right:0; height:1px; background:#ef4444; z-index:50;"></div>` : ''}
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
                                                <div style="width:1px; background:#444; margin:0 2px;"></div>
                                                <button @click=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.applyToAllPages(ann.id);
                                                }} title="${i18n.t('applyToAll') || 'Apply to all pages'}">📄
                                                </button>
                                            </div>
                                        ` : ''}

                                        ${isSelected && !isText ? html`
                                            <div class="style-popup" @mousedown=${(e: Event) => e.stopPropagation()}
                                                 @touchstart=${(e: Event) => e.stopPropagation()}>
                                                <button @click=${(e: Event) => {
                                                    e.stopPropagation();
                                                    this.applyToAllPages(ann.id);
                                                }} title="${i18n.t('applyToAll') || 'Apply to all pages'}">📄
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

            ${this.showHandoverModal ? html`
                <div class="modal-overlay">
                    <div class="modal">
                        <h3 style="margin-top:0;">${i18n.t('previousSigDetected')}</h3>
                        <p style="font-size:0.9rem; color:#555; margin-bottom:15px;">
                            ${i18n.t('verifyPreviousSigPrompt')}
                        </p>

                        <div style="background:#f3f4f6; padding:10px; margin-bottom:15px; border-radius:6px; font-size:0.85rem;">
                            <strong>Ref ID:</strong> ${this.detectedRefId}
                        </div>

                        <input type="text"
                               .value="${this.handoverHashInput}"
                               @input="${(e: any) => {
                                   this.handoverHashInput = e.target.value;
                                   this.handoverResult = 'idle';
                               }}"
                               placeholder="${i18n.t('pasteHashPlaceholder')}"
                               style="width:100%; padding:10px; border:1px solid #ccc; border-radius:6px; box-sizing:border-box; margin-bottom:15px;">

                        ${this.handoverResult === 'success' ? html`
                            <div style="color:#166534; background:#dcfce7; padding:10px; border-radius:6px; margin-bottom:15px; font-size:0.9rem; border:1px solid #bbf7d0;">
                                <span .innerHTML=${i18n.t('statusVerified')}></span>
                            </div>
                        ` : ''}

                        ${this.handoverResult === 'fail' ? html`
                            <div style="color:#991b1b; background:#fee2e2; padding:10px; border-radius:6px; margin-bottom:15px; font-size:0.9rem; border:1px solid #fecaca;">
                                <span .innerHTML=${i18n.t('statusMismatch')}></span>
                            </div>
                        ` : ''}

                        <div style="display:flex; gap:10px;">
                            <button class="primary" @click=${this.checkHandover}
                                    style="flex:1; justify-content:center;">
                                ${i18n.t('verifyBtn')}
                            </button>
                            <button @click=${() => this.showHandoverModal = false}
                                    style="flex:1; background:transparent; border:1px solid #ddd; color:#555; justify-content:center;">
                                ${i18n.t('btnSkip')}
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}

            ${this.showProofModal ? html`
                <div class="modal-overlay">
                    <div class="modal" style="text-align:center;">
                        <div style="width:50px; height:50px; background:#dcfce7; color:#16a34a; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:24px; margin:0 auto 15px;">
                            ✓
                        </div>
                        <h2 style="color:#166534; margin-top:0; font-size: 1.5rem;">
                            ${i18n.t('savedMsg') || 'Document Saved!'}
                        </h2>
                        <p style="color:#4b5563; font-size:0.95rem; margin-bottom: 20px;">
                            ${i18n.t('proveIdentityMsg') || 'Save this receipt to prove the document is authentic later.'}
                        </p>

                        <div style="background:#f9fafb; padding:15px; margin:15px 0; border-radius:8px; border: 1px solid #e5e7eb; text-align:left;">
                            <div style="font-size:0.8rem; color:#6b7280; margin-bottom:4px; font-weight: 600;">
                                ${i18n.t('internalRefLabel') || 'Internal Ref ID:'}
                            </div>
                            <div style="font-family:monospace; font-size:1.1rem; color:#1f2937; margin-bottom:15px;">
                                ${this.lastSavedId}
                            </div>

                            <div style="font-size:0.8rem; color:#6b7280; margin-bottom:4px; font-weight: 600;">
                                ${i18n.t('integrityHashLabel') || '🔐 Strict Integrity Hash:'}
                            </div>
                            <div style="font-family:monospace; font-size:0.75rem; color:#1f2937; word-break:break-all; background:#e5e7eb; padding:8px; border-radius:6px;">
                                ${this.lastSavedHash}
                            </div>
                        </div>

                        <div style="display:flex; gap:10px; margin-bottom:12px;">
                            <button @click=${this.copyHash} class="primary"
                                    style="flex:1; justify-content:center; padding:12px; background:#4f46e5;">
                                ${i18n.t('copyHash')}
                            </button>
                            <button @click=${this.sendProofEmail} class="primary"
                                    style="flex:1; justify-content:center; padding:12px;">
                                ${i18n.t('sendProofEmail') || 'Email'}
                            </button>
                        </div>

                        <button @click=${() => this.showProofModal = false}
                                style="width:100%; justify-content:center; padding:12px; background:transparent; color:#4b5563; border:1px solid #d1d5db; font-weight: 500;">
                            ${i18n.t('close') || 'Close'}
                        </button>
                    </div>
                </div>
            ` : ''}
        `;
    }
}