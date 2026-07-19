import {css, html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {styleMap} from 'lit/directives/style-map.js';
import {pdfEngine} from '../lib/pdf-engine';
import {fileService} from '../lib/file-service';
import {i18n} from '../lib/i18n-service';
import {Annotation, AnnotationType, DrawnSignaturePayload, SignaturePayload} from '../types';
import './signature-modal';
import './owq-modal';
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
import {HistoryController} from './controllers/history-controller';
import {InteractionController} from './controllers/interaction-controller';
import {runHandoverCheck} from '../features/workspace/handover-workflow';
import {executeSave, finalizeSave, resolveHardwareUsage, shareLatestDocument} from '../features/workspace/save-workflow';
import {isNativePlatform} from '../lib/runtime-platform';
import {
    validatePkcs12Certificate,
    wipeCertificateConfig
} from '../lib/pdf/cms-signature-service';
import {
    loadPresets as loadPresetsFromDb,
    persistPresets as persistPresetsToDb
} from '../lib/preset-store';
import type {CertificateSigningConfig} from '../types';

@customElement('pdf-workspace')
export class PdfWorkspace extends LitElement {
    private historyManager = new HistoryController(this);
    private interactionManager = new InteractionController(this as any);
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
    @state() isMultiSelectMode = false;

    @state() lastSaved: { filename: string; uri?: string } | null = null;
    private lastSavedBytes: Uint8Array | null = null;
    @state() outputFilename = '';
    @state() showStampLibraryModal = false;
    @state() stampPresets: Array<{ id: string; name: string; dataURL: string }> = [];
    @state() showCertificateModal = false;
    @state() certificatePassword = '';
    @state() certificateFileName = '';
    @state() certificateReady = false;
    private certificateConfig: CertificateSigningConfig | null = null;
    private pendingCertificateBytes: Uint8Array | null = null;
    private pendingCertificateName = '';

    @state() public isDirty = false;
    @state() isRendering = false;
    private touchTimer: ReturnType<typeof setTimeout> | null = null;

    private touchDragStart: { x: number; y: number } | null = null;
    private thumbObserver: IntersectionObserver | null = null;
    private thumbVisiblePages = new Set<number>();
    private thumbQueuedPages = new Set<number>();
    private thumbRenderingPages = new Set<number>();
    private thumbRenderAbortController: AbortController | null = null;
    private thumbQueueTimer: number | null = null;
    private thumbObserverRefreshTimer: number | null = null;
    private thumbRenderToken = 0;
    private readonly thumbScale = 0.18;
    private readonly maxThumbnailBlobUrls = 48;
    private readonly thumbVirtualItemHeight = 84;
    private readonly thumbVirtualOverscan = 8;
    private readonly maxStampUploadBytes = 5 * 1024 * 1024;
    private readonly maxStampImagePixels = 12_000_000;
    private readonly maxStampPresetCount = 30;
    private readonly maxStampPresetTotalBytes = 25 * 1024 * 1024;

    private loadedBytes: Uint8Array | null = null;
    @state() isVerified = false;

    @query('#pdf-canvas') canvas!: HTMLCanvasElement;
    @query('.page-container') container!: HTMLDivElement;
    @query('.viewport') viewport!: HTMLDivElement;
    @query('#cert-input') certInput!: HTMLInputElement;

    @state() activeSidebar: 'thumbnails' | 'annotations' | null = preferences.getActiveSidebar();
    @state() thumbnailURLs: Array<string | null> = [];
    @state() thumbPanelScrollTop = 0;
    @state() thumbPanelClientHeight = 0;
    @state() uiMode: 'basic' | 'advanced' = preferences.getUiMode();

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

    private get isBasicMode(): boolean {
        return this.uiMode === 'basic';
    }

    annotationsChanged(next: Annotation[]) {
        this.annotations = next;
    }

    updateAnnotation(id: string, updates: Partial<Annotation>) {
        if (this.isAnnotationLocked(id)) return;
        this.annotations = updateAnnotationById(this.annotations, id, updates);
        this.isDirty = true;
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

    private closeCustomPrompt() {
        // Reassign the object (not a nested mutation) so Lit re-renders and the
        // modal actually closes — mutating this.customPrompt.show does not trigger
        // an update, leaving the dialog stuck open on Cancel/Escape/backdrop.
        this.customPrompt = {...this.customPrompt, show: false};
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
            title: i18n.t('identityPrompt'),
            value: savedEmail,
            placeholder: i18n.t('emailPlaceholder'),
            isIdentity: true
        };
    }


    saveCustomPrompt() {
        const val = this.customPrompt.value.trim();
        if (this.customPrompt.isIdentity && val) {
            preferences.setUserEmail(val);
            const text = `${i18n.t('signedBy')}: ${val}`;
            this.addAnnotation('identity', text, 0);
        } else if (!this.customPrompt.isIdentity && this.customPrompt.targetId && val) {
            this.snapshot();
            this.annotations = this.annotations.map((a) => (a.id === this.customPrompt.targetId ? {
                ...a,
                data: val
            } : a));
            this.isDirty = true;
        }
        this.closeCustomPrompt();
    }

    sendProofEmail() {
        if (!this.lastSavedId) return;
        const subject = i18n.t('emailSubject').replace('{id}', this.lastSavedId);
        let body = i18n.t('emailBody').replace('{id}', this.lastSavedId).replace('{hash}', this.lastSavedHash || 'N/A');
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
            this.toast(i18n.t('hashPinCopied'));
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

        @media (max-width: 768px) {
            header {
                height: auto;
                min-height: 64px;
                padding-top: 8px;
            }
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

        .verified-badge-highlight {
            background: var(--success);
            color: var(--bg-surface);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.7rem;
            margin-left: 8px;
        }

        .icon-only-btn {
            border: none;
            padding: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 44px;
        }

        .exit-icon {
            display: block;
        }

        .exit-icon-rtl {
            transform: scaleX(-1);
        }

        .btn-label {
            margin-left: 6px;
        }

        .brand img {
            height: 32px;
            width: 32px;
            border-radius: var(--radius-sm);
        }

        /* --- Toolbar System --- */

        .toolbar-top {
            background: linear-gradient(180deg, var(--bg-surface) 0%, var(--workspace-toolbar-gradient-end) 100%);
            border-bottom: 1px solid var(--border);
            z-index: 90;
            display: flex;
            flex-direction: column;
        }

        .toolbar-row {
            display: flex;
            padding: 10px 12px;
            gap: 8px;
            align-items: center;
            overflow-x: auto;
            scrollbar-width: none;
        }

        .toolbar-row.secondary-tools {
            justify-content: space-between;
            background: var(--bg-muted);
        }

        .toolbar-group {
            display: flex;
            gap: 8px;
        }

        .toolbar-btn-compact {
            padding: 8px 12px;
        }

        .toolbar-divider {
            width: 1px;
            background: var(--border);
            margin: 4px 4px;
        }

        .toolbar-row::-webkit-scrollbar {
            display: none;
        }

        .toolbar-bottom {
            display: none; /* Desktop hidden */
            background: var(--bg-surface);
            border-top: 1px solid var(--border);
            padding: 8px 8px calc(max(env(safe-area-inset-bottom), 12px) + 8px);
            z-index: 200;
            box-shadow: var(--workspace-bottom-bar-shadow);
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
                padding-bottom: calc(100px + max(env(safe-area-inset-bottom), 12px)); /* Space for bottom bar + system nav area */
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
            border-radius: var(--radius-sm);
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

        .btn-tool:hover:not(:disabled) {
            background: var(--overlay-white-85) !important;
            color: var(--text-main) !important;
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

        .viewport.drag-active {
            touch-action: none;
        }

        .page-container {
            position: relative;
            box-shadow: var(--shadow-floating);
            background: white;
            border-radius: 2px;
            margin-bottom: 40px;
            transition: transform 0.2s ease;
            direction: ltr;
        }

        #pdf-canvas {
            display: block;
            direction: ltr;
        }

        .thumb-panel {
            width: 80px;
            background: var(--workspace-sidebar-bg);
            border-inline-end: 1px solid var(--workspace-sidebar-border);
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
            border-inline-end: 1px solid var(--border);
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
            background: var(--bg-surface);
            transition: all 0.2s;
            overflow: hidden;
            flex-shrink: 0;
            min-height: 60px;
            box-shadow: var(--shadow-flat);
        }

        .thumb-item.active {
            border-color: var(--workspace-thumb-active-border);
            transform: scale(1.05);
            box-shadow: var(--shadow-raised);
        }

        .thumb-image {
            width: 100%;
            display: block;
        }

        .thumb-placeholder {
            width: 100%;
            aspect-ratio: 1 / 1.35;
            background: linear-gradient(90deg, var(--bg-muted) 25%, var(--bg-app) 50%, var(--bg-muted) 75%);
            background-size: 200% 100%;
            animation: thumb-shimmer 1.1s linear infinite;
        }

        @keyframes thumb-shimmer {
            0% {
                background-position: 200% 0;
            }
            100% {
                background-position: -200% 0;
            }
        }

        .thumb-index {
            font-size: 0.6rem;
            color: var(--workspace-thumb-index);
            text-align: center;
            padding: 2px 0;
        }

        .thumb-spacer {
            width: 100%;
            flex-shrink: 0;
            pointer-events: none;
        }

        .thumb-has-annotations {
            position: absolute;
            top: 2px;
            right: 2px;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--primary);
            border: 1px solid var(--workspace-thumb-dot-border);
        }

        .annotations-title {
            color: var(--text-main);
            margin: 0 0 12px 0;
            font-size: 0.9rem;
        }

        .annotations-empty {
            color: var(--text-sub);
            font-size: 0.8rem;
            text-align: center;
            margin-top: 20px;
        }

        .annotations-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            overflow-y: auto;
        }

        .annotation-row {
            background: var(--bg-muted);
            padding: 8px;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.8rem;
            color: var(--text-main);
            border: 1px solid var(--border);
        }

        .annotation-row.is-selected {
            background: var(--primary);
            color: var(--bg-surface);
        }

        .annotation-row-main {
            display: flex;
            align-items: center;
            gap: 8px;
            overflow: hidden;
        }

        .annotation-row-icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .annotation-row-label {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .annotation-row-meta {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }

        .annotation-page-pill {
            background: var(--bg-surface);
            color: var(--text-main);
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 0.6rem;
            border: 1px solid var(--border);
        }

        .workspace-top-controls {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            background: var(--bg-surface);
            padding: 8px 16px;
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-flat);
            border: 1px solid var(--border);
        }

        .workspace-top-controls .btn {
            border: none;
        }

        .pager-btn {
            padding: 6px 12px;
        }

        .panel-toggle-btn {
            padding: 6px;
        }

        .page-indicator {
            font-weight: 800;
            font-size: 0.9rem;
            color: var(--text-main);
        }

        .workspace-control-divider {
            width: 1px;
            height: 20px;
            background: var(--border);
            margin: 0 4px;
        }

        .guide-line-x {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 1px;
            background: var(--primary);
            z-index: 50;
        }

        .guide-line-y {
            position: absolute;
            inset-inline: 0;
            height: 1px;
            background: var(--primary);
            z-index: 50;
        }

        .marquee-box {
            position: absolute;
            border: 1px dashed var(--primary);
            background: color-mix(in srgb, var(--primary), transparent 88%);
            pointer-events: none;
            z-index: 60;
        }

        /* Draggables */

        .draggable {
            position: absolute;
            cursor: grab;
            user-select: none;
            border: 2px solid transparent;
            border-radius: 4px;
            transition: border-color 0.2s;
            touch-action: none;
        }

        .draggable.selected {
            border-color: var(--primary);
            background: var(--workspace-selection-overlay);
            z-index: 100;
            box-shadow: 0 0 0 2px var(--workspace-selection-outline);
        }

        .draggable.locked {
            border-color: var(--workspace-locked-border);
            cursor: not-allowed;
            opacity: 0.92;
        }

        .delete-btn {
            position: absolute;
            top: -14px;
            right: -14px;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: var(--bg-surface);
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
            inset-inline-start: 50%;
            transform: translateX(-50%);
            background: var(--workspace-style-popup-bg);
            border-radius: 8px;
            padding: 6px;
            display: flex;
            gap: 8px;
            z-index: 200;
            box-shadow: var(--shadow-floating);
            transition: top 0.2s;
        }

        .style-tool-btn {
            background: transparent;
            border: 1px solid var(--workspace-style-tool-border);
            color: var(--workspace-style-tool-text);
            width: 34px;
            height: 34px;
            border-radius: 4px;
            cursor: pointer;
        }

        .style-tool-btn.is-active {
            background: var(--primary);
        }

        .style-tool-btn-bold {
            font-weight: bold;
        }

        .style-tool-select {
            background: transparent;
            border: 1px solid var(--workspace-style-tool-border);
            color: var(--workspace-style-tool-text);
            height: 34px;
            border-radius: 4px;
            cursor: pointer;
        }

        .style-tool-color {
            background: transparent;
            border: 1px solid var(--workspace-style-tool-border);
            height: 34px;
            width: 34px;
            border-radius: 4px;
            cursor: pointer;
            padding: 0;
        }

        .resize-handle {
            position: absolute;
            bottom: -8px;
            inset-inline-end: -8px;
            width: 16px;
            height: 16px;
            background: var(--primary);
            border: 3px solid var(--bg-surface);
            border-radius: 50%;
            cursor: nwse-resize;
            box-shadow: var(--shadow-raised);
        }

        .draggable-stamp {
            width: 100%;
            display: block;
            pointer-events: none;
        }

        .hardware-warning-top-gap {
            margin-top: 10px;
        }

        .prompt-input {
            margin-bottom: 20px;
            font-size: 1rem;
        }

        .hardware-choice-label {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 20px;
            cursor: pointer;
            font-size: 0.9rem;
        }

        .stamp-presets {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin: 10px 0 14px 0;
        }

        .stamp-library-close-actions {
            margin-top: 10px;
        }

        .stamp-preset {
            position: relative;
            width: 84px;
            height: 56px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-surface);
            cursor: pointer;
            overflow: hidden;
            padding: 0;
        }

        .stamp-preset img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            pointer-events: none;
        }

        .stamp-preset-name {
            position: absolute;
            inset-inline: 0;
            bottom: 0;
            font-size: 0.6rem;
            text-align: center;
            background: color-mix(in srgb, var(--bg-surface), transparent 15%);
            color: var(--text-main);
            padding: 1px 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .stamp-preset-delete {
            position: absolute;
            top: 2px;
            inset-inline-end: 2px;
            width: 18px;
            height: 18px;
            border: none;
            border-radius: 50%;
            background: color-mix(in srgb, var(--danger), transparent 15%);
            color: var(--bg-surface);
            cursor: pointer;
            line-height: 1;
            font-size: 11px;
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
            color: var(--bg-surface) !important;
            border-color: var(--primary) !important;
            box-shadow: 0 0 0 3px var(--workspace-active-ring);
        }

        .panel-toggle.active svg {
            stroke: currentColor;
        }

        .btn.toggle.active {
            background: var(--primary) !important;
            color: var(--bg-surface) !important;
            border-color: var(--primary) !important;
        }

        /* Toolbar scroll indicator gradient */

        .toolbar-row::after {
            content: '';
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: 30px;
            background: linear-gradient(to right, transparent, var(--workspace-toolbar-gradient-end));
            pointer-events: none;
            opacity: 0.8;
        }
    `];

    private onLangChanged = () => {
        const dir = i18n.lang === 'ar' ? 'rtl' : 'ltr';
        this.dir = dir;
        this.setAttribute('dir', dir);
        this.requestUpdate();
    };

    connectedCallback() {
        super.connectedCallback();
        WebAuthnService.getAvailabilityStatus()
            .then((status) => {
                this.hasHardwareSupport = status.available;
                if (!status.available) {
                    console.info('[OWQ][HARDWARE_SIGN_UNAVAILABLE]', status.reason);
                }
            })
            .catch(() => {
                this.hasHardwareSupport = false;
            });
        void this.loadStampPresets();
        if (this.activeSidebar === 'annotations' && this.annotations.length === 0) {
            this.activeSidebar = 'thumbnails';
            this.persistActiveSidebar();
        }
        const dir = i18n.lang === 'ar' ? 'rtl' : 'ltr';
        this.dir = dir;
        this.setAttribute('dir', dir);
        window.addEventListener('lang-changed', this.onLangChanged);
        window.addEventListener('mousemove', this.handleGlobalMove);
        window.addEventListener('touchmove', this.handleGlobalMove as any, {passive: false});
        window.addEventListener('mouseup', this.stopInteraction);
        window.addEventListener('touchend', this.stopInteraction);
        window.addEventListener('touchcancel', this.stopInteraction);
        window.addEventListener('keydown', this.handleKeyboard);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.resetThumbnailState();
        window.removeEventListener('lang-changed', this.onLangChanged);
        window.removeEventListener('mousemove', this.handleGlobalMove);
        window.removeEventListener('touchmove', this.handleGlobalMove as any);
        window.removeEventListener('mouseup', this.stopInteraction);
        window.removeEventListener('touchend', this.stopInteraction);
        window.removeEventListener('touchcancel', this.stopInteraction);
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
        this.historyManager.snapshot(this.annotations);
    }

    undo() {
        this.annotations = this.historyManager.undo(this.annotations);
        this.selectedIds = [];
        this.isDirty = true;
    }

    redo() {
        this.annotations = this.historyManager.redo(this.annotations);
        this.selectedIds = [];
        this.isDirty = true;
    }

    async loadPdf(file: Uint8Array, name: string) {
        pdfEngine.destroy();
        this.resetThumbnailState();
        this.clearCertificateSession();
        this.pdfName = name;
        this.loadedBytes = file;
        try {
            this.openedDocumentHash = await pdfEngine.getIntegrityAnchorHash(file);
        } catch (error) {
            // Some Android WebView/PDF edge cases fail deterministic normalization.
            // Fall back to direct SHA-256 so the document can still be opened/signed.
            console.error('[OWQ][INTEGRITY_HASH_FALLBACK]', error);
            this.openedDocumentHash = await pdfEngine.getFileHash(file);
        }
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
        this.historyManager.reset();

        const cleanName = name.replace(/_signed_\d{4}-\d{2}-\d{2}(_\d{4})?.*$/, '').replace(/\.pdf$/i, '');
        const now = new Date();
        const datePart = now.toISOString().slice(0, 10);
        const timePart = now.toTimeString().slice(0, 5).replace(':', '');
        this.outputFilename = `${cleanName}_signed_${datePart}_${timePart}`;
        this.thumbnailURLs = new Array(this.totalPages).fill(null);

        await this.updateComplete;
        void this.renderPage();
        if (this.activeSidebar === 'thumbnails') {
            this.setupThumbnailObserver();
        }
        this.queueVisibleThumbnailsNow();
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
            this.validationMsg += ` + ${i18n.t('hardwareSignVerifiedSuffix')}`;
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
        this.isRendering = true;
        try {
            const renderScale = Math.min(3.0, 1.5 * this.scale);
            await pdfEngine.renderPage(this.currentPage, this.canvas, renderScale);
        } finally {
            this.isRendering = false;
        }
    }

    async generateThumbnails() {
        if (this.totalPages === 0) return;
        if (this.thumbnailURLs.length !== this.totalPages) {
            this.thumbnailURLs = new Array(this.totalPages).fill(null);
        }
        this.setupThumbnailObserver();
        this.queueVisibleThumbnailsNow();
    }

    updated(changed: Map<string, unknown>) {
        if (changed.has('currentPage') && this.activeSidebar === 'thumbnails') {
            this.ensureThumbPageVisible(this.currentPage);
            this.scheduleThumbObserverRefresh();
        }
        if (changed.has('activeSidebar')) {
            if (this.activeSidebar === 'thumbnails') {
                this.setupThumbnailObserver();
                this.queueVisibleThumbnailsNow();
            } else {
                this.disconnectThumbnailObserver();
            }
        }
        if (changed.has('thumbPanelScrollTop') || changed.has('thumbPanelClientHeight')) {
            this.scheduleThumbObserverRefresh();
        }
        if (changed.has('annotations') && this.activeSidebar === 'annotations' && this.annotations.length === 0) {
            this.activeSidebar = 'thumbnails';
            this.persistActiveSidebar();
        }
        if (changed.has('selectedIds') && this.selectedIds.length === 0) {
            this.isMultiSelectMode = false;
        }
    }

    private setupThumbnailObserver() {
        if (this.activeSidebar !== 'thumbnails' || this.totalPages === 0) return;
        const panel = this.shadowRoot?.querySelector('.thumb-panel');
        if (!panel) return;
        if (this.thumbPanelClientHeight !== (panel as HTMLElement).clientHeight) {
            this.thumbPanelClientHeight = (panel as HTMLElement).clientHeight;
        }

        this.disconnectThumbnailObserver();
        this.thumbVisiblePages.clear();
        this.thumbObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const pageAttr = (entry.target as HTMLElement).dataset.page;
                if (!pageAttr) continue;
                const page = Number(pageAttr);
                if (!Number.isFinite(page)) continue;
                if (entry.isIntersecting) {
                    this.thumbVisiblePages.add(page);
                } else {
                    this.thumbVisiblePages.delete(page);
                }
            }
            this.scheduleThumbnailQueueFlush();
        }, {
            root: panel,
            rootMargin: '160px 0px',
            threshold: 0.01
        });

        for (const el of panel.querySelectorAll('.thumb-item[data-page]')) {
            this.thumbObserver.observe(el);
        }
    }

    private disconnectThumbnailObserver() {
        if (this.thumbObserver) {
            this.thumbObserver.disconnect();
            this.thumbObserver = null;
        }
        if (this.thumbRenderAbortController) {
            this.thumbRenderAbortController.abort();
            this.thumbRenderAbortController = null;
        }
        if (this.thumbQueueTimer != null) {
            window.clearTimeout(this.thumbQueueTimer);
            this.thumbQueueTimer = null;
        }
        this.thumbVisiblePages.clear();
        this.thumbQueuedPages.clear();
        this.thumbRenderingPages.clear();
        if (this.thumbObserverRefreshTimer != null) {
            window.clearTimeout(this.thumbObserverRefreshTimer);
            this.thumbObserverRefreshTimer = null;
        }
        this.thumbRenderToken++;
    }

    private scheduleThumbObserverRefresh() {
        if (this.activeSidebar !== 'thumbnails') return;
        if (this.thumbObserverRefreshTimer != null) {
            window.clearTimeout(this.thumbObserverRefreshTimer);
        }
        this.thumbObserverRefreshTimer = window.setTimeout(() => {
            this.thumbObserverRefreshTimer = null;
            this.setupThumbnailObserver();
            this.queueVisibleThumbnailsNow();
        }, 40);
    }

    private scheduleThumbnailQueueFlush() {
        if (this.thumbQueueTimer != null) {
            window.clearTimeout(this.thumbQueueTimer);
        }
        this.thumbQueueTimer = window.setTimeout(() => {
            this.thumbQueueTimer = null;
            this.queueVisibleThumbnailsNow();
        }, 80);
    }

    private queueVisibleThumbnailsNow() {
        if (this.activeSidebar !== 'thumbnails' || this.totalPages === 0) return;
        let focused: number[] = [];
        if (this.thumbVisiblePages.size > 0) {
            focused = Array.from(this.thumbVisiblePages).sort((a, b) => a - b);
        } else {
            const windowed = this.getThumbVirtualWindow();
            if (windowed.endPage >= windowed.startPage) {
                const winCount = windowed.endPage - windowed.startPage + 1;
                focused = Array.from({length: winCount}, (_, i) => windowed.startPage + i);
            } else {
                focused = [this.currentPage];
            }
        }
        const targets = new Set<number>(focused);
        for (const page of focused) {
            if (page > 1) targets.add(page - 1);
            if (page < this.totalPages) targets.add(page + 1);
        }
        const panelHeight = this.thumbPanelClientHeight || 500;
        const approxTotalHeight = this.totalPages * this.thumbVirtualItemHeight;
        const nearBottom = (this.thumbPanelScrollTop + panelHeight) >= (approxTotalHeight - (this.thumbVirtualItemHeight * 2));
        const pages = Array.from(targets)
            .filter((page) => !this.thumbnailURLs[page - 1])
            .sort((a, b) => nearBottom ? b - a : a - b);
        this.thumbQueuedPages = new Set(pages);
        if (this.thumbRenderAbortController) {
            this.thumbRenderAbortController.abort();
            this.thumbRenderAbortController = null;
        }
        this.thumbRenderToken++;
        void this.processThumbnailQueue(this.thumbRenderToken);
    }

    private async processThumbnailQueue(token: number) {
        for (const page of Array.from(this.thumbQueuedPages)) {
            if (token !== this.thumbRenderToken) return;
            if (!this.thumbQueuedPages.has(page)) continue;
            if (this.thumbRenderingPages.has(page)) continue;
            if (this.thumbnailURLs[page - 1]) continue;
            this.thumbQueuedPages.delete(page);
            this.thumbRenderingPages.add(page);
            const abortController = new AbortController();
            this.thumbRenderAbortController = abortController;
            try {
                const url = await this.renderThumbnailBlobUrl(page, abortController.signal);
                if (token !== this.thumbRenderToken) {
                    URL.revokeObjectURL(url);
                    return;
                }
                const prev = this.thumbnailURLs[page - 1];
                if (prev) URL.revokeObjectURL(prev);
                const next = [...this.thumbnailURLs];
                next[page - 1] = url;
                this.thumbnailURLs = this.trimThumbnailCache(next);
            } catch (error) {
                if (!(error instanceof DOMException && error.name === 'AbortError')) {
                    // Keep placeholder if rendering fails.
                }
            } finally {
                if (this.thumbRenderAbortController === abortController) {
                    this.thumbRenderAbortController = null;
                }
                this.thumbRenderingPages.delete(page);
            }
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        }
    }

    private async renderThumbnailBlobUrl(page: number, signal?: AbortSignal): Promise<string> {
        const offscreen = document.createElement('canvas');
        await pdfEngine.renderPage(page, offscreen, this.thumbScale, {signal});
        const blob = await new Promise<Blob>((resolve, reject) => {
            if (typeof offscreen.toBlob === 'function') {
                offscreen.toBlob((result) => {
                    if (result) {
                        resolve(result);
                        return;
                    }
                    try {
                        const dataUrl = offscreen.toDataURL('image/jpeg', 0.75);
                        resolve(this.dataUrlToBlob(dataUrl));
                    } catch (error) {
                        reject(error);
                    }
                }, 'image/jpeg', 0.75);
                return;
            }
            try {
                const dataUrl = offscreen.toDataURL('image/jpeg', 0.75);
                resolve(this.dataUrlToBlob(dataUrl));
            } catch (error) {
                reject(error);
            }
        });
        return URL.createObjectURL(blob);
    }

    private dataUrlToBlob(dataUrl: string): Blob {
        const parts = dataUrl.split(',');
        if (parts.length !== 2) throw new Error('thumb-data-url-invalid');
        const header = parts[0];
        const payload = parts[1];
        const mimeMatch = header.match(/data:(.*?);base64/);
        const mime = mimeMatch?.[1] || 'image/jpeg';
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], {type: mime});
    }

    private trimThumbnailCache(urls: Array<string | null>): Array<string | null> {
        const loadedPages: number[] = [];
        for (let i = 0; i < urls.length; i++) {
            if (urls[i]) loadedPages.push(i + 1);
        }
        if (loadedPages.length <= this.maxThumbnailBlobUrls) return urls;

        const keepPages = new Set<number>();
        const pinPage = (p: number) => {
            if (p >= 1 && p <= this.totalPages) keepPages.add(p);
        };
        pinPage(this.currentPage);
        pinPage(this.currentPage - 1);
        pinPage(this.currentPage + 1);
        pinPage(this.currentPage - 2);
        pinPage(this.currentPage + 2);
        for (const p of this.thumbVisiblePages) {
            pinPage(p);
            pinPage(p - 1);
            pinPage(p + 1);
        }

        const distanceToFocus = (page: number) => {
            if (keepPages.has(page)) return -1;
            const anchors = [this.currentPage, ...Array.from(this.thumbVisiblePages)];
            let min = Number.POSITIVE_INFINITY;
            for (const anchor of anchors) {
                min = Math.min(min, Math.abs(anchor - page));
            }
            return min;
        };

        const evictable = loadedPages
            .filter((p) => !keepPages.has(p))
            .sort((a, b) => distanceToFocus(b) - distanceToFocus(a));

        let loadedCount = loadedPages.length;
        for (const page of evictable) {
            if (loadedCount <= this.maxThumbnailBlobUrls) break;
            const idx = page - 1;
            const current = urls[idx];
            if (!current) continue;
            URL.revokeObjectURL(current);
            urls[idx] = null;
            loadedCount--;
        }
        return urls;
    }

    private revokeThumbnailUrls() {
        for (const url of this.thumbnailURLs) {
            if (url) URL.revokeObjectURL(url);
        }
    }

    private resetThumbnailState() {
        this.disconnectThumbnailObserver();
        this.revokeThumbnailUrls();
        this.thumbnailURLs = [];
        this.thumbPanelScrollTop = 0;
        this.thumbPanelClientHeight = 0;
    }

    private onThumbPanelScroll = (e: Event) => {
        const panel = e.currentTarget as HTMLElement;
        this.thumbPanelScrollTop = panel.scrollTop;
        this.thumbPanelClientHeight = panel.clientHeight;
        this.scheduleThumbnailQueueFlush();
    };

    private ensureThumbPageVisible(page: number) {
        const panel = this.shadowRoot?.querySelector('.thumb-panel') as HTMLElement | null;
        if (!panel) return;
        const top = (page - 1) * this.thumbVirtualItemHeight;
        const bottom = top + this.thumbVirtualItemHeight;
        const viewTop = panel.scrollTop;
        const viewBottom = viewTop + panel.clientHeight;
        if (top < viewTop) {
            panel.scrollTo({top, behavior: 'smooth'});
        } else if (bottom > viewBottom) {
            panel.scrollTo({top: bottom - panel.clientHeight, behavior: 'smooth'});
        }
    }

    private getThumbVirtualWindow() {
        if (this.totalPages === 0) {
            return {startPage: 1, endPage: 0, topSpacer: 0, bottomSpacer: 0};
        }
        const panelHeight = this.thumbPanelClientHeight || 500;
        const firstVisible = Math.floor(this.thumbPanelScrollTop / this.thumbVirtualItemHeight);
        const startIndex = Math.max(0, firstVisible - this.thumbVirtualOverscan);
        const visibleCount = Math.ceil(panelHeight / this.thumbVirtualItemHeight) + (this.thumbVirtualOverscan * 2);
        const endIndex = Math.min(this.totalPages - 1, startIndex + visibleCount - 1);
        return {
            startPage: startIndex + 1,
            endPage: endIndex + 1,
            topSpacer: startIndex * this.thumbVirtualItemHeight,
            bottomSpacer: Math.max(0, (this.totalPages - 1 - endIndex) * this.thumbVirtualItemHeight),
        };
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

    addAnnotation(type: AnnotationType, data: string, aspectRatio = 1, widthPct?: number) {
        this.snapshot();
        HapticService.impact();
        const newAnn = createCenteredAnnotation({
            type,
            data,
            aspectRatio,
            widthPct,
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
        const text = i18n.t('enterText');
        this.addAnnotation('date', text, 0.5);
    }

    handleTextEdit(id: string, currentText: string | undefined) {
        this.customPrompt = {
            show: true,
            title: i18n.t('editText'),
            value: currentText || '',
            placeholder: i18n.t('typeHerePlaceholder'),
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
        this.isMultiSelectMode = false;
    }

    private getPointFromEvent(e: MouseEvent | TouchEvent) {
        if ('touches' in e) {
            const t = e.touches[0] || (e as TouchEvent).changedTouches?.[0];
            if (!t) return {x: 0, y: 0};
            return {x: t.clientX, y: t.clientY};
        }
        return {x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY};
    }

    updateMarqueeSelection(append: boolean) {
        if (!this.container) return;
        const box = this.interactionManager.marqueeBox;
        if (!box) return;
        const left = box.left;
        const right = box.left + box.width;
        const top = box.top;
        const bottom = box.top + box.height;

        const hitIds: string[] = [];
        const nodes = this.shadowRoot?.querySelectorAll<HTMLElement>('.page-container .draggable') || [];
        nodes.forEach((node) => {
            const annId = node.dataset.annId;
            if (!annId) return;
            const nodeLeft = node.offsetLeft;
            const nodeTop = node.offsetTop;
            const nodeRight = nodeLeft + node.offsetWidth;
            const nodeBottom = nodeTop + node.offsetHeight;
            const intersects = nodeLeft <= right && nodeRight >= left && nodeTop <= bottom && nodeBottom >= top;
            if (intersects) hitIds.push(annId);
        });

        if (append) {
            this.selectedIds = Array.from(new Set([...(this.interactionManager as any).marqueeBaseIds, ...hitIds]));
            return;
        }
        this.selectedIds = hitIds;
    }

    private startMarqueeSelection(e: MouseEvent) {
        if (e.button !== 0) return;
        const target = e.target as Element;
        if (target.closest('.draggable') || target.closest('.style-popup')) return;
        if (!this.container) return;

        const rect = this.container.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        this.interactionManager.startMarquee(x, y, e.shiftKey);
        e.preventDefault();
    }

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

            if (this.isMultiSelectMode) {
                applySelection(true);
                return;
            }
            // Touch device: start a long-press timer for multi-select
            applySelection(false); // Default to single select initially
            const startPoint = this.getPointFromEvent(e);
            this.touchDragStart = {x: startPoint.x, y: startPoint.y};
            this.touchTimer = setTimeout(() => {

                this.isMultiSelectMode = true;
                HapticService.impact();
                if (!this.selectedIds.includes(id)) {
                    this.selectedIds = [...this.selectedIds, id];
                }
            }, 500);
        } else {
            // Mouse device: use Shift key
            applySelection(isShift);
        }
        
        const ann = this.annotations.find((a) => a.id === id);
        if (ann) {
            this.interactionManager.startDragging(e, id, ann);
        }
    }

    startResize(e: MouseEvent | TouchEvent, id: string) {
        if (this.isAnnotationLocked(id)) return;
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        this.interactionManager.startResizing(id);
    }

    handleGlobalMove = (e: MouseEvent | TouchEvent) => {
        if ('touches' in e && this.touchTimer && this.touchDragStart && e.touches.length > 0) {
            const dx = e.touches[0].clientX - this.touchDragStart.x;
            const dy = e.touches[0].clientY - this.touchDragStart.y;
            if ((dx * dx + dy * dy) > (12 * 12)) {
                clearTimeout(this.touchTimer);
                this.touchTimer = null;
            }
        }
        this.interactionManager.handleGlobalMove(e);
    };

    stopInteraction = () => {
        if (this.touchTimer) {
            clearTimeout(this.touchTimer);
            this.touchTimer = null;
        }
        this.touchDragStart = null;
        this.interactionManager.stopInteraction();
    };

    openSignModal() {
        this._triggerModal('signature');
    }

    openInitialsModal() {
        this._triggerModal('initials');
    }

    private resolveDrawnAnnotationWidthPct(mode: 'signature' | 'initials', payload: DrawnSignaturePayload): number {
        const baseWidthPct = mode === 'initials' ? 0.15 : 0.25;
        const minWidthPct = mode === 'initials' ? 0.07 : 0.12;
        const maxWidthPct = mode === 'initials' ? 0.18 : 0.3;
        const widthScale = payload.padWidth > 0 ? payload.cropWidth / payload.padWidth : 1;
        return Math.min(maxWidthPct, Math.max(minWidthPct, baseWidthPct * widthScale));
    }

    _triggerModal(mode: 'signature' | 'initials') {
        const modal = document.createElement('signature-modal') as any;
        modal.mode = mode;
        modal.addEventListener('signed', (e: CustomEvent<string | DrawnSignaturePayload>) => {
            const detail = e.detail;
            const dataUrl = typeof detail === 'string' ? detail : detail.dataUrl;
            const img = new Image();
            img.onload = () => {
                if (img.width > 0 && img.height > 0) {
                    const widthPct = typeof detail === 'string'
                        ? undefined
                        : this.resolveDrawnAnnotationWidthPct(mode, detail);
                    this.addAnnotation(mode, dataUrl, img.height / img.width, widthPct);
                }
            };
            img.onerror = () => console.error('Failed to load signature image');
            img.src = dataUrl;
        });
        document.body.appendChild(modal);
    }

    addDateStamp() {
        const now = new Date();
        const parts = new Intl.DateTimeFormat(i18n.lang, {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            numberingSystem: 'latn',
        }).formatToParts(now);
        const day = parts.find((p) => p.type === 'day')?.value ?? '';
        const month = parts.find((p) => p.type === 'month')?.value ?? '';
        const year = parts.find((p) => p.type === 'year')?.value ?? '';
        const lrm = '\u200E';
        const dateStr = (day && month && year)
            ? `${lrm}${day}/${month}/${year}${lrm}`
            : new Intl.DateTimeFormat('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                numberingSystem: 'latn',
            }).format(now);
        this.addAnnotation('date', dateStr, 0.3);
    }

    openCertificatePicker() {
        this.certInput?.click();
    }

    private wipePendingCertificate() {
        if (this.pendingCertificateBytes) this.pendingCertificateBytes.fill(0);
        this.pendingCertificateBytes = null;
        this.pendingCertificateName = '';
        this.certificatePassword = '';
    }

    private clearCertificateSession() {
        wipeCertificateConfig(this.certificateConfig);
        this.certificateConfig = null;
        this.certificateReady = false;
        this.certificateFileName = '';
        this.wipePendingCertificate();
    }

    async handleCertificateUpload(e: Event) {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            this.pendingCertificateBytes = bytes;
            this.pendingCertificateName = file.name;
            this.certificatePassword = '';
            this.showCertificateModal = true;
        } catch {
            this.toast(i18n.t('certReadFailed'));
        }
    }

    async confirmCertificatePassword() {
        if (!this.pendingCertificateBytes) {
            this.toast(i18n.t('certReadFailed'));
            return;
        }
        if (!this.certificatePassword) {
            this.toast(i18n.t('certPasswordRequired'));
            return;
        }
        try {
            await validatePkcs12Certificate({
                p12Bytes: this.pendingCertificateBytes,
                password: this.certificatePassword,
            });
            wipeCertificateConfig(this.certificateConfig);
            this.certificateConfig = null;
            this.certificateReady = false;
            this.certificateFileName = '';
            this.certificateConfig = {
                p12Bytes: this.pendingCertificateBytes,
                password: this.certificatePassword,
                signerName: preferences.getUserEmail('User'),
            };
            this.certificateReady = true;
            this.certificateFileName = this.pendingCertificateName;
            this.pendingCertificateBytes = null;
            this.pendingCertificateName = '';
            this.certificatePassword = '';
            this.showCertificateModal = false;
            this.toast(i18n.t('certReady'));
        } catch {
            this.toast(i18n.t('certInvalidPassword'));
        }
    }

    closeCertificateModal() {
        this.showCertificateModal = false;
        this.wipePendingCertificate();
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

    private getExecuteSaveDeps() {
        return {
            saveProfessional: (...args: any[]) => (pdfEngine.saveProfessional as any)(...args),
            getSavedEmail: () => preferences.getUserEmail('User'),
            setHardwarePrefNever: () => {
                this.hardwarePref = 'never';
                preferences.setHardwarePref('never');
            },
            toast: (msg: string) => this.toast(msg),
            messages: {
                hardwareProofUnavailable: i18n.t('hardwareProofUnavailable'),
            },
        };
    }

    private getFinalizeSaveDeps() {
        return {
            savePdf: (filename: string, data: Uint8Array) => fileService.savePdf(filename, data),
            sharePdf: (file: { filename: string; uri?: string }, bytes?: Uint8Array) => fileService.sharePdf(file, bytes),
            isNativePlatform,
            toast: (msg: string) => this.toast(msg),
            messages: {
                exportingFile: i18n.t('exportingFile'),
                savedMsg: i18n.t('savedMsg'),
            },
            hapticSuccess: () => HapticService.success(),
        };
    }

    private getShareLatestDeps() {
        return {
            sharePdf: (file: { filename: string; uri?: string }, bytes?: Uint8Array) => fileService.sharePdf(file, bytes),
            toast: (msg: string) => this.toast(msg),
            messages: {
                noChanges: i18n.t('noChanges'),
            },
        };
    }

    public reset() {
        pdfEngine.destroy();
        this.resetThumbnailState();
        this.clearCertificateSession();
        this.annotations = [];
        this.signaturesChain = [];
        this.historyManager.reset();
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
        this.totalPages = 0;
        this.currentPage = 1;
        if (this.canvas) {
            this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.canvas.width = 0;
            this.canvas.height = 0;
        }
    }

    async saveDocument(opts?: { silentWeb?: boolean; showToast?: boolean; suppressProofModal?: boolean }) {
        if (!this.hasEdits) {
            this.toast(i18n.t('noChanges'));
            return;
        }
        console.error('[OWQ][SAVE_START]');

        const hasVisualSig = this.annotations.some(a => a.type !== 'biometric');

        const decision = await resolveHardwareUsage({
            hasHardwareSupport: this.hasHardwareSupport,
            hasVisualSig,
            hardwarePref: this.hardwarePref,
            isBasicMode: this.isBasicMode,
            requestPromptDecision: async () => {
                this.showHardwarePrompt = true;
                return new Promise<boolean | null>((resolve) => {
                    this.hardwareResolver = resolve;
                });
            },
        });
        if (decision.cancelled) return;

        this.dispatchEvent(new CustomEvent('set-loading', {detail: true, bubbles: true, composed: true}));
        await new Promise((r) => setTimeout(r, 50));
        const certificateConfig = this.certificateConfig
            ? {
                p12Bytes: new Uint8Array(this.certificateConfig.p12Bytes),
                password: this.certificateConfig.password,
                signerName: this.certificateConfig.signerName,
            }
            : undefined;

        try {
            const executed = await executeSave({
                deps: this.getExecuteSaveDeps(),
                annotations: this.annotations,
                pdfName: this.pdfName,
                includeAudit: this.includeAudit,
                includeFooter: this.includeFooter,
                validationMsg: this.validationMsg,
                signaturesChain: this.signaturesChain,
                previousHashManuallyVerified: this.previousHashManuallyVerified,
                openedDocumentHash: this.openedDocumentHash,
                useHardware: decision.useHardware,
                certificateConfig,
            });
            if (executed.hardwareFallbackUsed) {
                console.warn('Hardware proof fallback: browser could not embed WebAuthn public key proof; saving as visual-only.');
            }
            await this.finishSave(executed.result, opts);
            console.error('[OWQ][SAVE_SUCCESS]');
        } catch (e: any) {
            console.error('[OWQ][SAVE_FAILED]');
            console.error('Save Error', e);
            this.toast(e.message.includes('OOM') ? i18n.t('outOfMemory') : `${i18n.t('errorSaving')}: ${e.message}`);
            this.dispatchEvent(new CustomEvent('set-loading', {detail: false, bubbles: true, composed: true}));
        } finally {
            if (certificateConfig) {
                wipeCertificateConfig(certificateConfig);
                this.clearCertificateSession();
            }
        }
    }

    private async finishSave(result: {pdfBytes: Uint8Array, docId: string, finalHash: string, finalCode: string, signatures: SignaturePayload[]}, opts?: { silentWeb?: boolean; showToast?: boolean; suppressProofModal?: boolean }) {
        const silentWeb = !!opts?.silentWeb;
        const showToast = opts?.showToast ?? true;
        const suppressProofModal = !!opts?.suppressProofModal;
        const finalized = await finalizeSave({
            deps: this.getFinalizeSaveDeps(),
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
        this.showProofModal = !suppressProofModal;
        this.dispatchEvent(new CustomEvent('set-loading', {detail: false, bubbles: true, composed: true}));
    }

    handleStampUpload(e: Event) {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file) {
            if (file.size > this.maxStampUploadBytes) {
                this.toast(i18n.t('stampFileTooLarge').replace('{size}', String(Math.floor(this.maxStampUploadBytes / (1024 * 1024)))));
                input.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onerror = () => this.toast(i18n.t('errorReadingFile'));
            reader.onload = (evt) => {
                const img = new Image();
                img.onerror = () => this.toast(i18n.t('errorReadingFile'));
                img.onload = () => {
                    const pixels = img.width * img.height;
                    if (pixels > this.maxStampImagePixels) {
                        this.toast(i18n.t('stampImageTooLarge'));
                        return;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0);
                        const dataURL = canvas.toDataURL('image/png');
                        this.addStampFromDataUrl(dataURL, file.name);
                        canvas.remove();
                    }
                };
                img.src = evt.target?.result as string;
            };
            reader.readAsDataURL(file);
        }
        input.value = '';
    }

    private async loadStampPresets() {
        const presets = await loadPresetsFromDb('stamp');
        this.stampPresets = Array.isArray(presets) ? presets : [];
    }

    private async persistStampPresets(next: Array<{ id: string; name: string; dataURL: string }>) {
        this.stampPresets = next;
        await persistPresetsToDb('stamp', next);
    }

    private async deleteStampPreset(id: string) {
        const next = this.stampPresets.filter((p) => p.id !== id);
        await this.persistStampPresets(next);
    }

    private addStampFromPreset(preset: { id: string; name: string; dataURL: string }) {
        const img = new Image();
        img.onerror = () => this.toast(i18n.t('errorReadingFile'));
        img.onload = () => {
            if (img.width <= 0 || img.height <= 0) return;
            const pixels = img.width * img.height;
            if (pixels > this.maxStampImagePixels) {
                this.toast(i18n.t('stampImageTooLarge'));
                return;
            }
            this.addAnnotation('stamp', preset.dataURL, img.height / img.width);
            this.showStampLibraryModal = false;
        };
        img.src = preset.dataURL;
    }

    private async addStampFromDataUrl(dataURL: string, fileName: string) {
        const img = new Image();
        img.onerror = () => this.toast(i18n.t('errorReadingFile'));
        img.onload = async () => {
            if (img.width <= 0 || img.height <= 0) return;
            this.addAnnotation('stamp', dataURL, img.height / img.width);
            const cleanName = fileName.replace(/\.[^.]+$/, '').slice(0, 30) || i18n.t('addStamp');
            const existing = this.stampPresets.find((p) => p.dataURL === dataURL);
            if (!existing) {
                if (this.stampPresets.length >= this.maxStampPresetCount) {
                    this.toast(i18n.t('stampPresetLimitReached').replace('{count}', String(this.maxStampPresetCount)));
                    this.showStampLibraryModal = false;
                    return;
                }
                const nextTotalBytes = this.estimateStampPresetsBytes([...this.stampPresets, {id: 'next', name: cleanName, dataURL}]);
                if (nextTotalBytes > this.maxStampPresetTotalBytes) {
                    this.toast(i18n.t('stampPresetStorageFull'));
                    this.showStampLibraryModal = false;
                    return;
                }
                const next = [...this.stampPresets, {id: this.generateId(), name: cleanName, dataURL}];
                await this.persistStampPresets(next);
            }
            this.showStampLibraryModal = false;
        };
        img.src = dataURL;
    }

    private estimateStampPresetsBytes(presets: Array<{ id: string; name: string; dataURL: string }>): number {
        let total = 0;
        for (const preset of presets) {
            const payload = preset.dataURL.split(',')[1] || '';
            total += Math.floor((payload.length * 3) / 4);
        }
        return total;
    }

    private openStampLibrary() {
        this.showStampLibraryModal = true;
    }

    private openStampPicker() {
        this.shadowRoot?.getElementById('stamp-input')?.click();
    }

    async shareLatest() {
        await shareLatestDocument({
            deps: this.getShareLatestDeps(),
            hasEdits: this.hasEdits,
            isDirty: this.isDirty,
            lastSavedBytes: this.lastSavedBytes,
            lastSaved: this.lastSaved,
            saveIfNeeded: async () => {
                await this.saveDocument({silentWeb: false, showToast: false, suppressProofModal: false});
            },
        });
    }

    async startAirGapTransfer() {
        if ((this.isDirty || !this.lastSavedBytes) && this.hasEdits) {
            await this.saveDocument({silentWeb: true, showToast: false, suppressProofModal: true});
        }

        const data = this.lastSavedBytes ?? this.loadedBytes;
        if (!data) {
            this.toast(i18n.t('noChanges'));
            return;
        }

        const name = this.outputFilename || this.pdfName || 'Transferred_Document.pdf';
        this.dispatchEvent(new CustomEvent('airgap-send', {
            detail: {
                data: new Uint8Array(data),
                name,
            },
            bubbles: true,
            composed: true,
        }));
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

    private getHardwarePrefLabel() {
        if (this.hardwarePref === 'always') return i18n.t('hardwarePrefAlways');
        if (this.hardwarePref === 'never') return i18n.t('hardwarePrefNever');
        return i18n.t('hardwarePrefPrompt');
    }

    toggleHardwarePref() {
        if (this.hardwarePref === 'prompt') this.hardwarePref = 'always';
        else if (this.hardwarePref === 'always') this.hardwarePref = 'never';
        else this.hardwarePref = 'prompt';
        preferences.setHardwarePref(this.hardwarePref);
        this.toast(`${i18n.t('hardwareSign')}: ${this.getHardwarePrefLabel()}`);
    }

    private annotationStyle(ann: Annotation, isText: boolean) {
        return {
            'inset-inline-start': `${ann.xPct * 100}%`,
            top: `${ann.yPct * 100}%`,
            width: isText ? 'auto' : (ann.widthPct ? `${ann.widthPct * 100}%` : 'auto'),
        };
    }

    private textStyle(ann: Annotation) {
        return {
            'font-size': `${ann.fontSize || 12}px`,
            'font-weight': ann.fontWeight || 'normal',
            'font-family': ann.fontFamily || 'Amiri',
            'color': ann.color || 'black',
        };
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

    private renderHandoverModal() {
        if (!this.showHandoverModal) return '';
        return html`
            <owq-modal .open=${this.showHandoverModal}
                       data-testid="handover-modal"
                       ariaLabelledby="handover-title"
                       @modal-close=${() => this.closeHandoverModal(true)}>
                <h3 id="handover-title" class="modal-title">${i18n.t('previousSigDetected')}</h3>
                <p class="modal-copy">
                    ${i18n.t('verifyPreviousSigPrompt')}</p>
                <div class="alert-box alert-warning"><strong>${i18n.t('internalRefLabel')}:</strong>
                    ${this.detectedRefId}
                </div>
                <input type="text" class="input-field modal-input-spaced"
                       data-testid="input-handover-hash"
                       aria-label="${i18n.t('handoverCodePlaceholder')}"
                       autofocus
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
                <p class="modal-warning-copy">
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
            </owq-modal>
        `;
    }

    private renderProofModal() {
        if (!this.showProofModal) return '';
        return html`
            <owq-modal .open=${this.showProofModal}
                       .center=${true}
                       data-testid="proof-modal"
                       ariaLabelledby="proof-title"
                       @modal-close=${() => this.showProofModal = false}>
                <div class="modal-icon-wrap">
                    <div class="modal-icon-badge success">${ICONS.check}
                    </div>
                </div>
                <h2 id="proof-title" class="modal-title">${i18n.t('savedMsg')}</h2>
                <p class="modal-copy">
                    ${i18n.t('proofSavedFileHelp')}</p>
                <div class="modal-card-surface">
                    <div class="modal-section-title">
                        ${i18n.t('proofSavedFileTitle')}
                    </div>
                    <div class="modal-label">
                        ${i18n.t('internalRefLabel')}
                    </div>
                    <div class="modal-value-mono id"
                         data-testid="saved-doc-id">
                        ${this.lastSavedId}
                    </div>
                    <div class="modal-section-title">
                        ${i18n.t('proofShareHashTitle')}
                    </div>
                    <p class="modal-copy">
                        ${i18n.t('proofShareHashHelp')}
                    </p>
                    <div class="modal-label inline-icon">
                        ${ICONS.lock} ${i18n.t('hashLabel')}
                    </div>
                    <div class="modal-value-mono hash"
                         data-testid="saved-doc-hash">
                        ${this.lastSavedHash}
                    </div>
                    <div class="modal-label">
                        ${i18n.t('handoverCodeLabel')}
                    </div>
                    <div class="modal-value-mono code"
                         data-testid="saved-handover-code">
                        ${this.lastSavedCode || '------'}
                    </div>
                    ${this.lastSaveHardwareFallback ? html`
                        <div class="alert-box alert-warning hardware-warning-top-gap" data-testid="hardware-fallback-warning">
                            ${i18n.t('hardwareProofUnavailable')}
                        </div>
                    ` : ''}
                </div>
                <div class="modal-actions modal-actions-spaced">
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
            </owq-modal>
        `;
    }

    private renderCustomPromptModal() {
        if (!this.customPrompt.show) return '';
        return html`
            <owq-modal .open=${this.customPrompt.show}
                       data-testid="custom-prompt"
                       ariaLabelledby="prompt-title"
                       @modal-close=${() => this.closeCustomPrompt()}>
                <h3 id="prompt-title" class="modal-title">${this.customPrompt.title}</h3>
                <input type="text" class="input-field prompt-input" data-testid="input-custom-prompt"
                       aria-label="${this.customPrompt.title}"
                       autofocus
                       .value=${this.customPrompt.value}
                       placeholder=${this.customPrompt.placeholder}
                       @input=${(e: any) => this.customPrompt.value = e.target.value}
                       @keydown=${(e: KeyboardEvent) => {
                           if (e.key === 'Enter') this.saveCustomPrompt();
                           if (e.key === 'Escape') this.closeCustomPrompt();
                       }}>
                <div class="modal-actions">
                    <button class="btn modal-btn-flex" data-testid="btn-cancel-prompt"
                            @click=${() => this.closeCustomPrompt()}>
                        ${i18n.t('cancel')}
                    </button>
                    <button class="btn btn-primary modal-btn-flex" data-testid="btn-save-prompt"
                            @click=${this.saveCustomPrompt}>
                        ${i18n.t('done')}
                    </button>
                </div>
            </owq-modal>
        `;
    }

    private renderHardwarePromptModal() {
        if (!this.showHardwarePrompt) return '';
        return html`
            <owq-modal .open=${this.showHardwarePrompt}
                       data-testid="hardware-prompt-modal"
                       ariaLabelledby="hw-prompt-title"
                       @modal-close=${() => this.resolveHardwarePrompt(null)}>
                <h3 id="hw-prompt-title" class="modal-title">${i18n.t('secureYourSignature')}</h3>
                <p class="modal-copy">
                    ${i18n.t('secureYourSignatureHelp')}
                </p>

                <label class="hardware-choice-label">
                    <input type="checkbox" id="remember-hardware-pref" .checked=${this.rememberHardwareChoice}
                           @change=${(e: any) => this.rememberHardwareChoice = e.target.checked}>
                    ${i18n.t('rememberMyChoice')}
                </label>

                <div class="modal-actions">
                    <button class="btn btn-primary modal-btn-full" data-testid="btn-hw-yes"
                            autofocus
                            @click=${() => this.resolveHardwarePrompt(true)}>
                        ${i18n.t('yesSecureIt')}
                    </button>
                    <button class="btn modal-btn-flex" data-testid="btn-hw-no"
                            @click=${() => this.resolveHardwarePrompt(false)}>
                        ${i18n.t('noStandardSave')}
                    </button>
                    <button class="btn modal-btn-flex" data-testid="btn-hw-cancel"
                            @click=${() => this.resolveHardwarePrompt(null)}>
                        ${i18n.t('cancelSave')}
                    </button>
                </div>
            </owq-modal>
        `;
    }

    private renderCertificateModal() {
        if (!this.showCertificateModal) return '';
        return html`
            <owq-modal .open=${this.showCertificateModal}
                       data-testid="cert-password-modal"
                       ariaLabelledby="cert-modal-title"
                       @modal-close=${this.closeCertificateModal}>
                <h3 id="cert-modal-title" class="modal-title">${i18n.t('signWithCertificate')}</h3>
                <p class="modal-copy">${this.pendingCertificateName}</p>
                <div class="alert-box alert-success">
                    ${i18n.t('certTrustNotice')}
                </div>
                <input type="password"
                       class="input-field modal-input-spaced"
                       data-testid="input-cert-password"
                       aria-label="${i18n.t('certPassword')}"
                       placeholder="${i18n.t('certPasswordPlaceholder')}"
                       autofocus
                       .value=${this.certificatePassword}
                       @input=${(e: Event) => this.certificatePassword = (e.target as HTMLInputElement).value}
                       @keydown=${(e: KeyboardEvent) => {
                           if (e.key === 'Enter') void this.confirmCertificatePassword();
                       }}>
                <div class="modal-actions">
                    <button class="btn modal-btn-flex" data-testid="btn-cert-cancel" @click=${this.closeCertificateModal}>
                        ${i18n.t('cancel')}
                    </button>
                    <button class="btn btn-primary modal-btn-flex" data-testid="btn-cert-confirm"
                            @click=${this.confirmCertificatePassword}>
                        ${i18n.t('done')}
                    </button>
                </div>
            </owq-modal>
        `;
    }

    private renderStampLibraryModal() {
        if (!this.showStampLibraryModal) return '';
        return html`
            <owq-modal .open=${this.showStampLibraryModal}
                       data-testid="stamp-library-modal"
                       ariaLabelledby="stamp-library-title"
                       @modal-close=${() => this.showStampLibraryModal = false}>
                <h3 id="stamp-library-title" class="modal-title">${i18n.t('stampLibraryTitle')}</h3>
                <p class="modal-copy">${i18n.t('stampLibraryHelp')}</p>
                <button class="btn btn-primary" data-testid="btn-stamp-upload" @click=${this.openStampPicker}>
                    ${i18n.t('uploadStamp')}
                </button>
                <div class="modal-actions stamp-library-close-actions">
                    <button class="btn modal-btn-flex" data-testid="btn-close-stamp-library"
                            @click=${() => this.showStampLibraryModal = false}>
                        ${i18n.t('close')}
                    </button>
                </div>
                <div class="stamp-presets" data-testid="stamp-presets-list">
                    ${this.stampPresets.length === 0 ? html`
                        <p class="modal-copy">${i18n.t('noStampPresets')}</p>
                    ` : this.stampPresets.map((preset) => html`
                        <div class="stamp-preset" role="button" tabindex="0"
                             data-testid="stamp-preset-${preset.id}"
                             title=${preset.name}
                             @click=${() => this.addStampFromPreset(preset)}
                             @keydown=${(e: KeyboardEvent) => {
                                 if (e.key === 'Enter' || e.key === ' ') {
                                     e.preventDefault();
                                     this.addStampFromPreset(preset);
                                 }
                             }}>
                            <img src=${preset.dataURL} alt=${preset.name}/>
                            <span class="stamp-preset-name">${preset.name}</span>
                            <button class="stamp-preset-delete"
                                    data-testid="btn-delete-stamp-preset-${preset.id}"
                                    aria-label=${i18n.t('deleteStampPreset')}
                                    @click=${async (e: Event) => {
                                        e.stopPropagation();
                                        await this.deleteStampPreset(preset.id);
                                    }}>×
                            </button>
                        </div>
                    `)}
                </div>
            </owq-modal>
        `;
    }

    private toggleSidebar(target: 'thumbnails' | 'annotations') {
        this.activeSidebar = this.activeSidebar === target ? null : target;
        this.persistActiveSidebar();
        if (target === 'thumbnails' && this.activeSidebar === 'thumbnails' && this.totalPages > 0) {
            void this.generateThumbnails();
        }
    }

    private renderAnnotationSidebarRow(ann: Annotation) {
        return html`
            <div class="annotation-row ${this.selectedIds.includes(ann.id) ? 'is-selected' : ''}"
                 @click=${() => {
                     if (this.currentPage !== ann.page + 1) this.gotoPage(ann.page + 1);
                     this.selectedIds = [ann.id];
                 }}>
                <div class="annotation-row-main">
                    <div class="annotation-row-icon">
                        ${ann.type === 'signature' ? ICONS.sign : ann.type === 'stamp' ? ICONS.stamp : ICONS.text}
                    </div>
                    <div class="annotation-row-label">
                        ${ann.type === 'date' || ann.type === 'identity' ? ann.data : (ann.type.charAt(0).toUpperCase() + ann.type.slice(1))}
                    </div>
                </div>
                <div class="annotation-row-meta">
                    <span class="annotation-page-pill">${i18n.t('pageLabel')} ${ann.page + 1}</span>
                </div>
            </div>
        `;
    }

    private renderWorkspaceSidebar() {
        if (this.activeSidebar === 'thumbnails' && this.totalPages > 0) {
            const windowed = this.getThumbVirtualWindow();
            const pages = Array.from(
                {length: Math.max(0, windowed.endPage - windowed.startPage + 1)},
                (_, i) => windowed.startPage + i
            );
            return html`
                <div class="thumb-panel" @scroll=${this.onThumbPanelScroll}>
                    ${windowed.topSpacer > 0 ? html`<div class="thumb-spacer" style="height:${windowed.topSpacer}px"></div>` : ''}
                    ${pages.map((page) => {
                        const url = this.thumbnailURLs[page - 1];
                        const i = page - 1;
                        return html`
                        <div class="thumb-item ${this.currentPage === i + 1 ? 'active' : ''}"
                             data-page="${page}"
                             data-testid="thumb-page-${i + 1}"
                             aria-label="${i18n.t('pageLabel')} ${i + 1}"
                             @click=${() => {
                                 this.currentPage = i + 1;
                                 this.selectedIds = [];
                                 void this.renderPage();
                             }}>
                            ${url
                                ? html`<img src="${url}" alt="${i18n.t('pageLabel')} ${i + 1}" class="thumb-image">`
                                : html`<div class="thumb-placeholder" aria-hidden="true"></div>`}
                            <div class="thumb-index">${i + 1}</div>
                            ${this.annotations.some(a => a.page === i) ? html`<div class="thumb-has-annotations"></div>` : ''}
                        </div>
                    `;
                    })}
                    ${windowed.bottomSpacer > 0 ? html`<div class="thumb-spacer" style="height:${windowed.bottomSpacer}px"></div>` : ''}
                </div>
            `;
        }

        if (this.activeSidebar === 'annotations') {
            return html`
                <div class="thumb-panel annotations-panel">
                    <h4 class="annotations-title">${i18n.t('annotations')}</h4>
                    ${this.annotations.length === 0 ? html`<div class="annotations-empty">${i18n.t('noAnnotations')}</div>` : ''}
                    <div class="annotations-list">${this.annotations.map((ann) => this.renderAnnotationSidebarRow(ann))}</div>
                </div>
            `;
        }

        return '';
    }

    private renderWorkspaceTopControls() {
        return html`
            <div class="workspace-top-controls">
                <button data-testid="btn-prev-page" class="btn pager-btn"
                        aria-label="${i18n.t('prevPage')}"
                        @click=${() => this.changePage(-1)}
                        ?disabled=${this.currentPage === 1}>‹
                </button>
                <span data-testid="page-indicator" aria-live="polite" class="page-indicator">${this.currentPage} ${i18n.t('of')} ${this.totalPages}</span>
                <button data-testid="btn-next-page" class="btn pager-btn"
                        aria-label="${i18n.t('nextPage')}"
                        @click=${() => this.changePage(1)} ?disabled=${this.currentPage === this.totalPages}>›
                </button>
                <div class="workspace-control-divider"></div>
                <button data-testid="btn-toggle-thumbs"
                        class="btn toggle panel-toggle panel-toggle-btn ${this.activeSidebar === 'thumbnails' ? 'active' : ''}"
                        aria-label="${i18n.t('toggleThumbs')}"
                        aria-pressed="${this.activeSidebar === 'thumbnails'}"
                        @click=${() => this.toggleSidebar('thumbnails')}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.5">
                        <rect x="3" y="3" width="7" height="7"/>
                        <rect x="14" y="3" width="7" height="7"/>
                        <rect x="3" y="14" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/>
                    </svg>
                </button>
                <button data-testid="btn-toggle-annotations"
                        class="btn toggle panel-toggle panel-toggle-btn ${this.activeSidebar === 'annotations' ? 'active' : ''}"
                        aria-label="${i18n.t('annotations')}"
                        aria-pressed="${this.activeSidebar === 'annotations'}"
                        @click=${() => this.toggleSidebar('annotations')}>
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
        `;
    }

    render() {
        const saveDisabled = !this.pdfName || !this.hasEdits;
        const shareDisabled = !this.pdfName || !this.hasEdits;

        return html`
            <header>
                <div class="brand">
                    <button id="btn-exit" data-testid="btn-exit" class="btn icon-only-btn"
                            aria-label="${i18n.t('exitBtn')}"
                            @click=${this.requestExit}>
                        <svg class="exit-icon ${this.dir === 'rtl' ? 'exit-icon-rtl' : ''}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"/>
                            <polyline points="12 19 5 12 12 5"/>
                        </svg>
                    </button>

                    <img src="/icons/icon-192.webp" alt="${i18n.t('appTitle')}" @error=${this.handleImageError}/>
                    <span class="brand-title">${i18n.t('appTitle')}</span>
                    ${this.isVerified ? html`<span class="badge verified-badge verified-badge-highlight">${i18n.t('verifiedBadge')}</span>` : ''}
                </div>
                <select id="select-lang" data-testid="select-lang" class="lang-select"
                        aria-label="${i18n.t('language')}" @change=${this.handleLangChange}>
                    ${LANGUAGES.map(l => html`
                        <option value="${l.code}" ?selected=${i18n.lang === l.code}>${l.label}</option>
                    `)}
                </select>
            </header>

            <div class="toolbar-top" role="toolbar" aria-label="${i18n.t('ariaToolbar')}">
                <div class="toolbar-row primary-tools">
                    <button data-testid="btn-add-sig" class="btn" aria-label="${i18n.t('addSig')}"
                            @click=${this.openSignModal}>
                        ${ICONS.sign}<span class="btn-label">${i18n.t('addSig')}</span>
                    </button>
                    <button data-testid="btn-add-date" class="btn" aria-label="${i18n.t('addDate')}"
                            @click=${this.addDateStamp}>
                        ${ICONS.date}<span class="btn-label">${i18n.t('addDate')}</span>
                    </button>
                        <button data-testid="btn-toggle-advanced" class="btn"
                                aria-label="${this.isBasicMode ? i18n.t('moreTools') : i18n.t('lessTools')}"
                                @click=${this.toggleUIMode}>
                            ${ICONS.cog}<span class="btn-label">${this.isBasicMode ? i18n.t('moreTools') : i18n.t('lessTools')}</span>
                        </button>
                        ${!this.isBasicMode ? html`
                        <button data-testid="btn-add-initials" class="btn" aria-label="${i18n.t('addInitials')}"
                                @click=${this.openInitialsModal}>
                            ${ICONS.text}<span class="btn-label">${i18n.t('addInitials')}</span>
                        </button>
                        <button data-testid="btn-add-text" class="btn" aria-label="${i18n.t('addText')}"
                                @click=${this.addTextAnnotation}>
                            ${ICONS.text}<span class="btn-label">${i18n.t('addText')}</span>
                        </button>
                        <button data-testid="btn-add-identity" class="btn"
                                aria-label="${i18n.t('addIdentity')}" @click=${this.addIdentity}>
                            ${ICONS.identity}<span class="btn-label">${i18n.t('addIdentity')}</span>
                        </button>
                        <button data-testid="btn-cert-sign"
                                class="btn ${this.certificateReady ? 'toggle active' : ''}"
                                aria-label="${i18n.t('signWithCertificate')}"
                                @click=${this.openCertificatePicker}>
                            ${ICONS.certificate}<span class="btn-label">${i18n.t('signWithCertificate')}</span>
                        </button>
                        <button data-testid="btn-add-stamp" class="btn" aria-label="${i18n.t('addStamp')}"
                                @click=${this.openStampLibrary}>
                            ${ICONS.stamp}<span class="btn-label">${i18n.t('addStamp')}</span>
                        </button>
                        ${this.hasHardwareSupport ? html`
                            <button data-testid="btn-hw-pref" class="btn" aria-label="${i18n.t('hardwareSign')}"
                                    @click=${this.toggleHardwarePref}>
                                ${this.getHardwareIcon()}<span class="btn-label">${i18n.t('hardwareSign')}: ${this.getHardwarePrefLabel()}</span>
                            </button>
                        ` : ''}
                    ` : ''}
                </div>

                <div class="toolbar-row secondary-tools">
                    <div class="toolbar-group">
                        <button data-testid="btn-undo" class="btn toolbar-btn-compact"
                                aria-label="${i18n.t('undo')}" @click=${this.undo}
                                ?disabled=${!this.historyManager.canUndo}
                                title="${i18n.t('undo')}">${ICONS.undo}
                        </button>
                        <button data-testid="btn-redo" class="btn toolbar-btn-compact"
                                aria-label="${i18n.t('redo')}" @click=${this.redo} ?disabled=${!this.historyManager.canRedo}
                                title="${i18n.t('redo')}">${ICONS.redo}
                        </button>
                        <div class="toolbar-divider"></div>
                        <button data-testid="btn-zoom-out" class="btn toolbar-btn-compact"
                                aria-label="${i18n.t('zoomOut')}" title="${i18n.t('zoomOut')}"
                                @click=${() => this.zoom(-0.2)}>－
                        </button>
                        <button data-testid="btn-zoom-in" class="btn toolbar-btn-compact"
                                aria-label="${i18n.t('zoomIn')}" title="${i18n.t('zoomIn')}"
                                @click=${() => this.zoom(0.2)}>＋
                        </button>
                    </div>

                    <div class="toolbar-group">
                        ${!this.isBasicMode ? html`
                            <button data-testid="btn-toggle-footer" class="btn toggle toolbar-btn-compact ${this.includeFooter ? 'active' : ''}"
                                    aria-label="${i18n.t('addPageFooter')}"
                                    @click=${() => {
                                        this.includeFooter = !this.includeFooter;
                                        this.isDirty = true;
                                    }} title="${i18n.t('addPageFooter')}">
                                ${ICONS.footer}
                            </button>
                        ` : ''}
                        ${(!this.isBasicMode || this.includeAudit) ? html`
                            <button data-testid="btn-toggle-audit" class="btn toggle toolbar-btn-compact ${this.includeAudit ? 'active' : ''}"
                                    aria-label="${i18n.t('addAuditPage')}"
                                    @click=${() => {
                                        this.includeAudit = !this.includeAudit;
                                        this.isDirty = true;
                                    }} title="${i18n.t('addAuditPage')}">
                                ${ICONS.audit}
                            </button>
                        ` : ''}
                        <button data-testid="btn-share" class="btn toolbar-btn-compact"
                                aria-label="${i18n.t('share')}" @click=${this.shareLatest} ?disabled=${shareDisabled}>
                            ${ICONS.share}
                        </button>
                        <button data-testid="btn-airgap-transfer" class="btn toolbar-btn-compact"
                                aria-label="${i18n.t('airGapTransfer')}"
                                title="${i18n.t('airGapTransfer')}"
                                @click=${this.startAirGapTransfer}
                                ?disabled=${shareDisabled}>
                            ${ICONS.qr}
                        </button>
                        <button data-testid="btn-save" class="btn btn-primary toolbar-btn-compact"
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
                            aria-label="${i18n.t('addIdentity')}" @click=${this.addIdentity}>
                        ${ICONS.identity} <span>${i18n.t('addIdentity')}</span>
                    </button>
                    <button data-testid="m-btn-cert-sign"
                            class="btn btn-tool ${this.certificateReady ? 'active' : ''}"
                            aria-label="${i18n.t('signWithCertificate')}"
                            @click=${this.openCertificatePicker}>
                        ${ICONS.certificate} <span>${i18n.t('signWithCertificate')}</span>
                    </button>
                    <button data-testid="m-btn-add-stamp" class="btn btn-tool" aria-label="${i18n.t('addStamp')}"
                            @click=${this.openStampLibrary}>
                        ${ICONS.stamp} <span>${i18n.t('addStamp')}</span>
                    </button>
                    ${this.hasHardwareSupport ? html`
                        <button data-testid="m-btn-hw-pref" class="btn btn-tool" aria-label="${i18n.t('hardwareSign')}"
                                @click=${this.toggleHardwarePref}>
                            ${this.getHardwareIcon()} <span>${i18n.t('hardwareSign')}: ${this.getHardwarePrefLabel()}</span>
                        </button>
                    ` : ''}
                ` : ''}
            </div>

            <div class="workspace-area">
                ${this.renderWorkspaceSidebar()}

                <div class="viewport ${this.interactionManager.isDragging ? 'drag-active' : ''}" @mousedown=${this.onContainerClick} @touchstart=${this.onContainerClick}>
                    ${this.renderWorkspaceTopControls()}
                    <div class="page-container" data-testid="page-container" @mousedown=${this.startMarqueeSelection}>
                        ${this.interactionManager.guideLines.map(guide => guide.axis === 'x' ? html`
                            <div class="guide-line-x" style="${`inset-inline-start: ${guide.pos * 100}%`}"></div>
                        ` : html`
                            <div class="guide-line-y" style="${`top: ${guide.pos * 100}%`}"></div>
                        `)}
                        ${this.interactionManager.marqueeBox ? html`
                            <div class="marquee-box" data-testid="marquee-box" style=${styleMap({
                                'inset-inline-start': `${this.interactionManager.marqueeBox.left}px`,
                                top: `${this.interactionManager.marqueeBox.top}px`,
                                width: `${this.interactionManager.marqueeBox.width}px`,
                                height: `${this.interactionManager.marqueeBox.height}px`,
                            })}></div>
                        ` : ''}
                        ${this.isRendering ? html`<div class="canvas-skeleton"></div>` : ''}
                        <canvas id="pdf-canvas"></canvas>
                        ${this.annotations.filter(ann => ann.page === this.currentPage - 1).map(ann => {
                            const isSelected = this.selectedIds.includes(ann.id);
                            const isText = ann.type === 'date' || ann.type === 'identity';
                            const isLocked = !!ann.lockedByChain;
                            return html`
                                <div class="draggable ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''}"
                                     data-testid="annotation-${ann.id}"
                                     data-ann-id=${ann.id}
                                     data-locked="${isLocked ? 'true' : 'false'}"
                                     role="group"
                                     aria-label="${ann.type} ${i18n.t('annotation')}"
                                     style=${styleMap(this.annotationStyle(ann, isText))}
                                     @mousedown=${(e: any) => !isLocked && this.startDrag(e, ann.id)}
                                     @touchstart=${(e: any) => !isLocked && this.startDrag(e, ann.id)}>
                                    <button data-testid="btn-delete-ann" class="delete-btn"
                                            aria-label="${i18n.t('delete')}"
                                            ?hidden=${!(isSelected && !isLocked)}
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
                                             aria-label="${i18n.t('styleToolbar')}">
                                            <button data-testid="btn-edit-text"
                                                    aria-label="${i18n.t('editText')}"
                                                    class="style-tool-btn"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.handleTextEdit(ann.id, ann.data);
                                                    }}>✎
                                            </button>
                                            <select data-testid="select-font"
                                                    aria-label="${i18n.t('fontFamily')}"
                                                    class="style-tool-select"
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
                                                   class="style-tool-color"
                                                   @click=${(e: Event) => e.stopPropagation()}
                                                   @input=${(e: Event) => {
                                                       e.stopPropagation();
                                                       this.updateStyle(ann.id, {color: (e.target as HTMLInputElement).value});
                                                   }}>
                                            <button data-testid="btn-toggle-bold"
                                                    aria-label="${i18n.t('bold')}"
                                                    class="style-tool-btn style-tool-btn-bold ${ann.fontWeight === 'bold' ? 'is-active' : ''}"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.updateStyle(ann.id, {fontWeight: ann.fontWeight === 'bold' ? 'normal' : 'bold'});
                                                    }}>B
                                            </button>
                                            <button data-testid="btn-font-down"
                                                    aria-label="${i18n.t('decreaseFont')}"
                                                    class="style-tool-btn"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.updateStyle(ann.id, {fontSize: Math.max(8, (ann.fontSize || 12) - 2)});
                                                    }}>A-
                                            </button>
                                            <button data-testid="btn-font-up"
                                                    aria-label="${i18n.t('increaseFont')}"
                                                    class="style-tool-btn"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.updateStyle(ann.id, {fontSize: Math.min(60, (ann.fontSize || 12) + 2)});
                                                    }}>A+
                                            </button>
                                            <button data-testid="btn-apply-all"
                                                    aria-label="${i18n.t('applyAll')}"
                                                    class="style-tool-btn"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.applyToAllPages(ann.id);
                                                    }}>📄
                                            </button>
                                        </div>
                                    ` : isSelected && !isText && !isLocked ? html`
                                        <div class="style-popup" data-testid="style-popup" role="toolbar"
                                             aria-label="${i18n.t('styleToolbar')}">
                                            <button data-testid="btn-apply-all"
                                                    aria-label="${i18n.t('applyAll')}"
                                                    class="style-tool-btn"
                                                    @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        this.applyToAllPages(ann.id);
                                                    }}>📄
                                            </button>
                                        </div>
                                    ` : ''}
                                    ${!isText ? html`
                                        <div class="resize-handle" aria-label="${i18n.t('resize')}"
                                             ?hidden=${!(isSelected && !isLocked)}
                                             @mousedown=${(e: any) => this.startResize(e, ann.id)}
                                             @touchstart=${(e: any) => this.startResize(e, ann.id)}></div>
                                        <img src="${ann.data}" alt="${ann.type} annotation"
                                             class="draggable-stamp"/>
                                    ` : html`
                                        <span class="text-content"
                                              style=${styleMap(this.textStyle(ann))}
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
            <input id="stamp-input" type="file" accept="image/png,image/jpeg,image/webp" style="display:none"
                   @change=${this.handleStampUpload}>
            <input id="cert-input" data-testid="input-cert-file" type="file"
                   accept=".p12,.pfx,application/x-pkcs12"
                   style="display:none"
                   @change=${this.handleCertificateUpload}>

            ${this.renderHandoverModal()}
            ${this.renderProofModal()}
            ${this.renderCustomPromptModal()}
            ${this.renderHardwarePromptModal()}
            ${this.renderStampLibraryModal()}
            ${this.renderCertificateModal()}
        `;
    }
}
