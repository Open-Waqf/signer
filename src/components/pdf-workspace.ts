import {css, html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {Capacitor} from '@capacitor/core';
import {pdfEngine} from '../lib/pdf-engine';
import {fileService} from '../lib/file-service';
import {i18n} from '../lib/i18n-service';
import {Annotation, AnnotationType} from '../types';
import './signature-modal';
import {ICONS} from '../lib/icons';
import {sharedStyles} from '../styles/shared-styles';
import {LANGUAGES} from '../i18n/locales';
import {HapticService} from '../lib/haptic-service';

@customElement('pdf-workspace')
export class PdfWorkspace extends LitElement {
    @property() pdfName = '';
    @state() currentPage = 1;
    @state() totalPages = 0;
    @state() scale = 1.0;

    @state() showProofModal = false;
    @state() lastSavedId: string | null = null;
    @state() lastSavedHash: string | null = null;
    @state() includeFooter = false;

    @state() validationMsg: string | null = null;
    @state() annotations: Annotation[] = [];
    @state() includeAudit = false;

    @state() showHandoverModal = false;
    @state() handoverHashInput = '';
    @state() handoverResult: 'idle' | 'success' | 'fail' = 'idle';
    @state() detectedRefId = '';

    @state() selectedId: string | null = null;
    @state() isDragging = false;
    @state() isResizing = false;
    @state() dragOffset = {x: 0, y: 0};

    @state() history: Annotation[][] = [];
    @state() future: Annotation[][] = [];

    @state() lastSaved: { filename: string; uri?: string } | null = null;
    private lastSavedBytes: Uint8Array | null = null;
    @state() outputFilename = '';

    @state() public isDirty = false;
    private interactionSnapshotTaken = false;
    private interactionChanged = false;

    private loadedBytes: Uint8Array | null = null;
    @state() isVerified = false;

    @query('#pdf-canvas') canvas!: HTMLCanvasElement;
    @query('.page-container') container!: HTMLDivElement;
    @query('.viewport') viewport!: HTMLDivElement;

    @state() guideX: number | null = null;
    @state() guideY: number | null = null;

    @state() showThumbnails = localStorage.getItem('signer_show_thumbs') === 'true';
    @state() thumbnailURLs: string[] = [];
    @state() isGeneratingThumbs = false;

    @state() customPrompt: {
        show: boolean,
        title: string,
        value: string,
        placeholder: string,
        isIdentity: boolean,
        targetId?: string
    } = {show: false, title: '', value: '', placeholder: '', isIdentity: false};

    private get hasEdits(): boolean {
        return this.annotations.length > 0 || this.includeAudit;
    }

    private setupFocusTrap(container: HTMLElement) {
        container.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Tab') {
                const focusables = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                const first = focusables[0] as HTMLElement;
                const last = focusables[focusables.length - 1] as HTMLElement;

                if (e.shiftKey) {
                    if (this.shadowRoot!.activeElement === first) {
                        last.focus();
                        e.preventDefault();
                    }
                } else {
                    if (this.shadowRoot!.activeElement === last) {
                        first.focus();
                        e.preventDefault();
                    }
                }
            }
        });
    }

    private generateId(): string {
        return crypto.randomUUID().split('-')[0];
    }

    addIdentity() {
        const savedEmail = localStorage.getItem('user_email') || '';
        this.customPrompt = {
            show: true,
            title: i18n.t('identityPrompt') || 'Enter your email:',
            value: savedEmail,
            placeholder: i18n.t('emailPlaceholder') || 'email@example.com',
            isIdentity: true
        };
    }


    saveCustomPrompt() {
        const val = this.customPrompt.value.trim();
        if (this.customPrompt.isIdentity && val) {
            localStorage.setItem('user_email', val);
            const text = `${i18n.t('signedBy') || 'Signed by'}: ${val}`;
            this.addAnnotation('identity', text, 0);
        } else if (!this.customPrompt.isIdentity && this.customPrompt.targetId && val) {
            this.snapshot();
            this.annotations = this.annotations.map((a) => (a.id === this.customPrompt.targetId ? {
                ...a,
                data: val
            } : a));
            this.isDirty = true;
        }
        this.customPrompt.show = false;
    }

    sendProofEmail() {
        if (!this.lastSavedId) return;
        const subject = (i18n.t('emailSubject') || 'Signature Receipt: {id}').replace('{id}', this.lastSavedId);
        let body = (i18n.t('emailBody') || '').replace('{id}', this.lastSavedId).replace('{hash}', this.lastSavedHash || 'N/A');
        window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
        this.showProofModal = false;
    }

    copyHash() {
        if (this.lastSavedHash) {
            navigator.clipboard.writeText(this.lastSavedHash);
            this.toast((i18n.t('linkCopied') as string) || 'Copied to clipboard!');
        }
    }

    static styles = [sharedStyles, css`
        :host {
            height: 100%;
            flex: 1;
            display: flex;
            flex-direction: column;
            background: var(--bg-app);
            overflow: hidden;
            position: relative;
        }

        header {
            background: var(--bg-surface);
            height: 56px;
            padding: 0 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
            z-index: 100;
            flex-shrink: 0;
            box-shadow: var(--shadow-flat);
        }

        .brand {
            font-weight: 700;
            color: var(--text-main);
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .brand img {
            height: 32px;
            width: 32px;
            border-radius: var(--radius-sm);
        }

        /* --- Toolbar System --- */

        .toolbar-top {
            background: var(--bg-surface);
            border-bottom: 1px solid var(--border);
            z-index: 90;
            display: flex;
            flex-direction: column;
        }

        .toolbar-row {
            display: flex;
            padding: 8px 12px;
            gap: 8px;
            align-items: center;
            overflow-x: auto;
            scrollbar-width: none;
        }

        .toolbar-row::-webkit-scrollbar {
            display: none;
        }

        .toolbar-bottom {
            display: none; /* Desktop hidden */
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: var(--bg-surface);
            border-top: 1px solid var(--border);
            padding: 8px 8px env(safe-area-inset-bottom);
            z-index: 200;
            box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.05);
            justify-content: flex-start;
            overflow-x: auto;
            scrollbar-width: none;
            -webkit-overflow-scrolling: touch;
        }

        .toolbar-bottom::-webkit-scrollbar {
            display: none;
        }

        @media (max-width: 768px) {
            .toolbar-bottom {
                display: flex;
            }

            .toolbar-top .primary-tools {
                display: none;
            }

            .viewport {
                padding-bottom: 100px; /* Space for bottom bar */
            }

            .brand span {
                display: none;
            }
        }

        .btn-tool {
            flex-direction: column;
            gap: 4px;
            padding: 8px !important;
            border: none !important;
            background: transparent !important;
            color: var(--text-sub) !important;
            min-width: 64px;
            transition: var(--transition-fast);
        }

        .btn-tool svg {
            width: 24px;
            height: 24px;
        }

        .btn-tool span {
            font-size: 0.65rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.02em;
        }

        .btn-tool:active {
            color: var(--primary) !important;
            transform: scale(0.9);
        }

        /* Viewport & Canvas */

        .workspace-area {
            flex: 1;
            display: flex;
            overflow: hidden;
            position: relative;
        }

        .viewport {
            flex: 1;
            display: grid;
            place-items: start center;
            overflow: auto;
            padding: 24px;
            background: var(--bg-app);
            background-image: radial-gradient(var(--border) 1px, transparent 1px);
            background-size: 24px 24px;
            touch-action: pan-x pan-y;
        }

        .page-container {
            position: relative;
            box-shadow: var(--shadow-floating);
            background: white;
            border-radius: 2px;
            margin-bottom: 40px;
            transition: transform 0.2s ease;
        }

        .thumb-panel {
            width: 80px;
            background: #111827;
            border-right: 1px solid #374151;
            overflow-y: auto;
            flex-shrink: 0;
            padding: 12px 8px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            z-index: 50;
        }

        @media (max-width: 768px) {
            .thumb-panel {
                width: 64px;
                padding: 8px 4px;
            }
        }

        .thumb-item {
            position: relative;
            cursor: pointer;
            border: 2px solid transparent;
            border-radius: var(--radius-sm);
            background: #fff;
            transition: all 0.2s;
            overflow: hidden;
            flex-shrink: 0;
            min-height: 60px;
            box-shadow: var(--shadow-flat);
        }

        .thumb-item.active {
            border-color: var(--primary);
            transform: scale(1.05);
            box-shadow: var(--shadow-raised);
        }

        /* Draggables */

        .draggable {
            position: absolute;
            cursor: grab;
            user-select: none;
            border: 2px solid transparent;
            border-radius: 4px;
            transition: border-color 0.2s;
        }

        .draggable.selected {
            border-color: var(--primary);
            background: rgba(37, 99, 235, 0.05);
            z-index: 100;
            box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.8);
        }

        .delete-btn {
            position: absolute;
            top: -14px;
            right: -14px;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: white;
            color: var(--danger);
            border: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: var(--shadow-raised);
            z-index: 110;
            font-weight: bold;
            font-size: 20px;
        }

        /* Collision aware positioning */

        .page-container[data-near-top] .delete-btn {
            top: 2px;
        }

        .page-container[data-near-right] .delete-btn {
            right: 2px;
        }

        .style-popup {
            position: absolute;
            top: -56px;
            left: 50%;
            transform: translateX(-50%);
            background: #111827;
            border-radius: 8px;
            padding: 6px;
            display: flex;
            gap: 8px;
            z-index: 200;
            box-shadow: var(--shadow-floating);
            transition: top 0.2s;
        }

        /* RTL for style popup */

        :host([dir="rtl"]) .style-popup {
            left: auto;
            right: 50%;
            transform: translateX(50%);
        }

        .page-container[data-near-top] .style-popup {
            top: 100%;
            margin-top: 10px;
        }

        .text-content {
            display: block;
            background: transparent;
            white-space: nowrap;
            font-family: 'Amiri', sans-serif;
            color: black;
            line-height: 1.2;
            pointer-events: none;
            padding: 2px 4px;
        }

        .toolbar-row {
            position: relative;
        }

        /* Toolbar scroll indicator gradient */

        .toolbar-row::after {
            content: '';
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: 30px;
            background: linear-gradient(to right, transparent, var(--bg-surface));
            pointer-events: none;
            opacity: 0.8;
        }
    `];

    private onLangChanged = () => {
        this.dir = i18n.lang === 'ar' ? 'rtl' : 'ltr';
        this.requestUpdate();
    };

    connectedCallback() {
        super.connectedCallback();
        this.dir = i18n.lang === 'ar' ? 'rtl' : 'ltr';
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
        // Never intercept while user is typing in an input or a modal prompt is open
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || this.customPrompt.show) return;

        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            this.undo();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
            e.preventDefault();
            this.redo();
            return;
        }

        if (e.key === 'Escape') {
            this.selectedId = null;
            return;
        }

        // Tab: cycle through annotations on the current page
        if (e.key === 'Tab') {
            const pageAnns = this.annotations.filter(a => a.page === this.currentPage - 1);
            if (pageAnns.length > 0) {
                e.preventDefault();
                const idx = pageAnns.findIndex(a => a.id === this.selectedId);
                let next: number;
                if (idx === -1) {
                    next = e.shiftKey ? pageAnns.length - 1 : 0;
                } else {
                    next = e.shiftKey
                        ? (idx - 1 + pageAnns.length) % pageAnns.length
                        : (idx + 1) % pageAnns.length;
                }
                this.selectedId = pageAnns[next].id;
            }
            return;
        }

        if (!this.selectedId) return;

        // Delete selected annotation
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            this.snapshot();
            this.annotations = this.annotations.filter(a => a.id !== this.selectedId);
            this.selectedId = null;
            this.isDirty = true;
            return;
        }

        // Arrow keys: nudge selected annotation (Shift = 4× step)
        if (e.key.startsWith('Arrow')) {
            const ann = this.annotations.find(a => a.id === this.selectedId);
            if (!ann) return;
            e.preventDefault();
            if (!e.repeat) this.snapshot(); // Snapshot only on first keydown, not on hold
            const step = e.shiftKey ? 0.02 : 0.005;
            let {xPct, yPct} = ann;
            if (e.key === 'ArrowLeft') xPct = Math.max(0, xPct - step);
            else if (e.key === 'ArrowRight') xPct = Math.min(1 - ann.widthPct, xPct + step);
            else if (e.key === 'ArrowUp') yPct = Math.max(0, yPct - step);
            else if (e.key === 'ArrowDown') yPct = Math.min(1, yPct + step);
            this.annotations = this.annotations.map(a =>
                a.id === this.selectedId ? {...a, xPct, yPct} : a
            );
            this.isDirty = true;
        }
    };

    snapshot() {
        const current = JSON.parse(JSON.stringify(this.annotations));
        this.history = [...this.history, current];
        this.future = [];
    }

    undo() {
        if (this.history.length === 0) return;
        HapticService.impact();
        this.future = [JSON.parse(JSON.stringify(this.annotations)), ...this.future];
        this.annotations = this.history.pop()!;
        this.selectedId = null;
        this.isDirty = true;
    }

    redo() {
        if (this.future.length === 0) return;
        HapticService.impact();
        this.history = [...this.history, JSON.parse(JSON.stringify(this.annotations))];
        this.annotations = this.future.shift()!;
        this.selectedId = null;
        this.isDirty = true;
    }

    async loadPdf(file: Uint8Array, name: string) {
        pdfEngine.destroy();
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
            // Focus trap after render
            setTimeout(() => {
                const modal = this.shadowRoot?.querySelector('[data-testid="handover-modal"]') as HTMLElement;
                if (modal) {
                    this.setupFocusTrap(modal);
                    modal.querySelector('input')?.focus();
                }
            }, 50);
        } else {
            this.includeAudit = false;
        }
        this.currentPage = 1;
        this.scale = window.innerWidth < 768 ? 0.55 : 1.0;
        this.annotations = [];
        this.selectedId = null;
        this.isDirty = false;
        this.lastSaved = null;
        this.lastSavedBytes = null;
        this.history = [];
        this.future = [];

        const cleanName = name.replace(/_signed_\d{4}-\d{2}-\d{2}.*$/, '').replace(/\.pdf$/i, '');
        this.outputFilename = `${cleanName}_signed_${new Date().toISOString().slice(0, 10)}`;
        this.thumbnailURLs = [];

        await this.updateComplete;
        void this.renderPage();
        void this.generateThumbnails();
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

    async generateThumbnails() {
        if (this.totalPages === 0) return;
        this.isGeneratingThumbs = true;
        this.thumbnailURLs = [];
        const offscreen = document.createElement('canvas');
        for (let p = 1; p <= this.totalPages; p++) {
            await pdfEngine.renderPage(p, offscreen, 0.18);
            this.thumbnailURLs = [...this.thumbnailURLs, offscreen.toDataURL('image/jpeg', 0.75)];
            await new Promise(r => requestAnimationFrame(r));
        }
        this.isGeneratingThumbs = false;
    }

    updated(changed: Map<string, unknown>) {
        if (changed.has('currentPage') && this.showThumbnails) {
            this.shadowRoot?.querySelector('.thumb-item.active')
                ?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        }
        if (changed.has('showProofModal') && this.showProofModal) {
            const modal = this.shadowRoot?.querySelector('[data-testid="proof-modal"]') as HTMLElement;
            if (modal) {
                this.setupFocusTrap(modal);
                modal.querySelector('button')?.focus();
            }
        }
        if (changed.has('customPrompt') && this.customPrompt.show) {
            const modal = this.shadowRoot?.querySelector('[data-testid="custom-prompt"]') as HTMLElement;
            if (modal) {
                this.setupFocusTrap(modal);
                modal.querySelector('input')?.focus();
            }
        }
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
            const exists = this.annotations.some(a =>
                a.page === p && a.type === sourceAnn.type &&
                Math.abs(a.xPct - sourceAnn.xPct) < 0.01 && Math.abs(a.yPct - sourceAnn.yPct) < 0.01 && a.data === sourceAnn.data
            );
            if (!exists) {
                newAnnotations.push({...sourceAnn, id: this.generateId(), page: p});
            }
        }
        if (newAnnotations.length > 0) {
            this.annotations = [...this.annotations, ...newAnnotations];
            this.isDirty = true;
            this.toast(i18n.t('appliedToPages').replace('{count}', newAnnotations.length.toString()));
        }
    }

    addAnnotation(type: AnnotationType, data: string, aspectRatio = 1) {
        this.snapshot();
        HapticService.impact();
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
            id: this.generateId(),
            type, page: this.currentPage - 1, xPct, yPct, widthPct, data, aspectRatio,
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
        this.customPrompt = {
            show: true,
            title: i18n.t('editText') || 'Edit text:',
            value: currentText || '',
            placeholder: i18n.t('typeHerePlaceholder') || 'Type here...',
            isIdentity: false,
            targetId: id
        };
    }

    deleteAnnotation(id: string) {
        this.snapshot();
        HapticService.impact();
        this.annotations = this.annotations.filter((a) => a.id !== id);
        if (this.selectedId === id) this.selectedId = null;
        this.isDirty = true;
    }

    updateAnnotation(id: string, updates: Partial<Annotation>) {
        this.annotations = this.annotations.map((a) => (a.id === id ? {...a, ...updates} : a));
        this.isDirty = true;
    }

    updateStyle(id: string, style: Partial<Annotation>) {
        this.snapshot();
        this.annotations = this.annotations.map((a) => (a.id === id ? {...a, ...style} : a));
        this.isDirty = true;
    }

    onContainerClick(e: Event) {
        const target = e.target as Element;
        if (target.closest('.draggable') || target.closest('.style-popup')) return;
        this.selectedId = null;
    }

    startDrag(e: MouseEvent | TouchEvent, id: string) {
        const target = e.target as Element;
        const isControl = !!target.closest('.delete-btn') || !!target.closest('.resize-handle') || !!target.closest('.style-popup');

        if (isControl) {
            e.stopPropagation(); // Stop bubbling to prevent viewport from clearing selectedId
            return;
        }

        if (e.cancelable) e.preventDefault();
        e.stopPropagation();

        // Use passive:true compatible logic
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
            y: clientY - rect.top - ann.yPct * rect.height
        };
    }

    startResize(e: MouseEvent | TouchEvent, id: string) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        this.isResizing = true;
        this.selectedId = id;
        this.interactionSnapshotTaken = false;
        this.interactionChanged = false;
    }

    handleGlobalMove = (e: MouseEvent | TouchEvent) => {
        if (!this.selectedId || (!this.isDragging && !this.isResizing)) return;
        if (e.cancelable) e.preventDefault();

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
            if (contentEl && contentEl.offsetWidth > 0 && contentEl.offsetHeight > 0) {
                visualWidthPct = contentEl.offsetWidth / rect.width;
                visualHeightPct = contentEl.offsetHeight / rect.height;
            }
            const centerX = nextXPct + (visualWidthPct / 2);
            const centerY = nextYPct + (visualHeightPct / 2);
            this.guideX = null;
            this.guideY = null;

            if (Math.abs(centerX - 0.5) < 0.02) {
                nextXPct = 0.5 - (visualWidthPct / 2);
                this.guideX = 0.5;
            }
            if (Math.abs(centerY - 0.5) < 0.02) {
                nextYPct = 0.5 - (visualHeightPct / 2);
                this.guideY = 0.5;
            }

            if (Math.abs(nextXPct - ann.xPct) > 0.0005 || Math.abs(nextYPct - ann.yPct) > 0.0005) {
                takeSnapshotIfNeeded();
                this.interactionChanged = true;
                this.updateAnnotation(this.selectedId, {xPct: nextXPct, yPct: nextYPct});
            }

            // Collision detection for popup/delete
            this.container.toggleAttribute('data-near-top', nextYPct < 0.1);
            this.container.toggleAttribute('data-near-right', nextXPct > 0.85);

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
            img.onload = () => {
                if (img.width > 0 && img.height > 0) {
                    this.addAnnotation(mode, e.detail, img.height / img.width);
                }
            };
            img.onerror = () => console.error('Failed to load signature image');
            img.src = e.detail;
        });
        document.body.appendChild(modal);
    }

    addDateStamp() {
        const now = new Date();
        const dateStr = new Intl.DateTimeFormat(i18n.lang, {
            day: '2-digit', month: '2-digit', year: 'numeric',
        }).format(now);
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
            this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.canvas.width = 0;
            this.canvas.height = 0;
        }
    }

    async saveDocument(opts?: { silentWeb?: boolean; showToast?: boolean }) {
        const silentWeb = !!opts?.silentWeb;
        const showToast = opts?.showToast ?? true;

        if (!this.hasEdits) {
            this.toast(i18n.t('noChanges') || 'No changes');
            return;
        }
        this.dispatchEvent(new CustomEvent('set-loading', {detail: true, bubbles: true, composed: true}));
        await new Promise((r) => setTimeout(r, 50));

        try {
            const filename = `${this.outputFilename}.pdf`;
            let result = await pdfEngine.saveProfessional(this.annotations, this.pdfName, this.includeAudit, this.includeFooter, this.validationMsg);
            this.lastSavedBytes = result.pdfBytes;

            if (!Capacitor.isNativePlatform() && silentWeb) {
                this.lastSaved = {filename};
            } else {
                this.lastSaved = await fileService.savePdf(filename, result.pdfBytes);
                if (Capacitor.isNativePlatform() && showToast) {
                    setTimeout(() => {
                        this.toast(i18n.t('exportingFile'));
                        fileService.sharePdf(this.lastSaved!, this.lastSavedBytes!);
                    }, 200);
                }
            }
            this.isDirty = false;
            this.lastSavedId = result.docId;
            this.lastSavedHash = result.finalHash;
            this.showProofModal = true;
            HapticService.success();
            if (showToast) this.toast(i18n.t('savedMsg'));
        } catch (e: any) {
            this.toast(e.message.includes('OOM') ? i18n.t('outOfMemory') : `${i18n.t('errorSaving')}: ${e.message}`);
        } finally {
            this.dispatchEvent(new CustomEvent('set-loading', {detail: false, bubbles: true, composed: true}));
        }
    }

    handleStampUpload(e: Event) {
        const input = e.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onerror = () => this.toast(i18n.t('errorReadingFile') || 'Failed to read file');
            reader.onload = (evt) => {
                const img = new Image();
                img.onerror = () => this.toast('Invalid image file');
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0);
                        this.addAnnotation('stamp', canvas.toDataURL('image/png'), img.height / img.width);
                        canvas.remove();
                    }
                };
                img.src = evt.target?.result as string;
            };
            reader.readAsDataURL(input.files[0]);
        }
        input.value = '';
    }

    async shareLatest() {
        if (!this.hasEdits) {
            this.toast(i18n.t('noChanges'));
            return;
        }
        if (this.isDirty || !this.lastSavedBytes || !this.lastSaved) await this.saveDocument({
            silentWeb: !Capacitor.isNativePlatform(),
            showToast: false
        });
        if (this.lastSaved && this.lastSavedBytes) await fileService.sharePdf(this.lastSaved, this.lastSavedBytes);
    }

    requestExit() {
        this.dispatchEvent(new CustomEvent('exit-workspace', {bubbles: true, composed: true}));
    }

    handleLangChange(e: Event) {
        i18n.setLanguage((e.target as HTMLSelectElement).value as any);
    }

    handleImageError(e: Event) {
        (e.target as HTMLImageElement).style.display = 'none';
    }

    render() {
        const saveDisabled = !this.pdfName || !this.hasEdits;
        const shareDisabled = !this.pdfName || !this.hasEdits;

        return html`
            <header>
                <div class="brand">
                    <button id="btn-exit" data-testid="btn-exit" class="btn mirror-rtl"
                            aria-label="${i18n.t('exitBtn')}"
                            style="border:none; padding:8px; display:flex; align-items:center; justify-content:center; width:44px; height:44px;"
                            @click=${this.requestExit}>
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"/>
                            <polyline points="12 19 5 12 12 5"/>
                        </svg>
                    </button>

                    <img src="/icons/icon-192.webp" alt="${i18n.t('appTitle')}" @error=${this.handleImageError}/>
                    <span>${i18n.t('appTitle')}</span>
                    ${this.isVerified ? html`<span class="badge"
                                                   style="background:var(--success); color:white; padding:2px 8px; border-radius:10px; font-size:0.7rem; margin-left:8px;">${i18n.t('verifiedBadge')}</span>` : ''}
                </div>
                <select id="select-lang" data-testid="select-lang" class="lang-select"
                        aria-label="${i18n.t('language') || 'Language'}" @change=${this.handleLangChange}>
                    ${LANGUAGES.map(l => html`
                        <option value="${l.code}" ?selected=${i18n.lang === l.code}>${l.label}</option>
                    `)}
                </select>
            </header>

            <div class="toolbar-top" role="toolbar" aria-label="${i18n.t('ariaToolbar')}">
                <div class="toolbar-row primary-tools">
                    <button data-testid="btn-add-sig" class="btn" aria-label="${i18n.t('addSig')}"
                            @click=${this.openSignModal}>
                        ${ICONS.sign}<span class="btn-label" style="margin-left:6px;">${i18n.t('addSig')}</span>
                    </button>
                    <button data-testid="btn-add-initials" class="btn" aria-label="${i18n.t('addInitials')}"
                            @click=${this.openInitialsModal}>
                        ${ICONS.text}<span class="btn-label" style="margin-left:6px;">${i18n.t('addInitials')}</span>
                    </button>
                    <button data-testid="btn-add-text" class="btn" aria-label="${i18n.t('addText')}"
                            @click=${this.addTextAnnotation}>
                        ${ICONS.text}<span class="btn-label" style="margin-left:6px;">${i18n.t('addText')}</span>
                    </button>
                    <button data-testid="btn-add-identity" class="btn"
                            aria-label="${i18n.t('addIdentity') || 'Identity'}" @click=${this.addIdentity}>
                        ${ICONS.identity}<span class="btn-label"
                                               style="margin-left:6px;">${i18n.t('addIdentity') || 'Identity'}</span>
                    </button>
                    <button data-testid="btn-add-stamp" class="btn" aria-label="${i18n.t('addStamp')}"
                            @click=${() => this.shadowRoot?.getElementById('stamp-input')?.click()}>
                        ${ICONS.stamp}<span class="btn-label" style="margin-left:6px;">${i18n.t('addStamp')}</span>
                    </button>
                    <button data-testid="btn-add-date" class="btn" aria-label="${i18n.t('addDate')}"
                            @click=${this.addDateStamp}>
                        ${ICONS.date}<span class="btn-label" style="margin-left:6px;">${i18n.t('addDate')}</span>
                    </button>
                </div>

                <div class="toolbar-row" style="justify-content: space-between; background: var(--bg-muted);">
                    <div style="display:flex; gap:8px;">
                        <button data-testid="btn-undo" class="btn" style="padding: 8px 12px;"
                                aria-label="${i18n.t('undo')}" @click=${this.undo}
                                ?disabled=${this.history.length === 0}
                                title="${i18n.t('undo')}">${ICONS.undo}
                        </button>
                        <button data-testid="btn-redo" class="btn" style="padding: 8px 12px;"
                                aria-label="${i18n.t('redo')}" @click=${this.redo} ?disabled=${this.future.length === 0}
                                title="${i18n.t('redo')}">${ICONS.redo}
                        </button>
                        <div style="width:1px; background:var(--border); margin:4px 4px;"></div>
                        <button data-testid="btn-zoom-out" class="btn" style="padding: 8px 12px;"
                                aria-label="${i18n.t('zoomOut')}" title="${i18n.t('zoomOut')}"
                                @click=${() => this.zoom(-0.2)}>－
                        </button>
                        <button data-testid="btn-zoom-in" class="btn" style="padding: 8px 12px;"
                                aria-label="${i18n.t('zoomIn')}" title="${i18n.t('zoomIn')}"
                                @click=${() => this.zoom(0.2)}>＋
                        </button>
                    </div>

                    <div style="display:flex; gap:8px;">
                        <button data-testid="btn-toggle-footer" class="btn toggle ${this.includeFooter ? 'active' : ''}"
                                style="padding: 8px 12px;"
                                aria-label="${i18n.t('addPageFooter')}"
                                @click=${() => {
                                    this.includeFooter = !this.includeFooter;
                                    this.isDirty = true;
                                }} title="${i18n.t('addPageFooter')}">
                            ${ICONS.footer}
                        </button>
                        <button data-testid="btn-toggle-audit" class="btn toggle ${this.includeAudit ? 'active' : ''}"
                                style="padding: 8px 12px;"
                                aria-label="${i18n.t('addAuditPage')}"
                                @click=${() => {
                                    this.includeAudit = !this.includeAudit;
                                    this.isDirty = true;
                                }} title="${i18n.t('addAuditPage')}">
                            ${ICONS.audit}
                        </button>
                        <button data-testid="btn-share" class="btn" style="padding: 8px 12px;"
                                aria-label="${i18n.t('share')}" @click=${this.shareLatest} ?disabled=${shareDisabled}>
                            ${ICONS.share}
                        </button>
                        <button data-testid="btn-save" class="btn btn-primary" style="padding: 8px 12px;"
                                aria-label="${i18n.t('done')}"
                                @click=${() => this.saveDocument()}
                                ?disabled=${saveDisabled}>
                            ${ICONS.save}
                        </button>
                    </div>
                </div>
            </div>

            <div class="toolbar-bottom" role="toolbar" aria-label="${i18n.t('ariaToolbar')}">
                <button data-testid="m-btn-add-sig" class="btn btn-tool" aria-label="${i18n.t('signMode')}"
                        @click=${this.openSignModal}>
                    ${ICONS.sign} <span>${i18n.t('signMode')}</span>
                </button>
                <button data-testid="m-btn-add-initials" class="btn btn-tool" aria-label="${i18n.t('addInitials')}"
                        @click=${this.openInitialsModal}>
                    ${ICONS.text} <span>${i18n.t('addInitials')}</span>
                </button>
                <button data-testid="m-btn-add-text" class="btn btn-tool" aria-label="${i18n.t('addText')}"
                        @click=${this.addTextAnnotation}>
                    ${ICONS.text} <span>${i18n.t('addText')}</span>
                </button>
                <button data-testid="m-btn-add-identity" class="btn btn-tool"
                        aria-label="${i18n.t('addIdentity') || 'Identity'}" @click=${this.addIdentity}>
                    ${ICONS.identity} <span>${i18n.t('addIdentity') || 'Identity'}</span>
                </button>
                <button data-testid="m-btn-add-stamp" class="btn btn-tool" aria-label="${i18n.t('addStamp')}"
                        @click=${() => this.shadowRoot?.getElementById('stamp-input')?.click()}>
                    ${ICONS.stamp} <span>${i18n.t('addStamp')}</span>
                </button>
                <button data-testid="m-btn-add-date" class="btn btn-tool" aria-label="${i18n.t('addDate')}"
                        @click=${this.addDateStamp}>
                    ${ICONS.date} <span>${i18n.t('addDate')}</span>
                </button>
            </div>

            <input type="file" id="stamp-input" accept="image/*" style="display: none"
                   aria-hidden="true"
                   @change=${this.handleStampUpload}/>

            <div class="workspace-area">
                ${this.showThumbnails && (this.thumbnailURLs.length > 0 || this.isGeneratingThumbs) ? html`
                    <div class="thumb-panel">
                        ${this.isGeneratingThumbs ? html`
                            <div style="display:flex; justify-content:center; padding:20px;">
                                <div class="spinner" style="width:24px; height:24px; border-width:2px;"></div>
                            </div>
                        ` : ''}
                        ${this.thumbnailURLs.map((url, i) => html`
                            <div class="thumb-item ${this.currentPage === i + 1 ? 'active' : ''}"
                                 data-testid="thumb-page-${i + 1}"
                                 aria-label="Page ${i + 1}"
                                 @click=${() => {
                                     this.currentPage = i + 1;
                                     this.selectedId = null;
                                     void this.renderPage();
                                 }}>
                                <img src="${url}" alt="Page ${i + 1}" style="width:100%; display:block;">
                                <div style="font-size:0.6rem; color:#9ca3af; text-align:center; padding:2px 0;">
                                    ${i + 1}
                                </div>
                                ${this.annotations.some(a => a.page === i) ? html`
                                    <div style="position:absolute; top:2px; right:2px; width:8px; height:8px; border-radius:50%; background:var(--primary); border:1px solid #111827;"></div>
                                ` : ''}
                            </div>
                        `)}
                    </div>
                ` : ''}

                <div class="viewport" @mousedown=${this.onContainerClick} @touchstart=${this.onContainerClick}>
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px; background:white; padding:8px 16px; border-radius:var(--radius-lg); box-shadow:var(--shadow-flat); border:1px solid var(--border);">
                        <button data-testid="btn-prev-page" class="btn"
                                aria-label="${i18n.t('prevPage') || 'Previous Page'}"
                                style="padding:6px 12px; border:none;" @click=${() => this.changePage(-1)}
                                ?disabled=${this.currentPage === 1}>‹
                        </button>
                        <span data-testid="page-indicator" aria-live="polite"
                              style="font-weight:800; font-size:0.9rem; color:var(--text-main);">${this.currentPage} ${i18n.t('of') || '/'} ${this.totalPages}</span>
                        <button data-testid="btn-next-page" class="btn"
                                aria-label="${i18n.t('nextPage') || 'Next Page'}" style="padding:6px 12px; border:none;"
                                @click=${() => this.changePage(1)} ?disabled=${this.currentPage === this.totalPages}>›
                        </button>
                        <div style="width:1px; height:20px; background:var(--border); margin:0 4px;"></div>
                        <button data-testid="btn-toggle-thumbs"
                                class="btn toggle ${this.showThumbnails ? 'active' : ''}"
                                aria-label="${i18n.t('toggleThumbs') || 'Toggle Thumbnails'}"
                                style="padding:6px; border:none;"
                                @click=${() => {
                                    this.showThumbnails = !this.showThumbnails;
                                    localStorage.setItem('signer_show_thumbs', String(this.showThumbnails));
                                }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2.5">
                                <rect x="3" y="3" width="7" height="7"/>
                                <rect x="14" y="3" width="7" height="7"/>
                                <rect x="3" y="14" width="7" height="7"/>
                                <rect x="14" y="14" width="7" height="7"/>
                            </svg>
                        </button>
                    </div>

                    <div class="page-container" data-testid="page-container">
                        ${this.guideX !== null ? html`
                            <div style="position:absolute; left:${this.guideX * 100}%; top:0; bottom:0; width:1px; background:var(--danger); z-index:50;"></div>` : ''}
                        ${this.guideY !== null ? html`
                            <div style="position:absolute; top:${this.guideY * 100}%; left:0; right:0; height:1px; background:var(--danger); z-index:50;"></div>` : ''}
                        <canvas id="pdf-canvas"></canvas>
                        ${this.annotations.filter(ann => ann.page === this.currentPage - 1).map(ann => {
                            const isSelected = this.selectedId === ann.id;
                            const isText = ann.type === 'date' || ann.type === 'identity';
                            return html`
                                <div class="draggable ${isSelected ? 'selected' : ''}"
                                     data-testid="annotation-${ann.id}"
                                     role="group"
                                     aria-label="${ann.type} ${i18n.t('annotation') || 'annotation'}"
                                     style="left:${ann.xPct * 100}%; top:${ann.yPct * 100}%; width:${isText ? 'auto' : (ann.widthPct ? ann.widthPct * 100 + '%' : 'auto')};"
                                     @mousedown=${(e: any) => this.startDrag(e, ann.id)}
                                     @touchstart=${(e: any) => this.startDrag(e, ann.id)}>
                                    <button data-testid="btn-delete-ann" class="delete-btn"
                                            aria-label="${i18n.t('delete') || 'Delete'}"
                                            style="display:${isSelected ? 'flex' : 'none'};"
                                            @mousedown=${(e: Event) => {
                                                e.stopPropagation();
                                                this.deleteAnnotation(ann.id);
                                            }}
                                            @touchstart=${(e: Event) => {
                                                e.stopPropagation();
                                                this.deleteAnnotation(ann.id);
                                            }}>×
                                    </button>
                                    ${isSelected && isText ? html`
                                        <div class="style-popup" data-testid="style-popup" role="toolbar"
                                             aria-label="${i18n.t('styleToolbar') || 'Style Toolbar'}">
                                            <button data-testid="btn-edit-text"
                                                    aria-label="${i18n.t('editText') || 'Edit text'}"
                                                    style="background:transparent; border:1px solid #374151; color:#fff; width:34px; height:34px; border-radius:4px; cursor:pointer;"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.handleTextEdit(ann.id, ann.data);
                                                    }}>✎
                                            </button>
                                            <button data-testid="btn-toggle-bold"
                                                    aria-label="${i18n.t('bold') || 'Bold'}"
                                                    style="background:${ann.fontWeight === 'bold' ? 'var(--primary)' : 'transparent'}; color:#fff; border:1px solid #374151; width:34px; height:34px; border-radius:4px; font-weight:bold; cursor:pointer;"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.updateStyle(ann.id, {fontWeight: ann.fontWeight === 'bold' ? 'normal' : 'bold'});
                                                    }}>B
                                            </button>
                                            <button data-testid="btn-font-down"
                                                    aria-label="${i18n.t('decreaseFont') || 'Decrease font'}"
                                                    style="background:transparent; border:1px solid #374151; color:#fff; width:34px; height:34px; border-radius:4px; cursor:pointer;"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.updateStyle(ann.id, {fontSize: Math.max(8, (ann.fontSize || 12) - 2)});
                                                    }}>A-
                                            </button>
                                            <button data-testid="btn-font-up"
                                                    aria-label="${i18n.t('increaseFont') || 'Increase font'}"
                                                    style="background:transparent; border:1px solid #374151; color:#fff; width:34px; height:34px; border-radius:4px; cursor:pointer;"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.updateStyle(ann.id, {fontSize: Math.min(60, (ann.fontSize || 12) + 2)});
                                                    }}>A+
                                            </button>
                                            <button data-testid="btn-apply-all"
                                                    aria-label="${i18n.t('applyAll') || 'Apply to all pages'}"
                                                    style="background:transparent; border:1px solid #374151; color:#fff; width:34px; height:34px; border-radius:4px; cursor:pointer;"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.applyToAllPages(ann.id);
                                                    }}>📄
                                            </button>
                                        </div>
                                    ` : isSelected && !isText ? html`
                                        <div class="style-popup" data-testid="style-popup" role="toolbar"
                                             aria-label="${i18n.t('styleToolbar') || 'Style Toolbar'}">
                                            <button data-testid="btn-apply-all"
                                                    aria-label="${i18n.t('applyAll') || 'Apply to all pages'}"
                                                    style="background:transparent; border:1px solid #374151; color:#fff; width:34px; height:34px; border-radius:4px; cursor:pointer;"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.applyToAllPages(ann.id);
                                                    }}>📄
                                            </button>
                                        </div>
                                    ` : ''}
                                    ${!isText ? html`
                                        <div class="resize-handle" aria-label="${i18n.t('resize') || 'Resize'}"
                                             style="position:absolute; bottom:-8px; right:-8px; width:16px; height:16px; background:var(--primary); border:3px solid white; border-radius:50%; cursor:nwse-resize; display:${isSelected ? 'block' : 'none'}; box-shadow:var(--shadow-raised);"
                                             @mousedown=${(e: any) => this.startResize(e, ann.id)}
                                             @touchstart=${(e: any) => this.startResize(e, ann.id)}></div>
                                        <img src="${ann.data}" alt="${ann.type} annotation"
                                             style="width:100%; display:block; pointer-events:none;"/>
                                    ` : html`
                                        <span class="text-content"
                                              style="font-size:${ann.fontSize || 12}px; font-weight:${ann.fontWeight || 'normal'};"
                                              @dblclick=${(e: Event) => {
                                                  e.stopPropagation();
                                                  this.handleTextEdit(ann.id, ann.data);
                                              }}>${ann.data}</span>
                                    `}
                                </div>
                            `;
                        })}
                    </div>
                </div>
            </div>

            ${this.showHandoverModal ? html`
                <div class="modal-overlay">
                    <div class="modal-card" data-testid="handover-modal" role="dialog" aria-modal="true"
                         aria-labelledby="handover-title">
                        <h3 id="handover-title" style="margin-top:0;">${i18n.t('previousSigDetected')}</h3>
                        <p style="font-size:0.9rem; color:var(--text-sub); margin-bottom:15px;">
                            ${i18n.t('verifyPreviousSigPrompt')}</p>
                        <div class="alert-box alert-warning"><strong>${i18n.t('internalRefLabel')}:</strong>
                            ${this.detectedRefId}
                        </div>
                        <input type="text" class="input-field" style="margin-bottom:15px;"
                               data-testid="input-handover-hash"
                               aria-label="${i18n.t('pasteHashPlaceholder')}"
                               .value="${this.handoverHashInput}" @input="${(e: any) => {
                            this.handoverHashInput = e.target.value;
                            this.handoverResult = 'idle';
                        }}" placeholder="${i18n.t('pasteHashPlaceholder')}">
                        ${this.handoverResult === 'success' ? html`
                            <div class="alert-box alert-success" data-testid="handover-success"
                                 .innerHTML=${i18n.t('statusVerified')}></div>` : ''}
                        ${this.handoverResult === 'fail' ? html`
                            <div class="alert-box alert-error" data-testid="handover-fail"
                                 .innerHTML=${i18n.t('statusMismatch')}></div>` : ''}
                        <div style="display:flex; gap:10px;">
                            <button class="btn btn-primary btn-block" data-testid="btn-verify-handover"
                                    @click=${this.checkHandover}>
                                ${i18n.t('verifyBtn')}
                            </button>
                            <button class="btn btn-block" data-testid="btn-skip-handover"
                                    @click=${() => { this.showHandoverModal = false; this.handoverResult = 'idle'; }}>
                                ${i18n.t('btnSkip')}
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}

            ${this.showProofModal ? html`
                <div class="modal-overlay">
                    <div class="modal-card center" data-testid="proof-modal" role="dialog" aria-modal="true"
                         aria-labelledby="proof-title">
                        <div style="color:var(--success); margin-bottom:15px; display:flex; justify-content:center;">
                            <div style="padding:15px; background:var(--success-bg); border-radius:50%;">${ICONS.check}
                            </div>
                        </div>
                        <h2 id="proof-title" style="color:#166534; margin-top:0;">${i18n.t('savedMsg')}</h2>
                        <p style="color:var(--text-sub); font-size:0.95rem; margin-bottom:20px;">
                            ${i18n.t('proveIdentityMsg')}</p>
                        <div style="background:var(--bg-app); padding:15px; margin:15px 0; border-radius:8px; border:1px solid var(--border); text-align:left;">
                            <div style="font-size:0.8rem; color:var(--text-sub); font-weight:600;">
                                ${i18n.t('internalRefLabel')}
                            </div>
                            <div style="font-family:monospace; font-size:1.1rem; color:var(--text-main); margin-bottom:15px;"
                                 data-testid="saved-doc-id">
                                ${this.lastSavedId}
                            </div>
                            <div style="font-size:0.8rem; color:var(--text-sub); font-weight:600; display:flex; align-items:center; gap:4px;">
                                ${ICONS.lock} ${i18n.t('hashLabel')}
                            </div>
                            <div style="font-family:monospace; font-size:0.75rem; color:var(--text-main); word-break:break-all; background:var(--border); padding:8px; border-radius:6px; margin-top:4px;"
                                 data-testid="saved-doc-hash">
                                ${this.lastSavedHash}
                            </div>
                        </div>
                        <div style="display:flex; gap:10px; margin-bottom:12px;">
                            <button class="btn btn-primary btn-block" data-testid="btn-copy-hash"
                                    @click=${this.copyHash}>
                                ${ICONS.copy} ${i18n.t('copyShort')}
                            </button>
                            <button class="btn btn-block" data-testid="btn-email-proof"
                                    @click=${this.sendProofEmail}>${ICONS.email}
                                ${i18n.t('email')}
                            </button>
                        </div>
                        <button class="btn btn-block" data-testid="btn-close-proof"
                                @click=${() => this.showProofModal = false}>
                            ${i18n.t('close')}
                        </button>
                    </div>
                </div>
            ` : ''}

            ${this.customPrompt.show ? html`
                <div class="modal-overlay" @click=${() => this.customPrompt.show = false}>
                    <div class="modal-card" data-testid="custom-prompt" role="dialog" aria-modal="true"
                         aria-labelledby="prompt-title" @click=${(e: Event) => e.stopPropagation()}>
                        <h3 id="prompt-title" style="margin-top:0;">${this.customPrompt.title}</h3>
                        <input type="text" class="input-field" data-testid="input-custom-prompt"
                               style="margin-bottom: 20px; font-size: 1rem;"
                               aria-label="${this.customPrompt.title}"
                               .value=${this.customPrompt.value}
                               placeholder=${this.customPrompt.placeholder}
                               @input=${(e: any) => this.customPrompt.value = e.target.value}
                               @keydown=${(e: KeyboardEvent) => {
                                   if (e.key === 'Enter') this.saveCustomPrompt();
                                   if (e.key === 'Escape') this.customPrompt.show = false;
                               }}>
                        <div style="display:flex; gap:10px; justify-content: flex-end;">
                            <button class="btn" data-testid="btn-cancel-prompt"
                                    @click=${() => this.customPrompt.show = false}>
                                ${i18n.t('cancel') || 'Cancel'}
                            </button>
                            <button class="btn btn-primary" data-testid="btn-save-prompt"
                                    @click=${this.saveCustomPrompt}>
                                ${i18n.t('done') || 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
        `;
    }
}