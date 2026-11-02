import {html, LitElement, PropertyValues} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {App} from '@capacitor/app';
import {fileService} from './lib/file-service';
import {i18n} from './lib/i18n-service';
import packageJson from '../package.json';
import './components/pdf-workspace';
import './components/owq-modal';
import {registerSW} from 'virtual:pwa-register';
import {AppConfig} from './config';
import {LANGUAGES, resources} from './i18n/locales';
import {PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import {ICONS} from './lib/icons';
import {StatusBar, Style} from '@capacitor/status-bar';
import {Share} from '@capacitor/share';
import {IncomingFileController} from './features/intake/incoming-file-controller';
import {VerifyController} from './features/verify/verify-controller';
import {
    initialChainStatus,
    initialVerifyResult,
    pendingVerifyResult,
    type VerifyChainStatus,
    type VerifyResult,
    verifyOutcomeState
} from './features/verify/verify-state';
import {groupedHashPreview} from './domain/hash';
import {preferences} from './lib/preferences';
import {isNativeOrSmallViewport, isNativePlatform} from './lib/runtime-platform';
import {requestStoragePersistence} from './lib/storage-persistence';

@customElement('app-root')
export class AppRoot extends LitElement {
    @state() mode: 'home' | 'workspace' = 'home';
    @state() isLoading = false;
    @state() toastMsg: string | null = null;
    @state() updateAvailable = false;
    @state() verifyMode = false;
    @state() verifyResult: VerifyResult = initialVerifyResult();
    @state() expectedVerifyId: string | null = null;
    @state() verifyHashInput = '';
    @state() verifyFileHash = '';
    @state() showVerifyModal = false;
    @state() integrityStatus: 'idle' | 'success' | 'fail' = 'idle';
    @state() hasStandardSignature = false;
    @state() chainStatus: VerifyChainStatus = initialChainStatus();

    @state() showDiagnostics = false;
    private logoTapCount = 0;
    private logoTapTimeout: any = null;
    @state() showExitConfirm = false;
    @state() showPrivacyModal = false;

    @state() globalError: Error | null = null;
    @state() globalErrorContext: string = '';

    private readonly onGlobalError = (e: ErrorEvent) => {
        this.globalError = e.error || new Error(e.message);
        this.globalErrorContext = 'Window Error';
    };

    private readonly onUnhandledRejection = (e: PromiseRejectionEvent) => {
        this.globalError = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
        this.globalErrorContext = 'Unhandled Promise Rejection';
    };

    private downloadDebugInfo = () => {
        const debugInfo = {
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            error: this.serializeError(this.globalError),
            context: this.globalErrorContext,
            mode: this.mode,
            url: window.location.href,
            lang: i18n.lang
        };
        const blob = new Blob([JSON.stringify(debugInfo, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `owq-signer-debug-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    private updateSW: ((reload: boolean) => void) | undefined;
    private backButtonListener: Promise<{ remove: () => Promise<void> }> | null = null;
    private readonly onLangChanged = () => this.requestUpdate();

    @query('pdf-workspace') workspace: any;
    private readonly verifyController = new VerifyController();
    private readonly incomingFileController = new IncomingFileController({
        onSharedFile: async (data, name) => {
            this.verifyMode = false;
            await this.handleFile(data, name);
        },
        onError: () => this.showToast(i18n.t('sharedOpenFailed')),
    });

    private async resolveWorkspace(retries = 8, delayMs = 40) {
        try {
            await customElements.whenDefined('pdf-workspace');
        } catch {
            // ignore and continue retry loop
        }
        for (let i = 0; i <= retries; i++) {
            await this.updateComplete;
            const candidate = this.workspace ?? this.querySelector('pdf-workspace');
            if (candidate && typeof (candidate as any).loadPdf === 'function') return candidate as any;
            if (i < retries) await new Promise(r => setTimeout(r, delayMs));
        }
        return null;
    }

    private serializeError(error: unknown): string {
        if (error instanceof Error) return `${error.name}: ${error.message}`;
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    private logMarker(marker: string) {
        if (isNativePlatform()) {
            // Capacitor logcat consistently captures console.error for automation assertions.
            console.error(marker);
            return;
        }
        console.info(marker);
    }

    createRenderRoot() {
        return this;
    }

    handleSecretTap = (e: Event) => {
        e.preventDefault();
        this.logoTapCount++;
        clearTimeout(this.logoTapTimeout);
        this.logoTapTimeout = setTimeout(() => {
            this.logoTapCount = 0;
        }, 1500);

        if (this.logoTapCount >= 5) {
            this.showDiagnostics = true;
            this.requestUpdate();
            this.logoTapCount = 0;
        }
    };

    async firstUpdated(_changedProperties: PropertyValues) {
        super.firstUpdated(_changedProperties);
        const params = new URLSearchParams(window.location.search);
        const nextSearch = await this.incomingFileController.consumeSharedPdfFromLocation(window.location.search);
        await this.incomingFileController.consumePendingSharedPdf();
        if (nextSearch !== null) {
            const nextUrl = nextSearch ? `${window.location.pathname}?${nextSearch}` : window.location.pathname;
            window.history.replaceState({}, document.title, nextUrl);
        }
        const id = params.get('id');

        if (id) {
            this.verifyMode = true;
            this.expectedVerifyId = id;
            this.verifyResult = pendingVerifyResult(id);
            this.showVerifyModal = true;
        }
    }

    connectedCallback() {
        super.connectedCallback();
        void requestStoragePersistence();
        if (isNativePlatform()) {
            StatusBar.setStyle({style: Style.Light}).catch(console.error);
            StatusBar.setBackgroundColor({color: '#ffffff'}).catch(console.error);
        }
        window.addEventListener('lang-changed', this.onLangChanged);
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', this.incomingFileController.serviceWorkerMessageHandler);
            void this.incomingFileController.initializeServiceWorkerShareBridge();
        }
        this.setupPWA();
        this.incomingFileController.setupIncomingNativeFileRouting();

        this.backButtonListener = App.addListener('backButton', () => this.handleBackButton());
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('error', this.onGlobalError);
        window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
        window.removeEventListener('lang-changed', this.onLangChanged);
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.removeEventListener('message', this.incomingFileController.serviceWorkerMessageHandler);
        }
        if (this.backButtonListener) {
            this.backButtonListener.then(listener => listener.remove()).catch(console.error);
            this.backButtonListener = null;
        }
    }

    setupPWA() {
        if (!isNativePlatform()) {
            const updateSW = registerSW({
                onNeedRefresh: () => {
                    this.updateSW = updateSW;
                    this.updateAvailable = true;
                },
                onOfflineReady() {
                    console.log(i18n.t('appReadyOffline'));
                },
            });
        }
    }

    showToast(msg: string) {
        this.toastMsg = msg;
        setTimeout(() => {
            this.toastMsg = null;
        }, 3000);
    }

    private setLoading(isLoading: boolean) {
        this.isLoading = isLoading;
        this.requestUpdate();
    }

    private resetVerifyState() {
        this.verifyResult = initialVerifyResult();
        this.expectedVerifyId = null;
        this.integrityStatus = 'idle';
        this.chainStatus = initialChainStatus();
        this.hasStandardSignature = false;
    }

    // Share App: the system share sheet where there is one (Android app, phone browsers);
    // otherwise copy the link and say so. Copying on Android 13+ also showed the phone's own
    // "copied" popup next to ours (bug P1).
    private async shareApp() {
        const url = `${AppConfig.website}/?lang=${i18n.lang}`;
        const payload = {title: i18n.t('appTitle'), text: i18n.t('tagline'), url};
        try {
            if (isNativePlatform()) {
                await Share.share({...payload, dialogTitle: i18n.t('shareApp')});
                return;
            }
            if (typeof navigator.share === 'function') {
                await navigator.share(payload);
                return;
            }
        } catch (e) {
            const err = e as Error;
            // The user closed the share sheet: nothing else to do.
            if (err?.name === 'AbortError' || /cancel/i.test(String(err?.message))) return;
            // Anything else: fall back to copying the link.
        }
        try {
            await navigator.clipboard.writeText(url);
            this.showToast(i18n.t('linkCopied'));
        } catch {
            this.showToast(url); // copying blocked: at least show the link
        }
    }

    private exitToHome() {
        this.workspace.reset();
        this.mode = 'home';
    }

    private closeSignatureModalIfOpen() {
        const sigModal = document.querySelector('signature-modal');
        if (!sigModal) return false;
        sigModal.remove();
        return true;
    }

    // Android Back: close the top dialog first (as Escape would), and only then go back a
    // screen. Leaving the editor with a dialog still open froze the app (bug O1).
    private handleBackButton() {
        if (this.showExitConfirm) {
            this.showExitConfirm = false;
            return;
        }
        if (this.showPrivacyModal) {
            this.closePrivacy();
            return;
        }
        if (this.showVerifyModal) {
            this.closeVerify();
            return;
        }
        if (this.showDiagnostics) {
            this.showDiagnostics = false;
            return;
        }
        if (this.closeSignatureModalIfOpen()) {
            return;
        }
        if (this.mode === 'workspace' && this.workspace?.closeOpenDialog()) {
            return;
        }
        if (this.mode === 'workspace') {
            this.handleExitWorkspace();
            return;
        }
        App.exitApp();
    }

    async handleVerify(file: File) {
        this.setLoading(true);

        try {
            const outcome = await this.verifyController.verifyFile(file, this.expectedVerifyId);
            this.setLoading(false);
            Object.assign(this, verifyOutcomeState(outcome));
        } catch (e) {
            this.setLoading(false);
            this.showToast(i18n.t('errorReadingFile'));
        }
    }

    checkHash() {
        this.integrityStatus = this.verifyController.checkHash(this.verifyHashInput, this.verifyFileHash);
    }

    private normalizedHashInput() {
        return this.verifyController.normalizedHashInput(this.verifyHashInput);
    }

    private groupedHashPreview(hash: string) {
        return groupedHashPreview(hash);
    }

    closeVerify() {
        this.showVerifyModal = false;
        this.resetVerifyState();
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    async startPendingVerification() {
        this.showVerifyModal = false;
        await this.openFile('verify-modal');
    }

    async handleFile(data: Uint8Array, name: string) {
        const sizeInMB = data.byteLength / (1024 * 1024);
        if (sizeInMB > (isNativeOrSmallViewport() ? 25 : 50)) {
            if (!confirm(i18n.t('fileTooBigMsg').replace('{size}', sizeInMB.toFixed(1)))) return;
        }

        this.setLoading(true);
        await new Promise(r => setTimeout(r, 50));

        try {
            this.mode = 'workspace';
            const workspace = await this.resolveWorkspace();
            if (!workspace) throw new Error('Workspace component not ready');
            await workspace.loadPdf(data, name);
            this.logMarker('[OWQ][WORKSPACE_LOADED]');
        } catch (e) {
            this.logMarker('[OWQ][WORKSPACE_LOAD_FAILED]');
            console.error('Error loading file into workspace:', this.serializeError(e), e);
            this.showToast(i18n.t('errorLoading'));
            this.mode = 'home';
        } finally {
            this.setLoading(false);
        }
    }

    async loadSamplePdf() {
        this.setLoading(true);
        try {
            this.logMarker('[OWQ][SAMPLE_START]');
            // Prefer bundled sample to avoid runtime generation issues in some Android WebViews.
            try {
                const sampleUrl = new URL('sample_document.pdf', new URL(import.meta.env.BASE_URL, window.location.href)).toString();
                const response = await fetch(sampleUrl, {cache: 'no-store'});
                if (response.ok) {
                    const buffer = await response.arrayBuffer();
                    this.logMarker('[OWQ][SAMPLE_LOADED][STATIC]');
                    await this.handleFile(new Uint8Array(buffer), 'sample_document.pdf');
                    return;
                }
            } catch {
                // Fallback to in-memory generation below.
            }

            const pdfDoc = await PDFDocument.create();
            const page = pdfDoc.addPage([595.28, 841.89]);
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const sampleTitleLocalized = i18n.t('sampleDocTitle');
            const sampleText1Localized = i18n.t('sampleDocText1');
            const sampleText2Localized = i18n.t('sampleDocText2');
            const sampleTitle = /[^\x00-\x7F]/.test(sampleTitleLocalized) ? resources.en.sampleDocTitle : sampleTitleLocalized;
            const sampleText1 = /[^\x00-\x7F]/.test(sampleText1Localized) ? resources.en.sampleDocText1 : sampleText1Localized;
            const sampleText2 = /[^\x00-\x7F]/.test(sampleText2Localized) ? resources.en.sampleDocText2 : sampleText2Localized;
            page.drawText(sampleTitle, {x: 50, y: 750, size: 24, font, color: rgb(0, 0.33, 0.71)});
            page.drawText(sampleText1, {x: 50, y: 700, size: 12, font});
            page.drawText(sampleText2, {x: 50, y: 680, size: 12, font});
            const pdfBytes = await pdfDoc.save();
            this.logMarker('[OWQ][SAMPLE_LOADED][GENERATED]');
            await this.handleFile(pdfBytes, 'sample_document.pdf');
        } catch (e) {
            console.error('Error generating sample PDF:', this.serializeError(e), e);
            this.showToast(i18n.t('errorSamplePdf'));
        } finally {
            this.setLoading(false);
        }
    }

    onSampleClick(e: Event) {
        e.preventDefault();
        e.stopPropagation();
        this.logMarker('[OWQ][SAMPLE_CLICK]');
        void this.loadSamplePdf();
    }

    async openFile(source = 'unknown') {
        this.logMarker(`[OWQ][OPEN_FILE][${source}]`);
        try {
            const {data, name} = await fileService.openPdf();
            if (this.verifyMode) {
                await this.handleVerify(new File([data as any], name, {type: 'application/pdf'}));
            } else {
                await this.handleFile(data, name);
            }
        } catch (e) {
            console.error('Error opening file:', this.serializeError(e), e);
        }
    }

    handleDrop(e: DragEvent) {
        e.preventDefault();
        if (e.dataTransfer?.files[0]) {
            const file = e.dataTransfer.files[0];
            if (this.verifyMode) {
                this.handleVerify(file);
            } else if (file.type === 'application/pdf') {
                file.arrayBuffer().then(b => this.handleFile(new Uint8Array(b), file.name));
            }
        }
    }

    handleLangChange(e: Event) {
        i18n.setLanguage((e.target as HTMLSelectElement).value as any);
    }

    showPrivacy() {
        this.showPrivacyModal = true;
    }

    closePrivacy() {
        this.showPrivacyModal = false;
    }

    clearAppCache() {
        if (confirm(i18n.t('confirmClear'))) {
            preferences.clearAll();
            window.location.reload();
        }
    }

    handleExitWorkspace() {
        if (this.workspace && this.workspace.isDirty) {
            this.showExitConfirm = true;
        } else {
            this.exitToHome();
        }
    }

    private renderLoaderOverlay() {
        if (!this.isLoading) return '';
        return html`
            <div class="loader-overlay" role="status" aria-live="polite">
                <div class="spinner"></div>
                <div>${i18n.t('loadingDoc')}</div>
            </div>
        `;
    }

    private renderUpdateToast() {
        if (!this.updateAvailable) return '';
        return html`
            <div class="toast toast-interactive show">
                <span class="update-banner-label">${ICONS.alert} ${i18n.t('updateAvailable')}</span>
                <button class="btn btn-primary update-banner-btn"
                        data-testid="btn-update-reload"
                        @click=${() => this.updateSW && this.updateSW(true)}>
                    ${i18n.t('reload')}
                </button>
            </div>
        `;
    }

    private renderModeToggle() {
        return html`
            <div class="mode-toggle">
                <button id="btn-sign-mode" data-testid="btn-sign-mode" class="${!this.verifyMode ? 'active' : ''}" @click=${() => this.verifyMode = false}>
                    <span class="mode-label">${ICONS.sign} ${i18n.t('signMode')}</span>
                </button>
                <button id="btn-verify-mode" data-testid="btn-verify-mode" class="${this.verifyMode ? 'active' : ''}" @click=${() => this.verifyMode = true}>
                    <span class="mode-label">${ICONS.search} ${i18n.t('verifyMode')}</span>
                </button>
            </div>
        `;
    }

    private renderHomeFeatures() {
        if (this.verifyMode) return '';
        return html`
            <div class="features-section">
                <h3 class="features-title">
                    ${i18n.t('howItWorks')}</h3>
                <div class="features-grid">
                    <div class="feature-card">
                        <div class="feature-icon">${ICONS.sign}</div>
                        <h4>${i18n.t('step1Title')}</h4>
                        <p>${i18n.t('step1Desc')}</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">${ICONS.lock}</div>
                        <h4>${i18n.t('step2Title')}</h4>
                        <p>${i18n.t('step2Desc')}</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">${ICONS.shield}</div>
                        <h4>${i18n.t('step3Title')}</h4>
                        <p>${i18n.t('step3Desc')}</p>
                    </div>
                </div>
            </div>
        `;
    }

    private renderHomeScreen() {
        return html`
            <div class="drop-zone ${this.mode === 'workspace' ? 'hidden' : ''}"
                 @dragover=${(e: DragEvent) => e.preventDefault()} @drop=${this.handleDrop}>
                <div class="mode-container">
                    <div class="layout-header">
                        <select id="select-lang-home" class="lang-select" data-testid="select-lang-home" @change=${this.handleLangChange}>
                            ${LANGUAGES.map(l => html`
                                <option value="${l.code}" ?selected=${i18n.lang === l.code}>${l.label}</option>
                            `)}
                        </select>
                    </div>

                    <div class="drop-card">
                        <img src="./icons/icon-192.webp" alt="${i18n.t('appTitle')}" data-testid="logo-img" @click=${this.handleSecretTap}
                             draggable="false"/>
                        <h1>${i18n.t('appTitle')}</h1>
                        <p class="sub hero-subtitle">v${packageJson.version} • ${i18n.t('tagline')}</p>

                        ${this.renderModeToggle()}

                        <div id="drop-area" data-testid="drop-area" class="drop-area-visual" @click=${() => this.openFile('home-drop')}>
                            <button class="btn btn-primary" data-testid="btn-select-file">
                                ${this.verifyMode ? i18n.t('selectFileVerify') : i18n.t('selectFile')}
                            </button>
                            <p class="sub drop-hint">
                                ${this.verifyMode ? i18n.t('dropHintVerify') : i18n.t('dragDropHint')}
                            </p>
                        </div>

                        ${!this.verifyMode ? html`
                            <button id="btn-sample" type="button" data-testid="btn-sample" class="text-link sample-link" @click=${this.onSampleClick}>
                                ${i18n.t('trySample')}
                            </button>
                        ` : ''}

                        <div class="trust-pill-wrap">
                            <span class="badge-success">${ICONS.shield} ${i18n.t('privacyBadge')}</span>
                        </div>

                        <div class="footer-links">
                            <button type="button" class="footer-link" data-testid="link-privacy" @click=${this.showPrivacy}>${i18n.t('privacyTitle')}</button>
                            <span aria-hidden="true">•</span>
                            <a href="mailto:${AppConfig.supportEmail}" class="footer-link">${i18n.t('contactUs')}</a>
                        </div>

                        <button class="btn share-app-btn" data-testid="btn-share-app" @click=${() => this.shareApp()}>
                            ${ICONS.link} ${i18n.t('shareApp')}
                        </button>
                    </div>

                    ${this.renderHomeFeatures()}
                    <div class="home-bottom-spacer"></div>
                </div>
            </div>
        `;
    }

    private renderWorkspace() {
        return html`
            <pdf-workspace class="${this.mode === 'home' ? 'hidden' : ''}"
                           @toast=${(e: CustomEvent) => this.showToast(e.detail)}
                           @set-loading=${(e: CustomEvent) => {
                               this.setLoading(e.detail);
                           }}
                           @exit-workspace=${this.handleExitWorkspace}>
            </pdf-workspace>
        `;
    }

    private renderPrivacyModal() {
        return html`
            <owq-modal .open=${this.showPrivacyModal}
                       .closeOnBackdrop=${false}
                       data-testid="privacy-modal"
                       ariaLabel="${i18n.t('privacyTitle')}"
                       @modal-close=${this.closePrivacy}>
                <div class="dialog-content">
                    <h2 id="privacy-title" class="modal-title">${i18n.t('privacyTitle')}</h2>
                    <p class="modal-copy">${i18n.t('privacyContent')}</p>
                    <p class="modal-note">${i18n.t('privacyTimestampNote')}</p>

                    <div class="amanah-panel">
                        <h4 class="modal-section-title modal-inline-icon privacy-heading">
                            ${ICONS.shield} ${i18n.t('securityModel')}
                        </h4>
                        <p class="modal-note privacy-model-text">${i18n.t('securityModelText')}</p>
                    </div>

                    <div class="info-panel">
                        <a href="https://github.com/open-waqf/signer" target="_blank"
                           class="modal-link">
                            ${i18n.t('viewSourceCode')} ↗
                        </a>
                    </div>

                    <button class="btn btn-danger btn-full btn-top-gap" data-testid="btn-clear-cache" @click=${this.clearAppCache}>
                        ${i18n.t('forgetData')}
                    </button>
                </div>
                <div class="dialog-footer">
                    <button class="btn" data-testid="btn-close-privacy" @click=${() => this.closePrivacy()}>${i18n.t('close')}</button>
                </div>
            </owq-modal>
        `;
    }

    private renderDiagnosticsModal() {
        if (!this.showDiagnostics) return '';
        return html`
            <owq-modal .open=${this.showDiagnostics}
                       data-testid="diagnostics-modal"
                       ariaLabel="${i18n.t('diagnostics')}"
                       @modal-close=${() => this.showDiagnostics = false}>
                    <h2 class="modal-title modal-inline-icon">${ICONS.cog}
                        ${i18n.t('diagnostics')}</h2>
                    <div class="diagnostics-panel">
                        <div>${i18n.t('appVersion')}: ${packageJson.version}</div>
                        <div>${i18n.t('platform')}:
                            ${isNativePlatform() ? i18n.t('platformNative') : i18n.t('platformWeb')}
                        </div>
                        <div>${i18n.t('userAgent')}: ${navigator.userAgent}</div>
                        <div>${i18n.t('windowSize')}: ${window.innerWidth}x${window.innerHeight}</div>
                        <div>${i18n.t('connection')}: ${navigator.onLine ? i18n.t('online') : i18n.t('offline')}
                        </div>
                    </div>
                    <div class="modal-actions center modal-top-gap">
                        <button class="btn btn-full" data-testid="btn-close-diagnostics" @click=${() => this.showDiagnostics = false}>
                            ${i18n.t('close')}
                        </button>
                    </div>
            </owq-modal>
        `;
    }

    private renderVerifyResultCard() {
        return html`
            <div class="verify-step-card info-panel" role="status" aria-live="polite">
                <h3 class="verify-step-title">${i18n.t('metadataCheckTitle')}</h3>
                ${this.verifyResult.status === 'success' ? html`
                    <h2 class="verify-success-title" data-testid="verify-success-title">${i18n.t('recordFound')}</h2>
                    <p class="verify-step-note">${i18n.t('internalRefLabel')} <strong>${this.verifyResult.id}</strong></p>
                    <div class="amanah-panel verify-disclaimer">
                        ${i18n.t('recordFoundDisclaimer')}
                    </div>
                ` : html`
                    <h2 class="verify-fail-title" data-testid="verify-fail-title">${i18n.t('noRecordFound')}</h2>
                    <p class="verify-step-note">${i18n.t('noRecordMsg')}</p>
                `}
            </div>
        `;
    }

    private renderHashCheckCard() {
        return html`
            <div class="verify-step-card info-panel">
                <h3 class="verify-step-title">${i18n.t('strictIntegrityTitle')}</h3>
                <p class="verify-step-note">${i18n.t('strictIntegrityHelp')}</p>
                <div class="verify-hash-row">
                    <input type="text" class="input-field" data-testid="input-verify-hash" .value="${this.verifyHashInput}"
                           @input="${(e: any) => {
                               this.verifyHashInput = e.target.value;
                               this.integrityStatus = 'idle';
                           }}" placeholder="${i18n.t('pasteHashPlaceholder')}">
                    <button class="btn btn-primary" data-testid="btn-check-hash" @click="${this.checkHash}">${i18n.t('verifyBtn')}
                    </button>
                </div>
                <p class="verify-hash-hint">
                    ${i18n.t('hashFormatHint').replace('{count}', String(this.verifyFileHash?.length || 64))}
                </p>
                ${this.normalizedHashInput() ? html`
                    <div class="info-panel hash-normalized-preview" data-testid="hash-normalized">
                        ${this.groupedHashPreview(this.normalizedHashInput())}
                    </div>
                ` : ''}
                ${this.integrityStatus === 'success' ? html`
                    <div class="alert-box alert-success alert-top-gap" data-testid="integrity-success"
                         .innerHTML=${i18n.t('strictVerified')}></div>` : ''}
                ${this.integrityStatus === 'fail' ? html`
                    <div class="alert-box alert-error alert-top-gap" data-testid="integrity-fail"
                         .innerHTML=${i18n.t('strictMismatch')}></div>` : ''}
            </div>
        `;
    }

    private renderVerifyPendingBody() {
        return html`
            <div class="verify-icon-wrap">
                <div class="verify-icon-badge">${ICONS.search}</div>
            </div>
            <h2>${i18n.t('linkDetected')}</h2>
            <p class="sub verify-pending-text">${i18n.t('linkDetectedMsg')} <strong>${this.verifyResult.id}</strong></p>
            <button class="btn btn-primary verify-pending-btn" data-testid="btn-start-verify" @click=${() => this.startPendingVerification()}>
                ${i18n.t('selectFileVerify')}
            </button>
        `;
    }

    private renderVerifyDetailsBody() {
        return html`
            ${this.renderVerifyResultCard()}
            ${this.hasStandardSignature ? html`
                <div class="alert-box alert-warning" data-testid="cms-signature-banner">
                    <div class="cms-signature-title">${ICONS.certificate} ${i18n.t('standardSignatureTitle')}</div>
                    <div class="cms-signature-copy">${i18n.t('standardSignatureDetectedBanner')}</div>
                </div>
            ` : ''}
            ${this.renderHashCheckCard()}

            ${this.chainStatus.status === 'success' ? html`
                <div class="alert-box alert-success alert-top-gap" data-testid="chain-success"
                     .innerHTML=${(this.integrityStatus === 'success' ? i18n.t('chainValidated') : i18n.t('chainValidatedPreliminary'))
                         .replace('{count}', String(this.chainStatus.total || 0))}></div>
            ` : ''}
            ${this.chainStatus.status === 'fail' ? html`
                <div class="alert-box alert-error alert-top-gap" data-testid="chain-fail"
                     .innerHTML=${i18n.t('chainFailed').replace('{index}', String(this.chainStatus.failedSignerIndex || 0))}></div>
            ` : ''}
        `;
    }

    private renderVerifyModal() {
        return html`
            <owq-modal .open=${this.showVerifyModal}
                       .closeOnBackdrop=${false}
                       ariaLabel="${i18n.t('verifyMode')}"
                       @modal-close=${this.closeVerify}>
                <div class="dialog-content dialog-content-center">
                    ${this.verifyResult.status === 'pending_file' ? this.renderVerifyPendingBody() : this.renderVerifyDetailsBody()}
                </div>
                <div class="dialog-footer">
                    <button class="btn" data-testid="btn-close-verify" @click=${() => this.closeVerify()}>${i18n.t('close')}</button>
                </div>
            </owq-modal>
        `;
    }

    private renderExitConfirmModal() {
        if (!this.showExitConfirm) return '';
        return html`
            <owq-modal .open=${this.showExitConfirm}
                       .center=${true}
                       data-testid="exit-confirm-modal"
                       ariaLabel="${i18n.t('exitConfirmTitle')}"
                       @modal-close=${() => this.showExitConfirm = false}>
                    <div class="exit-warning-wrap">
                        <div class="exit-warning-badge">${ICONS.alert}</div>
                    </div>
                    <h2 class="modal-title">
                        ${i18n.t('exitConfirmTitle')}</h2>
                    <p class="modal-copy">
                        ${i18n.t('exitConfirmText')}
                    </p>
                    <div class="modal-actions">
                        <button class="btn modal-btn-flex" data-testid="btn-cancel-exit" @click=${() => this.showExitConfirm = false}>
                            ${i18n.t('cancel')}
                        </button>
                        <button class="btn btn-danger modal-btn-flex" data-testid="btn-confirm-exit" @click=${() => {
                            this.showExitConfirm = false;
                            this.exitToHome();
                        }}>${i18n.t('exitBtn')}
                        </button>
                    </div>
            </owq-modal>
        `;
    }

    render() {
        if (this.globalError) {
            return html`
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:var(--bg-app);color:var(--text-main);padding:24px;text-align:center;">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--danger)" stroke-width="2" style="margin-bottom:16px;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <h2 style="margin-bottom:8px;font-size:1.5rem;">Something went wrong</h2>
                    <p style="margin-bottom:24px;color:var(--text-sub);max-width:400px;">
                        An unexpected error caused the application to crash. You can download a debug log to help us investigate the issue.
                    </p>
                    <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
                        <button class="btn" @click=${() => window.location.reload()}>Reload App</button>
                        <button class="btn btn-primary" @click=${this.downloadDebugInfo}>Download Debug Info</button>
                    </div>
                </div>
            `;
        }

        return html`
            ${this.renderLoaderOverlay()}

            <div class="toast toast-passive ${this.toastMsg ? 'show' : ''}" role="status" aria-live="polite">${this.toastMsg}</div>

            ${this.renderUpdateToast()}

            ${this.renderHomeScreen()}
            ${this.renderWorkspace()}
            ${this.renderPrivacyModal()}
            ${this.renderDiagnosticsModal()}
            ${this.renderVerifyModal()}
            ${this.renderExitConfirmModal()}
        `;
    }
}
