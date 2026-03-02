import {css, html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {pdfEngine} from '../lib/pdf-engine';
import {fileService} from '../lib/file-service';
import {i18n} from '../lib/i18n-service';
import {Annotation, AnnotationType, SignaturePayload} from '../types';
import './signature-modal';
import {ICONS} from '../lib/icons';
import {sharedStyles} from '../styles/shared-styles';
import {LANGUAGES} from '../i18n/locales';
import {HapticService} from '../lib/haptic-service';
import {WebAuthnService} from '../lib/webauthn-service';
import {preferences} from '../lib/preferences';
import {
    applyAnnotationStyle,
    applyToAllPages as applyToAllPagesStore,
    createCenteredAnnotation,
    deleteAnnotationById,
    isAnnotationLocked as isAnnotationLockedStore,
    updateAnnotationById
} from '../features/workspace/annotation-store';
import {redoHistory, takeSnapshot, undoHistory} from '../features/workspace/history-store';
import {runHandoverCheck} from '../features/workspace/handover-workflow';
import {computeDragMove, computeResizeWidthPct} from '../features/workspace/interaction-controller';
import {executeSave, finalizeSave, resolveHardwareUsage, shareLatestDocument} from '../features/workspace/save-workflow';
import {isNativePlatform} from '../lib/runtime-platform';

@customElement('pdf-workspace')
export class PdfWorkspace extends LitElement {
    @property() pdfName = '';
    @state() currentPage = 1;
    @state() totalPages = 0;
    @state() scale = 1.0;
    @state() hasHardwareSupport = false;
    @state() hardwarePref: 'prompt' | 'always' | 'never' = preferences.getHardwarePref() || 'prompt';
    @state() showHardwarePrompt = false;
    @state() rememberHardwareChoice = false;

    @state() showProofModal = false;
    @state() lastSavedId: string | null = null;
    @state() lastSavedHash: string | null = null;
    @state() lastSavedCode: string | null = null;
    @state() lastSaveHardwareFallback = false;
    @state() includeFooter = false;

    @state() validationMsg: string | null = null;
    @state() annotations: Annotation[] = [];
    @state() includeAudit = false;

    @state() showHandoverModal = false;
    @state() handoverHashInput = '';
    @state() handoverResult: 'idle' | 'success' | 'fail' = 'idle';
    @state() detectedRefId = '';
    @state() detectedAssertions: any[] = [];
    @state() signaturesChain: SignaturePayload[] = [];
    @state() previousHashManuallyVerified = true;
    @state() openedDocumentHash = '';

    @state() selectedIds: string[] = [];
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

    @state() guideLines: { axis: 'x' | 'y', pos: number }[] = [];

    @state() activeSidebar: 'thumbnails' | 'annotations' | null = preferences.getActiveSidebar();
    @state() thumbnailURLs: string[] = [];
    @state() isGeneratingThumbs = false;
    @state() uiMode: 'basic' | 'advanced' = preferences.getUiMode();

    @state() customPrompt: {
        show: boolean,
        title: string,
        value: string,
        placeholder: string,
        isIdentity: boolean,
        targetId?: string
    } = {show: false, title: '', value: '', placeholder: '', isIdentity: false};
    private trappedContainers = new WeakSet<HTMLElement>();

    private get hasEdits(): boolean {
        return this.annotations.length > 0 || this.includeAudit;
    }

    private get isBasicMode(): boolean {
        return this.uiMode === 'basic';
    }

    private persistActiveSidebar() {
        preferences.setActiveSidebar(this.activeSidebar);
    }

    private closeHandoverModal(markSkipped = false) {
        if (markSkipped && this.detectedRefId) {
            this.validationMsg = i18n.t('handoverSkippedMsg').replace('{ref}', this.detectedRefId);
            this.isVerified = false;
            this.previousHashManuallyVerified = false;
        }
        this.showHandoverModal = false;
        this.handoverResult = 'idle';
    }

    private setupFocusTrap(container: HTMLElement) {
        if (this.trappedContainers.has(container)) return;
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
        this.trappedContainers.add(container);
    }

    private generateId(): string {
        return crypto.randomUUID().split('-')[0];
    }

    private isAnnotationLocked(id: string): boolean {
        return isAnnotationLockedStore(this.annotations, id);
    }

    addIdentity() {
        const savedEmail = preferences.getUserEmail();
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
            preferences.setUserEmail(val);
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
        if (this.lastSavedCode) {
            body += `\n\n${i18n.t('handoverPinLabel')}: ${this.lastSavedCode}`;
        }
        window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
        this.showProofModal = false;
    }

    copyHash() {
        if (this.lastSavedHash) {
            const value = this.lastSavedCode
                ? `${this.lastSavedHash}\n${i18n.t('handoverPinLabel')}: ${this.lastSavedCode}`
                : this.lastSavedHash;
            navigator.clipboard.writeText(value);
            this.toast((i18n.t('hashPinCopied') as string) || 'Hash and PIN copied.');
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

        .brand-title {
            display: inline;
        }

        .verified-badge {
            display: inline-flex;
            align-items: center;
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

            .brand .brand-title {
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

        .annotations-panel {
            width: min(250px, 40vw);
            padding: 12px;
            align-items: stretch;
            background: var(--bg-surface);
            border-right: 1px solid var(--border);
        }

        @media (max-width: 1024px) {
            .annotations-panel {
                width: min(210px, 44vw);
                padding: 10px;
            }
        }

        @media (max-width: 768px) {
            .annotations-panel {
                width: min(170px, 46vw);
                padding: 8px;
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

        .draggable.locked {
            border-color: rgba(107, 114, 128, 0.4);
            cursor: not-allowed;
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

        .panel-toggle.active {
            background: var(--primary) !important;
            color: #fff !important;
            border-color: var(--primary) !important;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
        }

        .panel-toggle.active svg {
            stroke: currentColor;
        }

        .btn.toggle.active {
            background: var(--primary) !important;
            color: #fff !important;
            border-color: var(--primary) !important;
        }

        .modal-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .modal-actions .btn {
            flex: 1 1 140px;
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
        WebAuthnService.isAvailable().then(avail => this.hasHardwareSupport = avail);
        if (this.activeSidebar === 'annotations' && this.annotations.length === 0) {
            this.activeSidebar = 'thumbnails';
            this.persistActiveSidebar();
        }
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
            this.selectedIds = [];
            return;
        }

        // Tab: cycle through annotations on the current page
        if (e.key === 'Tab') {
            const pageAnns = this.annotations.filter(a => a.page === this.currentPage - 1);
            if (pageAnns.length > 0) {
                e.preventDefault();
                const lastSelected = this.selectedIds[this.selectedIds.length - 1];
                const idx = pageAnns.findIndex(a => a.id === lastSelected);
                let next: number;
                if (idx === -1) {
                    next = e.shiftKey ? pageAnns.length - 1 : 0;
                } else {
                    next = e.shiftKey
                        ? (idx - 1 + pageAnns.length) % pageAnns.length
                        : (idx + 1) % pageAnns.length;
                }
                this.selectedIds = [pageAnns[next].id];
            }
            return;
        }

        if (this.selectedIds.length === 0) return;

        // Delete selected annotation
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            const deletableIds = this.selectedIds.filter((id) => !this.isAnnotationLocked(id));
            if (deletableIds.length === 0) return;
            this.snapshot();
            this.annotations = this.annotations.filter(a => !deletableIds.includes(a.id));
            this.selectedIds = [];
            this.isDirty = true;
            return;
        }

        // Arrow keys: nudge selected annotation (Shift = 4× step)
        if (e.key.startsWith('Arrow')) {
            const annsToMove = this.annotations.filter(a => this.selectedIds.includes(a.id) && !a.lockedByChain);
            if (annsToMove.length === 0) return;
            e.preventDefault();
            if (!e.repeat) this.snapshot(); // Snapshot only on first keydown, not on hold
            const step = e.shiftKey ? 0.02 : 0.005;
            
            this.annotations = this.annotations.map(a => {
                if (this.selectedIds.includes(a.id)) {
                    let {xPct, yPct} = a;
                    if (e.key === 'ArrowLeft') xPct = Math.max(0, xPct - step);
                    else if (e.key === 'ArrowRight') xPct = Math.min(1 - a.widthPct, xPct + step);
                    else if (e.key === 'ArrowUp') yPct = Math.max(0, yPct - step);
                    else if (e.key === 'ArrowDown') yPct = Math.min(1, yPct + step);
                    return {...a, xPct, yPct};
                }
                return a;
            });
            this.isDirty = true;
        }
    };

    snapshot() {
        const next = takeSnapshot({history: this.history, future: this.future}, this.annotations);
        this.history = next.history;
        this.future = next.future;
    }

    undo() {
        const result = undoHistory({history: this.history, future: this.future}, this.annotations);
        if (!result.changed) return;
        HapticService.impact();
        this.history = result.state.history;
        this.future = result.state.future;
        this.annotations = result.annotations;
        this.selectedIds = [];
        this.isDirty = true;
    }

    redo() {
        const result = redoHistory({history: this.history, future: this.future}, this.annotations);
        if (!result.changed) return;
        HapticService.impact();
        this.history = result.state.history;
        this.future = result.state.future;
        this.annotations = result.annotations;
        this.selectedIds = [];
        this.isDirty = true;
    }

    async loadPdf(file: Uint8Array, name: string) {
        pdfEngine.destroy();
        this.pdfName = name;
        this.loadedBytes = file;
        this.openedDocumentHash = await pdfEngine.getIntegrityAnchorHash(file);
        this.previousHashManuallyVerified = true;
        this.isVerified = false;
        this.validationMsg = null;
        this.lastSavedId = null;
        this.lastSavedHash = null;
        this.lastSavedCode = null;
        this.lastSaveHardwareFallback = false;
        this.totalPages = await pdfEngine.load(file);
        const meta = await pdfEngine.readMetadataID(file);
        const existingID = meta.id;
        this.signaturesChain = meta.signatures || [];
        if (existingID || this.signaturesChain.length > 0) {
            this.includeAudit = true;
            this.toast(i18n.t('previousSigDetected'));
            this.detectedRefId = existingID || this.signaturesChain[this.signaturesChain.length - 1]?.refId || '';
            const latestSignature = this.signaturesChain[this.signaturesChain.length - 1];
            this.detectedAssertions = latestSignature?.webauthnData ? [{
                publicKey: latestSignature.webauthnData.publicKey,
                assertion: latestSignature.webauthnData.assertion
            }] : (meta.assertions || []);
            this.previousHashManuallyVerified = false;
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
            this.detectedRefId = '';
            this.detectedAssertions = [];
        }
        this.currentPage = 1;
        this.scale = window.innerWidth < 768 ? 0.55 : 1.0;
        this.annotations = [];
        this.selectedIds = [];
        if (this.activeSidebar === 'annotations') {
            this.activeSidebar = 'thumbnails';
            this.persistActiveSidebar();
        }
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
        const result = await runHandoverCheck({
            handoverInput: this.handoverHashInput,
            loadedBytes: this.loadedBytes,
            signaturesChain: this.signaturesChain,
            detectedAssertions: this.detectedAssertions,
            detectedRefId: this.detectedRefId,
            deps: {
                getFileHash: (bytes) => pdfEngine.getFileHash(bytes),
                getSixDigitCode: (hash) => pdfEngine.getSixDigitCode(hash),
                verifySignatureChain: (bytes) => pdfEngine.verifySignatureChain(bytes),
                verifyLocalAssertion: (publicKey, signature, authData, clientDataJSON) =>
                    WebAuthnService.verifyLocal(publicKey, signature, authData, clientDataJSON),
            },
        });

        this.handoverResult = result.handoverResult;
        this.isVerified = result.isVerified;
        this.previousHashManuallyVerified = result.previousHashManuallyVerified;
        const validationBase = result.validationMessageKey === 'handoverVerifiedMsg'
            ? i18n.t('handoverVerifiedMsg')
            : result.validationMessageKey === 'handoverHardwareFailMsg'
                ? i18n.t('handoverHardwareFailMsg')
                : i18n.t('handoverMismatchMsg');
        this.validationMsg = validationBase.replace('{ref}', this.detectedRefId);
        if (result.appendHardwareVerifiedSuffix) {
            this.validationMsg += ' + Hardware Sign Verified';
        }

        if (result.shouldAutoClose) {
            setTimeout(() => {
                this.closeHandoverModal(false);
                this.toast(i18n.t('integrityVerified'));
            }, 1500);
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
        if (changed.has('currentPage') && this.activeSidebar === 'thumbnails') {
            this.shadowRoot?.querySelector('.thumb-item.active')
                ?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        }
        if (changed.has('annotations') && this.activeSidebar === 'annotations' && this.annotations.length === 0) {
            this.activeSidebar = 'thumbnails';
            this.persistActiveSidebar();
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
        this.gotoPage(newPage);
    }

    gotoPage(page: number) {
        if (page >= 1 && page <= this.totalPages) {
            this.currentPage = page;
            this.selectedIds = [];
            void this.renderPage();
            if (this.viewport) {
                this.viewport.scrollTop = 0;
                this.viewport.scrollLeft = 0;
            }
        }
    }

    zoom(factor: number) {
        this.scale = Math.max(0.5, Math.min(3.0, this.scale + factor));
        void this.renderPage();
    }

    applyToAllPages(id: string) {
        if (this.isAnnotationLocked(id)) return;
        this.snapshot();
        const applied = applyToAllPagesStore({
            annotations: this.annotations,
            id,
            totalPages: this.totalPages,
            generateId: () => this.generateId(),
        });
        if (applied.addedCount > 0) {
            this.annotations = applied.annotations;
            this.isDirty = true;
            this.toast(i18n.t('appliedToPages').replace('{count}', applied.addedCount.toString()));
        }
    }

    addAnnotation(type: AnnotationType, data: string, aspectRatio = 1) {
        this.snapshot();
        HapticService.impact();
        const newAnn = createCenteredAnnotation({
            type,
            data,
            aspectRatio,
            currentPage: this.currentPage,
            pageRect: this.container.getBoundingClientRect(),
            viewportRect: this.viewport.getBoundingClientRect(),
            generateId: () => this.generateId(),
        });

        this.annotations = [...this.annotations, newAnn];
        this.selectedIds = [newAnn.id];
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
        if (this.isAnnotationLocked(id)) return;
        this.snapshot();
        HapticService.impact();
        this.annotations = deleteAnnotationById(this.annotations, id);
        if (this.selectedIds.includes(id)) {
            this.selectedIds = this.selectedIds.filter(selId => selId !== id);
        }
        this.isDirty = true;
    }

    updateAnnotation(id: string, updates: Partial<Annotation>) {
        if (this.isAnnotationLocked(id)) return;
        this.annotations = updateAnnotationById(this.annotations, id, updates);
        this.isDirty = true;
    }

    updateStyle(id: string, style: Partial<Annotation>) {
        if (this.isAnnotationLocked(id)) return;
        this.snapshot();
        this.annotations = applyAnnotationStyle(this.annotations, id, style);
        this.isDirty = true;
    }

    onContainerClick(e: Event) {
        const target = e.target as Element;
        if (target.closest('.draggable') || target.closest('.style-popup')) return;
        this.selectedIds = [];
    }

    private touchTimer: ReturnType<typeof setTimeout> | null = null;

    startDrag(e: MouseEvent | TouchEvent, id: string) {
        if (this.isAnnotationLocked(id)) return;
        const target = e.target as Element;
        const isControl = !!target.closest('.delete-btn') || !!target.closest('.resize-handle') || !!target.closest('.style-popup');

        if (isControl) {
            e.stopPropagation(); // Stop bubbling to prevent viewport from clearing selectedId
            return;
        }

        if (e.cancelable) e.preventDefault();
        e.stopPropagation();

        const isShift = 'shiftKey' in e ? e.shiftKey : false;
        
        const applySelection = (multi: boolean) => {
            if (multi) {
                if (this.selectedIds.includes(id)) {
                    this.selectedIds = this.selectedIds.filter(i => i !== id);
                } else {
                    this.selectedIds = [...this.selectedIds, id];
                }
            } else {
                if (!this.selectedIds.includes(id)) {
                    this.selectedIds = [id];
                }
            }
        };

        if ('touches' in e) {
            // Touch device: start a long-press timer for multi-select
            applySelection(false); // Default to single select initially
            this.touchTimer = setTimeout(() => {
                HapticService.impact();
                applySelection(true); // Toggle on long press
            }, 500);
        } else {
            // Mouse device: use Shift key
            applySelection(isShift);
        }
        
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
        if (this.isAnnotationLocked(id)) return;
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        this.isResizing = true;
        this.selectedIds = [id]; // Resize only works on one item at a time for simplicity
        this.interactionSnapshotTaken = false;
        this.interactionChanged = false;
    }

    handleGlobalMove = (e: MouseEvent | TouchEvent) => {
        if (this.selectedIds.length === 0 || (!this.isDragging && !this.isResizing)) return;
        if (e.cancelable) e.preventDefault();

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const rect = this.container.getBoundingClientRect();
        const primaryId = this.selectedIds[0];
        const ann = this.annotations.find((a) => a.id === primaryId);
        if (!ann) return;

        const takeSnapshotIfNeeded = () => {
            if (!this.interactionSnapshotTaken) {
                this.snapshot();
                this.interactionSnapshotTaken = true;
            }
        };

        if (this.isDragging) {
            const contentEl = this.shadowRoot?.querySelector('.draggable.selected img, .draggable.selected .text-content') as HTMLElement;
            const move = computeDragMove({
                clientX,
                clientY,
                rect,
                ann,
                annotations: this.annotations,
                selectedIds: this.selectedIds,
                dragOffset: this.dragOffset,
                visualSize: contentEl && contentEl.offsetWidth > 0 && contentEl.offsetHeight > 0
                    ? {
                        widthPct: contentEl.offsetWidth / rect.width,
                        heightPct: contentEl.offsetHeight / rect.height,
                    }
                    : undefined,
            });
            this.guideLines = move.guideLines;

            if (move.changed) {
                takeSnapshotIfNeeded();
                this.interactionChanged = true;
                this.annotations = move.nextAnnotations;
                this.isDirty = true;
                this.dragOffset = move.nextDragOffset;
            }

            // Collision detection for popup/delete
            this.container.toggleAttribute('data-near-top', move.nextYPct < 0.1);
            this.container.toggleAttribute('data-near-right', move.nextXPct > 0.85);

        } else if (this.isResizing) {
            const resized = computeResizeWidthPct({clientX, rect, ann});
            if (resized.changed) {
                takeSnapshotIfNeeded();
                this.interactionChanged = true;
                this.updateAnnotation(primaryId, {widthPct: resized.widthPct});
            }
        }
    };

    stopInteraction = () => {
        if (this.touchTimer) {
            clearTimeout(this.touchTimer);
            this.touchTimer = null;
        }
        const changed = this.interactionChanged;
        this.isDragging = false;
        this.isResizing = false;
        this.interactionSnapshotTaken = false;
        this.interactionChanged = false;
        if (changed) this.isDirty = true;
        this.guideLines = [];
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

    async addBiometric() {
        if (!this.loadedBytes) return;
        this.dispatchEvent(new CustomEvent('set-loading', {detail: true, bubbles: true, composed: true}));
        try {
            const hashHex = await pdfEngine.getFileHash(this.loadedBytes);
            // Convert hex to bytes
            const hashBytes = new Uint8Array(hashHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            
            const savedEmail = preferences.getUserEmail('User');
            const result = await WebAuthnService.sign(hashBytes, savedEmail);
            
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

            const newAnn: Annotation = {
                id: this.generateId(),
                type: 'biometric',
                page: this.currentPage - 1,
                xPct, yPct,
                widthPct: 0.25,
                lockedByChain: false,
                publicKey: result.publicKeySpki,
                assertion: JSON.stringify({
                    signature: result.signature,
                    authData: result.authData,
                    clientDataJSON: result.clientDataJSON
                })
            };

            this.annotations = [...this.annotations, newAnn];
            this.selectedIds = [newAnn.id];
            this.isDirty = true;
            this.toast(i18n.t('biometricVerified'));
        } catch (e: any) {
            console.error('Biometric Error', e);
            this.toast(i18n.t('biometricError'));
        } finally {
            this.dispatchEvent(new CustomEvent('set-loading', {detail: false, bubbles: true, composed: true}));
        }
    }

    private toast(msg: string) {
        this.dispatchEvent(new CustomEvent('toast', {detail: msg, bubbles: true, composed: true}));
    }

    public reset() {
        pdfEngine.destroy();
        this.annotations = [];
        this.signaturesChain = [];
        this.history = [];
        this.future = [];
        this.lastSaved = null;
        this.lastSavedBytes = null;
        this.pdfName = '';
        this.outputFilename = '';
        this.isDirty = false;
        this.isVerified = false;
        this.lastSavedCode = null;
        this.lastSaveHardwareFallback = false;
        this.previousHashManuallyVerified = true;
        this.openedDocumentHash = '';
        if (this.canvas) {
            this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.canvas.width = 0;
            this.canvas.height = 0;
        }
    }

    async saveDocument(opts?: { silentWeb?: boolean; showToast?: boolean }) {
        if (!this.hasEdits) {
            this.toast(i18n.t('noChanges') || 'No changes');
            return;
        }

        const hasVisualSig = this.annotations.some(a => a.type !== 'biometric');
        console.log('Save logic:', {hasHardwareSupport: this.hasHardwareSupport, hasVisualSig, pref: this.hardwarePref, isBasic: this.isBasicMode});

        const decision = await resolveHardwareUsage({
            hasHardwareSupport: this.hasHardwareSupport,
            hasVisualSig,
            hardwarePref: this.hardwarePref,
            isBasicMode: this.isBasicMode,
            requestPromptDecision: async () => {
                console.log('Showing hardware prompt modal...');
                this.showHardwarePrompt = true;
                return new Promise<boolean | null>((resolve) => {
                    this.hardwareResolver = resolve;
                });
            },
        });
        if (decision.cancelled) return;

        this.dispatchEvent(new CustomEvent('set-loading', {detail: true, bubbles: true, composed: true}));
        await new Promise((r) => setTimeout(r, 50));

        try {
            const executed = await executeSave({
                deps: {
                    saveProfessional: (...args: any[]) => (pdfEngine.saveProfessional as any)(...args),
                    savePdf: (filename, data) => fileService.savePdf(filename, data),
                    sharePdf: (file, bytes) => fileService.sharePdf(file, bytes),
                    getSavedEmail: () => preferences.getUserEmail('User'),
                    setHardwarePrefNever: () => {
                        this.hardwarePref = 'never';
                        preferences.setHardwarePref('never');
                    },
                    isNativePlatform,
                    toast: (msg) => this.toast(msg),
                    messages: {
                        hardwareProofUnavailable: i18n.t('hardwareProofUnavailable'),
                        exportingFile: i18n.t('exportingFile'),
                        savedMsg: i18n.t('savedMsg'),
                        noChanges: i18n.t('noChanges'),
                    },
                    hapticSuccess: () => HapticService.success(),
                    setLoading: (loading) => this.dispatchEvent(new CustomEvent('set-loading', {detail: loading, bubbles: true, composed: true})),
                },
                annotations: this.annotations,
                pdfName: this.pdfName,
                includeAudit: this.includeAudit,
                includeFooter: this.includeFooter,
                validationMsg: this.validationMsg,
                signaturesChain: this.signaturesChain,
                previousHashManuallyVerified: this.previousHashManuallyVerified,
                openedDocumentHash: this.openedDocumentHash,
                useHardware: decision.useHardware,
            });
            if (executed.hardwareFallbackUsed) {
                console.warn('Hardware proof fallback: browser could not embed WebAuthn public key proof; saving as visual-only.');
            }
            await this.finishSave(executed.result, opts);
        } catch (e: any) {
            console.error('Save Error', e);
            this.toast(e.message.includes('OOM') ? i18n.t('outOfMemory') : `${i18n.t('errorSaving')}: ${e.message}`);
            this.dispatchEvent(new CustomEvent('set-loading', {detail: false, bubbles: true, composed: true}));
        }
    }

    private async finishSave(result: {pdfBytes: Uint8Array, docId: string, finalHash: string, finalCode: string, signatures: SignaturePayload[]}, opts?: { silentWeb?: boolean; showToast?: boolean }) {
        const silentWeb = !!opts?.silentWeb;
        const showToast = opts?.showToast ?? true;
        const finalized = await finalizeSave({
            deps: {
                saveProfessional: (...args: any[]) => (pdfEngine.saveProfessional as any)(...args),
                savePdf: (filename, data) => fileService.savePdf(filename, data),
                sharePdf: (file, bytes) => fileService.sharePdf(file, bytes),
                getSavedEmail: () => preferences.getUserEmail('User'),
                setHardwarePrefNever: () => {
                    this.hardwarePref = 'never';
                    preferences.setHardwarePref('never');
                },
                isNativePlatform,
                toast: (msg) => this.toast(msg),
                messages: {
                    hardwareProofUnavailable: i18n.t('hardwareProofUnavailable'),
                    exportingFile: i18n.t('exportingFile'),
                    savedMsg: i18n.t('savedMsg'),
                    noChanges: i18n.t('noChanges'),
                },
                hapticSuccess: () => HapticService.success(),
                setLoading: (loading) => this.dispatchEvent(new CustomEvent('set-loading', {detail: loading, bubbles: true, composed: true})),
            },
            result,
            outputFilename: this.outputFilename,
            silentWeb,
            showToast,
        });
        this.lastSaved = finalized.saved;
        this.lastSavedBytes = finalized.savedBytes;
        this.isDirty = false;
        this.lastSavedId = result.docId;
        this.lastSavedHash = result.finalHash;
        this.lastSavedCode = result.finalCode;
        this.lastSaveHardwareFallback = !!result.signatures[result.signatures.length - 1]?.hardwareFallbackUsed;
        this.signaturesChain = result.signatures;
        this.loadedBytes = result.pdfBytes;
        this.openedDocumentHash = result.signatures[result.signatures.length - 1]?.integrityAnchorHash || result.finalHash;
        this.previousHashManuallyVerified = true;
        this.showProofModal = true;
        this.dispatchEvent(new CustomEvent('set-loading', {detail: false, bubbles: true, composed: true}));
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
        await shareLatestDocument({
            deps: {
                saveProfessional: (...args: any[]) => (pdfEngine.saveProfessional as any)(...args),
                savePdf: (filename, data) => fileService.savePdf(filename, data),
                sharePdf: (file, bytes) => fileService.sharePdf(file, bytes),
                getSavedEmail: () => preferences.getUserEmail('User'),
                setHardwarePrefNever: () => {
                    this.hardwarePref = 'never';
                    preferences.setHardwarePref('never');
                },
                isNativePlatform,
                toast: (msg) => this.toast(msg),
                messages: {
                    hardwareProofUnavailable: i18n.t('hardwareProofUnavailable'),
                    exportingFile: i18n.t('exportingFile'),
                    savedMsg: i18n.t('savedMsg'),
                    noChanges: i18n.t('noChanges'),
                },
                hapticSuccess: () => HapticService.success(),
                setLoading: (loading) => this.dispatchEvent(new CustomEvent('set-loading', {detail: loading, bubbles: true, composed: true})),
            },
            hasEdits: this.hasEdits,
            isDirty: this.isDirty,
            lastSavedBytes: this.lastSavedBytes,
            lastSaved: this.lastSaved,
            saveIfNeeded: async () => {
                await this.saveDocument({silentWeb: !isNativePlatform(), showToast: false});
            },
        });
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

    toggleUIMode() {
        this.uiMode = this.isBasicMode ? 'advanced' : 'basic';
        preferences.setUiMode(this.uiMode);
    }

    private getHardwareIcon() {
        if (this.hardwarePref === 'always') return ICONS.biometric;
        if (this.hardwarePref === 'never') return html`
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
                <path d="M5 12c0-2.8 2.2-5 5-5s5 2.2 5 5"/>
                <path d="M10 20v-4"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>`;
        return html`
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
                <path d="M10 20v-4"/>
                <circle cx="18" cy="19" r="3"/>
                <line x1="18" y1="16" x2="18" y2="16.01"/>
            </svg>`;
    }

    toggleHardwarePref() {
        if (this.hardwarePref === 'prompt') this.hardwarePref = 'always';
        else if (this.hardwarePref === 'always') this.hardwarePref = 'never';
        else this.hardwarePref = 'prompt';
        preferences.setHardwarePref(this.hardwarePref);
        this.toast(`${i18n.t('hardwareSign') || 'Hardware Sign'}: ${this.hardwarePref.toUpperCase()}`);
    }

    private hardwareResolver: ((val: boolean | null) => void) | null = null;

    async resolveHardwarePrompt(choice: boolean | null) {
        if (choice !== null && this.rememberHardwareChoice) {
            this.hardwarePref = choice ? 'always' : 'never';
            preferences.setHardwarePref(this.hardwarePref);
        }
        this.showHardwarePrompt = false;
        if (this.hardwareResolver) {
            this.hardwareResolver(choice);
            this.hardwareResolver = null;
        }
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
                    <span class="brand-title">${i18n.t('appTitle')}</span>
                    ${this.isVerified ? html`<span class="badge verified-badge"
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
                    <button data-testid="btn-add-date" class="btn" aria-label="${i18n.t('addDate')}"
                            @click=${this.addDateStamp}>
                        ${ICONS.date}<span class="btn-label" style="margin-left:6px;">${i18n.t('addDate')}</span>
                    </button>
                    <button data-testid="btn-toggle-advanced" class="btn"
                            aria-label="${this.isBasicMode ? i18n.t('moreTools') : i18n.t('lessTools')}"
                            @click=${this.toggleUIMode}>
                        ${ICONS.cog}<span class="btn-label" style="margin-left:6px;">${this.isBasicMode ? i18n.t('moreTools') : i18n.t('lessTools')}</span>
                    </button>
                    ${!this.isBasicMode ? html`
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
                        <button data-testid="btn-hw-pref" class="btn" aria-label="Hardware Sign Preference"
                                @click=${this.toggleHardwarePref}>
                            ${this.getHardwareIcon()}<span class="btn-label" style="margin-left:6px;">${i18n.t('hardwareSign') || 'Hardware Sign'}: ${this.hardwarePref.toUpperCase()}</span>
                        </button>
                    ` : ''}
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
                        ${!this.isBasicMode ? html`
                            <button data-testid="btn-toggle-footer" class="btn toggle ${this.includeFooter ? 'active' : ''}"
                                    style="padding: 8px 12px;"
                                    aria-label="${i18n.t('addPageFooter')}"
                                    @click=${() => {
                                        this.includeFooter = !this.includeFooter;
                                        this.isDirty = true;
                                    }} title="${i18n.t('addPageFooter')}">
                                ${ICONS.footer}
                            </button>
                        ` : ''}
                        ${(!this.isBasicMode || this.includeAudit) ? html`
                            <button data-testid="btn-toggle-audit" class="btn toggle ${this.includeAudit ? 'active' : ''}"
                                    style="padding: 8px 12px;"
                                    aria-label="${i18n.t('addAuditPage')}"
                                    @click=${() => {
                                        this.includeAudit = !this.includeAudit;
                                        this.isDirty = true;
                                    }} title="${i18n.t('addAuditPage')}">
                                ${ICONS.audit}
                            </button>
                        ` : ''}
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
                <button data-testid="m-btn-add-date" class="btn btn-tool" aria-label="${i18n.t('addDate')}"
                        @click=${this.addDateStamp}>
                    ${ICONS.date} <span>${i18n.t('addDate')}</span>
                </button>
                <button data-testid="m-btn-toggle-advanced" class="btn btn-tool"
                        aria-label="${this.isBasicMode ? i18n.t('moreTools') : i18n.t('lessTools')}"
                        @click=${this.toggleUIMode}>
                    ${ICONS.cog} <span>${this.isBasicMode ? i18n.t('moreTools') : i18n.t('lessTools')}</span>
                </button>
                ${(this.hasHardwareSupport && !this.isBasicMode) ? html`
                    <button data-testid="m-btn-hw-pref" class="btn btn-tool" aria-label="Hardware Sign Preference"
                            @click=${this.toggleHardwarePref}>
                        ${this.getHardwareIcon()} <span>${i18n.t('hardwareSign') || 'Hardware Sign'}: ${this.hardwarePref.toUpperCase()}</span>
                    </button>
                ` : ''}
                ${!this.isBasicMode ? html`
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
                ` : ''}
            </div>

            <div class="workspace-area">
                ${this.activeSidebar === 'thumbnails' && (this.thumbnailURLs.length > 0 || this.isGeneratingThumbs) ? html`
                    <div class="thumb-panel">
                        ${this.isGeneratingThumbs ? html`
                            <div style="display:flex; justify-content:center; padding:20px;">
                                <div class="spinner" style="width:24px; height:24px; border-width:2px;"></div>
                            </div>
                        ` : ''}
                        ${this.thumbnailURLs.map((url, i) => html`
                            <div class="thumb-item ${this.currentPage === i + 1 ? 'active' : ''}"
                                 data-testid="thumb-page-${i + 1}"
                                 aria-label="${i18n.t('pageLabel')} ${i + 1}"
                                 @click=${() => {
                                     this.currentPage = i + 1;
                                     this.selectedIds = [];
                                     void this.renderPage();
                                 }}>
                                <img src="${url}" alt="${i18n.t('pageLabel')} ${i + 1}" style="width:100%; display:block;">
                                <div style="font-size:0.6rem; color:#9ca3af; text-align:center; padding:2px 0;">
                                    ${i + 1}
                                </div>
                                ${this.annotations.some(a => a.page === i) ? html`
                                    <div style="position:absolute; top:2px; right:2px; width:8px; height:8px; border-radius:50%; background:var(--primary); border:1px solid #111827;"></div>
                                ` : ''}
                            </div>
                        `)}
                    </div>
                ` : this.activeSidebar === 'annotations' ? html`
                    <div class="thumb-panel annotations-panel">
                        <h4 style="color: var(--text-main); margin-top: 0; margin-bottom: 12px; font-size: 0.9rem;">${i18n.t('annotations')}</h4>
                        ${this.annotations.length === 0 ? html`
                            <div style="color: var(--text-sub); font-size: 0.8rem; text-align: center; margin-top: 20px;">
                                ${i18n.t('noAnnotations')}
                            </div>
                        ` : ''}
                        <div style="display: flex; flex-direction: column; gap: 8px; overflow-y: auto;">
                            ${this.annotations.map((ann) => html`
                                <div style="background: ${this.selectedIds.includes(ann.id) ? 'var(--primary)' : 'var(--bg-muted)'}; padding: 8px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; color: ${this.selectedIds.includes(ann.id) ? 'white' : 'var(--text-main)'}; border: 1px solid var(--border);"
                                     @click=${() => {
                                         if (this.currentPage !== ann.page + 1) {
                                             this.gotoPage(ann.page + 1);
                                         }
                                         this.selectedIds = [ann.id];
                                     }}>
                                    <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
                                        <div style="width: 16px; height: 16px; flex-shrink: 0; display:flex; align-items:center; justify-content:center;">
                                            ${ann.type === 'signature' ? ICONS.sign : ann.type === 'stamp' ? ICONS.stamp : ICONS.text}
                                        </div>
                                        <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                            ${ann.type === 'date' || ann.type === 'identity' ? ann.data : (ann.type.charAt(0).toUpperCase() + ann.type.slice(1))}
                                        </div>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                                        <span style="background: var(--bg-surface); color: var(--text-main); padding: 2px 6px; border-radius: 10px; font-size: 0.6rem; border: 1px solid var(--border);">${i18n.t('pageLabel')} ${ann.page + 1}</span>
                                    </div>
                                </div>
                            `)}
                        </div>
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
                                class="btn toggle panel-toggle ${this.activeSidebar === 'thumbnails' ? 'active' : ''}"
                                aria-label="${i18n.t('toggleThumbs') || 'Toggle Thumbnails'}"
                                aria-pressed="${this.activeSidebar === 'thumbnails'}"
                                style="padding:6px; border:none;"
                                @click=${() => {
                                    this.activeSidebar = this.activeSidebar === 'thumbnails' ? null : 'thumbnails';
                                    this.persistActiveSidebar();
                                    if (this.activeSidebar === 'thumbnails' && this.thumbnailURLs.length === 0) {
                                        void this.generateThumbnails();
                                    }
                                }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2.5">
                                <rect x="3" y="3" width="7" height="7"/>
                                <rect x="14" y="3" width="7" height="7"/>
                                <rect x="3" y="14" width="7" height="7"/>
                                <rect x="14" y="14" width="7" height="7"/>
                            </svg>
                        </button>
                        <button data-testid="btn-toggle-annotations"
                                class="btn toggle panel-toggle ${this.activeSidebar === 'annotations' ? 'active' : ''}"
                                aria-label="${(i18n.t as any)('annotations') || 'Toggle Annotations'}"
                                aria-pressed="${this.activeSidebar === 'annotations'}"
                                style="padding:6px; border:none;"
                                @click=${() => {
                                    this.activeSidebar = this.activeSidebar === 'annotations' ? null : 'annotations';
                                    this.persistActiveSidebar();
                                }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="8" y1="6" x2="21" y2="6"></line>
                                <line x1="8" y1="12" x2="21" y2="12"></line>
                                <line x1="8" y1="18" x2="21" y2="18"></line>
                                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                                <line x1="3" y1="18" x2="3.01" y2="18"></line>
                            </svg>
                        </button>
                    </div>

                    <div class="page-container" data-testid="page-container">
                        ${this.guideLines.map(guide => guide.axis === 'x' ? html`
                            <div style="position:absolute; left:${guide.pos * 100}%; top:0; bottom:0; width:1px; background:var(--primary); z-index:50;"></div>
                        ` : html`
                            <div style="position:absolute; top:${guide.pos * 100}%; left:0; right:0; height:1px; background:var(--primary); z-index:50;"></div>
                        `)}
                        <canvas id="pdf-canvas"></canvas>
                        ${this.annotations.filter(ann => ann.page === this.currentPage - 1).map(ann => {
                            const isSelected = this.selectedIds.includes(ann.id);
                            const isText = ann.type === 'date' || ann.type === 'identity';
                            const isLocked = !!ann.lockedByChain;
                            return html`
                                <div class="draggable ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''}"
                                     data-testid="annotation-${ann.id}"
                                     data-locked="${isLocked ? 'true' : 'false'}"
                                     role="group"
                                     aria-label="${ann.type} ${i18n.t('annotation') || 'annotation'}"
                                     style="left:${ann.xPct * 100}%; top:${ann.yPct * 100}%; width:${isText ? 'auto' : (ann.widthPct ? ann.widthPct * 100 + '%' : 'auto')}; ${isLocked ? 'opacity:0.92; cursor:not-allowed;' : ''}"
                                     @mousedown=${(e: any) => !isLocked && this.startDrag(e, ann.id)}
                                     @touchstart=${(e: any) => !isLocked && this.startDrag(e, ann.id)}>
                                    <button data-testid="btn-delete-ann" class="delete-btn"
                                            aria-label="${i18n.t('delete') || 'Delete'}"
                                            style="display:${isSelected && !isLocked ? 'flex' : 'none'};"
                                            @mousedown=${(e: Event) => {
                                                e.stopPropagation();
                                                this.deleteAnnotation(ann.id);
                                            }}
                                            @touchstart=${(e: Event) => {
                                                e.stopPropagation();
                                                this.deleteAnnotation(ann.id);
                                            }}>×
                                    </button>
                                    ${isSelected && isText && !isLocked ? html`
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
                                            <select data-testid="select-font"
                                                    aria-label="${i18n.t('fontFamily')}"
                                                    style="background:transparent; border:1px solid #374151; color:#fff; height:34px; border-radius:4px; cursor:pointer;"
                                                    @click=${(e: Event) => e.stopPropagation()}
                                                    @change=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.updateStyle(ann.id, {fontFamily: (e.target as HTMLSelectElement).value});
                                                    }}>
                                                <option value="Amiri" ?selected=${ann.fontFamily === 'Amiri' || !ann.fontFamily}>Amiri</option>
                                                <option value="Roboto" ?selected=${ann.fontFamily === 'Roboto'}>Roboto</option>
                                                <option value="Noto Sans" ?selected=${ann.fontFamily === 'Noto Sans'}>Noto Sans</option>
                                            </select>
                                            <input type="color" data-testid="input-color"
                                                   aria-label="${i18n.t('textColor')}"
                                                   value="${ann.color || '#000000'}"
                                                   style="background:transparent; border:1px solid #374151; height:34px; width:34px; border-radius:4px; cursor:pointer; padding: 0;"
                                                   @click=${(e: Event) => e.stopPropagation()}
                                                   @input=${(e: Event) => {
                                                       e.stopPropagation();
                                                       this.updateStyle(ann.id, {color: (e.target as HTMLInputElement).value});
                                                   }}>
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
                                    ` : isSelected && !isText && !isLocked ? html`
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
                                             style="position:absolute; bottom:-8px; right:-8px; width:16px; height:16px; background:var(--primary); border:3px solid white; border-radius:50%; cursor:nwse-resize; display:${isSelected && !isLocked ? 'block' : 'none'}; box-shadow:var(--shadow-raised);"
                                             @mousedown=${(e: any) => this.startResize(e, ann.id)}
                                             @touchstart=${(e: any) => this.startResize(e, ann.id)}></div>
                                        <img src="${ann.data}" alt="${ann.type} annotation"
                                             style="width:100%; display:block; pointer-events:none;"/>
                                    ` : html`
                                        <span class="text-content"
                                              style="font-size:${ann.fontSize || 12}px; font-weight:${ann.fontWeight || 'normal'}; font-family:${ann.fontFamily || 'Amiri'}; color:${ann.color || 'black'};"
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
                <div class="modal-overlay" @click=${() => this.closeHandoverModal(true)}>
                    <div class="modal-card" data-testid="handover-modal" role="dialog" aria-modal="true"
                         aria-labelledby="handover-title" @click=${(e: Event) => e.stopPropagation()}>
                        <h3 id="handover-title" style="margin-top:0;">${i18n.t('previousSigDetected')}</h3>
                        <p style="font-size:0.9rem; color:var(--text-sub); margin-bottom:15px;">
                            ${i18n.t('verifyPreviousSigPrompt')}</p>
                        <div class="alert-box alert-warning"><strong>${i18n.t('internalRefLabel')}:</strong>
                            ${this.detectedRefId}
                        </div>
                        <input type="text" class="input-field" style="margin-bottom:15px;"
                               data-testid="input-handover-hash"
                               aria-label="${i18n.t('handoverCodePlaceholder')}"
                               .value="${this.handoverHashInput}" @input="${(e: any) => {
                            this.handoverHashInput = e.target.value;
                            this.handoverResult = 'idle';
                        }}" placeholder="${i18n.t('handoverCodePlaceholder')}">
                        ${this.handoverResult === 'success' ? html`
                            <div class="alert-box alert-success" data-testid="handover-success"
                                 .innerHTML=${i18n.t('statusVerified')}></div>` : ''}
                        ${this.handoverResult === 'fail' ? html`
                            <div class="alert-box alert-error" data-testid="handover-fail"
                                 .innerHTML=${i18n.t('statusMismatch')}></div>` : ''}
                        <p style="margin:0 0 12px 0; color:#9a3412; font-size:0.82rem; text-align:left;">
                            ${i18n.t('handoverSkipRisk')}
                        </p>
                        <div class="modal-actions">
                            <button class="btn btn-primary btn-block" data-testid="btn-verify-handover"
                                    @click=${this.checkHandover}>
                                ${i18n.t('verifyBtn')}
                            </button>
                            <button class="btn btn-block" data-testid="btn-skip-handover"
                                    @click=${() => this.closeHandoverModal(true)}>
                                ${i18n.t('btnSkip')}
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}

            ${this.showProofModal ? html`
                <div class="modal-overlay" @click=${() => this.showProofModal = false}>
                    <div class="modal-card center" data-testid="proof-modal" role="dialog" aria-modal="true"
                         aria-labelledby="proof-title" @click=${(e: Event) => e.stopPropagation()}>
                        <div style="color:var(--success); margin-bottom:15px; display:flex; justify-content:center;">
                            <div style="padding:15px; background:var(--success-bg); border-radius:50%;">${ICONS.check}
                            </div>
                        </div>
                        <h2 id="proof-title" style="color:#166534; margin-top:0;">${i18n.t('savedMsg')}</h2>
                        <p style="color:var(--text-sub); font-size:0.95rem; margin-bottom:20px;">
                            ${i18n.t('proofSavedFileHelp')}</p>
                        <div style="background:var(--bg-app); padding:15px; margin:15px 0; border-radius:8px; border:1px solid var(--border); text-align:left;">
                            <div style="font-size:0.85rem; color:var(--text-main); font-weight:700; margin-bottom:10px;">
                                ${i18n.t('proofSavedFileTitle')}
                            </div>
                            <div style="font-size:0.8rem; color:var(--text-sub); font-weight:600;">
                                ${i18n.t('internalRefLabel')}
                            </div>
                            <div style="font-family:monospace; font-size:1.1rem; color:var(--text-main); margin-bottom:15px;"
                                 data-testid="saved-doc-id">
                                ${this.lastSavedId}
                            </div>
                            <div style="font-size:0.85rem; color:var(--text-main); font-weight:700; margin:8px 0 6px 0;">
                                ${i18n.t('proofShareHashTitle')}
                            </div>
                            <p style="margin:0 0 10px 0; color:var(--text-sub); font-size:0.82rem;">
                                ${i18n.t('proofShareHashHelp')}
                            </p>
                            <div style="font-size:0.8rem; color:var(--text-sub); font-weight:600; display:flex; align-items:center; gap:4px;">
                                ${ICONS.lock} ${i18n.t('hashLabel')}
                            </div>
                            <div style="font-family:monospace; font-size:0.75rem; color:var(--text-main); word-break:break-all; background:var(--border); padding:8px; border-radius:6px; margin-top:4px;"
                                 data-testid="saved-doc-hash">
                                ${this.lastSavedHash}
                            </div>
                            <div style="font-size:0.8rem; color:var(--text-sub); font-weight:600; margin-top:10px;">
                                ${i18n.t('handoverCodeLabel')}
                            </div>
                            <div style="font-family:monospace; font-size:1.2rem; letter-spacing:0.2rem; color:var(--text-main); background:var(--bg-surface); padding:8px; border-radius:6px; margin-top:4px;"
                                 data-testid="saved-handover-code">
                                ${this.lastSavedCode || '------'}
                            </div>
                            ${this.lastSaveHardwareFallback ? html`
                                <div class="alert-box alert-warning" data-testid="hardware-fallback-warning" style="margin-top:10px;">
                                    ${i18n.t('hardwareProofUnavailable')}
                                </div>
                            ` : ''}
                        </div>
                        <div class="modal-actions" style="margin-bottom:12px;">
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
                        <div class="modal-actions">
                            <button class="btn" data-testid="btn-cancel-prompt" style="flex:1;"
                                    @click=${() => this.customPrompt.show = false}>
                                ${i18n.t('cancel') || 'Cancel'}
                            </button>
                            <button class="btn btn-primary" data-testid="btn-save-prompt" style="flex:1;"
                                    @click=${this.saveCustomPrompt}>
                                ${i18n.t('done') || 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}

            ${this.showHardwarePrompt ? html`
                <div class="modal-overlay" @click=${() => this.resolveHardwarePrompt(null)}>
                    <div class="modal-card" data-testid="hardware-prompt-modal" role="dialog" aria-modal="true"
                         aria-labelledby="hw-prompt-title" @click=${(e: Event) => e.stopPropagation()}>
                        <h3 id="hw-prompt-title" style="margin-top:0;">${i18n.t('secureYourSignature') || 'Secure your signature?'}</h3>
                        <p style="font-size:0.95rem; color:var(--text-sub); margin-bottom:20px;">
                            ${i18n.t('secureYourSignatureHelp') || 'Add an invisible, mathematically verifiable hardware lock using FaceID, TouchID, or a Security Key.'}
                        </p>
                        
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:20px; cursor:pointer; font-size:0.9rem;">
                            <input type="checkbox" id="remember-hardware-pref" .checked=${this.rememberHardwareChoice} 
                                   @change=${(e: any) => this.rememberHardwareChoice = e.target.checked}>
                            ${i18n.t('rememberMyChoice') || "Remember my choice (Don't ask again)"}
                        </label>

                        <div class="modal-actions">
                            <button class="btn btn-primary" data-testid="btn-hw-yes" style="flex:1 1 100%;"
                                    @click=${() => this.resolveHardwarePrompt(true)}>
                                ${i18n.t('yesSecureIt') || 'Yes, Secure It'}
                            </button>
                            <button class="btn" data-testid="btn-hw-no" style="flex:1;"
                                    @click=${() => this.resolveHardwarePrompt(false)}>
                                ${i18n.t('noStandardSave') || 'No, Standard Save'}
                            </button>
                            <button class="btn" data-testid="btn-hw-cancel" style="flex:1;"
                                    @click=${() => this.resolveHardwarePrompt(null)}>
                                ${i18n.t('cancelSave') || 'Cancel'}
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
        `;
    }
}
