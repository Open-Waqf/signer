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
import QRCode from 'qrcode';
import {StatusBar, Style} from '@capacitor/status-bar';
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
    @state() showAirGapModal = false;
    @state() airGapMode: 'send' | 'receive' = 'receive';
    @state() airGapSendReady = false;
    @state() airGapFrameCounter = 0;
    @state() airGapFrameTotal = 0;
    @state() airGapReceivePercent = 0;
    @state() airGapReceiveLabel = '';
    @state() airGapReceiveActive = false;
    @state() airGapStatus = '';

    private updateSW: ((reload: boolean) => void) | undefined;
    private backButtonListener: Promise<{ remove: () => Promise<void> }> | null = null;
    private readonly onLangChanged = () => this.requestUpdate();
    private airGapSender: any | null = null;
    private airGapDecoder: any | null = null;
    private airGapSendTimer: number | null = null;
    private airGapHtml5Scanner: any | null = null;
    private airGapNativeListener: any | null = null;
    private airGapNativeScanner: any | null = null;
    private airGapNativeScanActive = false;
    private airGapSentFileName = 'Transferred_Document.pdf';

    @query('pdf-workspace') workspace: any;
    @query('#airgap-send-canvas') private airGapCanvas?: HTMLCanvasElement;
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
        window.removeEventListener('lang-changed', this.onLangChanged);
        this.stopAirGapSendLoop();
        this.stopAirGapScanner();
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

    private handleBackButton() {
        if (this.showPrivacyModal) {
            this.closePrivacy();
            return;
        }
        if (this.showVerifyModal) {
            this.closeVerify();
            return;
        }
        if (this.closeSignatureModalIfOpen()) {
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

    private resetAirGapState() {
        this.airGapSendReady = false;
        this.airGapFrameCounter = 0;
        this.airGapFrameTotal = 0;
        this.airGapReceivePercent = 0;
        this.airGapReceiveLabel = '';
        this.airGapReceiveActive = false;
        this.airGapStatus = '';
        this.airGapSender = null;
        this.airGapDecoder = null;
        this.airGapSentFileName = 'Transferred_Document.pdf';
    }

    private stopAirGapSendLoop() {
        if (this.airGapSendTimer !== null) {
            window.clearInterval(this.airGapSendTimer);
            this.airGapSendTimer = null;
        }
    }

    private stopAirGapScanner() {
        if (this.airGapHtml5Scanner) {
            const scanner = this.airGapHtml5Scanner;
            this.airGapHtml5Scanner = null;
            scanner.stop().catch(() => {
            });
            scanner.clear();
        }

        if (this.airGapNativeListener) {
            const listener = this.airGapNativeListener;
            this.airGapNativeListener = null;
            listener.remove().catch(() => {
            });
        }

        this.airGapNativeScanActive = false;
        if (this.airGapNativeScanner) {
            this.airGapNativeScanner.stopScan().catch(() => {
            });
            this.airGapNativeScanner = null;
        }
        document.body.classList.remove('airgap-native-camera');
    }

    closeAirGapModal() {
        this.stopAirGapSendLoop();
        this.stopAirGapScanner();
        this.resetAirGapState();
        this.showAirGapModal = false;
    }

    async openReceiveAirGapModal() {
        this.showAirGapModal = true;
        this.airGapMode = 'receive';
        this.resetAirGapState();
        await this.updateComplete;
        void this.startReceiveScanner();
    }

    async handleAirGapSendRequest(e: CustomEvent<{ data: Uint8Array; name: string }>) {
        const payload = e.detail;
        if (!payload?.data?.byteLength) return;
        this.showAirGapModal = true;
        this.airGapMode = 'send';
        this.resetAirGapState();
        this.airGapSentFileName = payload.name || 'Transferred_Document.pdf';
        this.airGapStatus = i18n.t('airGapPreparing');

        try {
            const {AirGapTransferSender} = await import('./lib/airgap-transfer');
            this.airGapSender = await AirGapTransferSender.create(payload.data, this.airGapSentFileName);
            this.airGapFrameTotal = this.airGapSender.totalShards;
            this.airGapSendReady = true;
            this.airGapStatus = i18n.t('airGapReady').replace('{count}', String(this.airGapFrameTotal));
            await this.updateComplete;
            this.startAirGapAnimation();
        } catch (error) {
            console.error('Failed to prepare air-gap transfer:', error);
            this.airGapStatus = i18n.t('airGapPrepareFailed');
        }
    }

    private startAirGapAnimation() {
        this.stopAirGapSendLoop();
        const drawNext = async () => {
            if (!this.airGapSender || !this.airGapCanvas) return;
            const frame = this.airGapSender.nextFrame();
            this.airGapFrameCounter++;
            this.airGapStatus = i18n.t('airGapBroadcasting').replace('{index}', String((this.airGapFrameCounter % Math.max(1, this.airGapFrameTotal)) + 1)).replace('{total}', String(this.airGapFrameTotal));
            await QRCode.toCanvas(this.airGapCanvas, frame, {
                errorCorrectionLevel: 'M',
                margin: 1,
                width: 320,
            });
        };

        void drawNext();
        this.airGapSendTimer = window.setInterval(() => {
            void drawNext();
        }, 150);
    }

    private async startReceiveScanner() {
        this.stopAirGapScanner();
        const {AirGapTransferDecoder} = await import('./lib/airgap-transfer');
        this.airGapDecoder = await AirGapTransferDecoder.create();
        this.airGapReceivePercent = 0;
        this.airGapReceiveLabel = i18n.t('airGapWaitingFrames');
        this.airGapReceiveActive = true;
        this.airGapStatus = i18n.t('airGapScannerStarting');

        if (isNativePlatform()) {
            const started = await this.startNativeScanner();
            if (started) return;
        }
        await this.startWebScanner();
    }

    private async startWebScanner() {
        try {
            const {Html5Qrcode, Html5QrcodeSupportedFormats} = await import('html5-qrcode');
            const scannerElementId = 'airgap-web-scanner';
            this.airGapHtml5Scanner = new Html5Qrcode(scannerElementId, {
                verbose: false,
                formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
            });

            this.airGapStatus = i18n.t('airGapScannerRunning');
            await this.airGapHtml5Scanner.start(
                {facingMode: 'environment'},
                {
                    fps: 10,
                    qrbox: {width: 260, height: 260},
                    disableFlip: true,
                },
                (decodedText: string) => {
                    void this.consumeAirGapFrame(decodedText);
                },
                (_errorMessage: string) => {
                    // Ignore per-frame decode errors to keep UI smooth.
                }
            );
        } catch (error) {
            console.error('Failed to start web scanner:', error);
            this.airGapStatus = i18n.t('airGapScannerUnsupported');
            this.airGapReceiveActive = false;
        }
    }

    private async startNativeScanner(): Promise<boolean> {
        const module = await import('@capacitor-mlkit/barcode-scanning').catch(() => null);
        if (!module) return false;
        const {BarcodeScanner, BarcodeFormat, LensFacing} = module;
        this.airGapNativeScanner = BarcodeScanner;

        const support = await BarcodeScanner.isSupported().catch(() => ({supported: false}));
        if (!support.supported) return false;

        this.airGapNativeScanActive = true;
        document.body.classList.add('airgap-native-camera');
        this.airGapStatus = i18n.t('airGapNativeScanner');

        try {
            const permission = await BarcodeScanner.requestPermissions();
            if (permission.camera !== 'granted' && permission.camera !== 'limited') {
                this.airGapStatus = i18n.t('airGapScannerDenied');
                this.airGapReceiveActive = false;
                this.airGapNativeScanActive = false;
                document.body.classList.remove('airgap-native-camera');
                return true;
            }
        } catch (error) {
            console.error('Native scanner permission failed:', error);
            this.airGapStatus = i18n.t('airGapScannerDenied');
            this.airGapReceiveActive = false;
            return true;
        }

        this.airGapNativeListener = await BarcodeScanner.addListener('barcodesScanned', (event) => {
            if (!this.airGapNativeScanActive) return;
            for (const barcode of event.barcodes || []) {
                const raw = barcode.rawValue || barcode.displayValue;
                if (raw) {
                    void this.consumeAirGapFrame(raw);
                }
            }
        });

        await BarcodeScanner.startScan({
            formats: [BarcodeFormat.QrCode],
            lensFacing: LensFacing.Back,
        });

        return true;
    }

    private async consumeAirGapFrame(raw: string) {
        if (!this.airGapDecoder) return;

        const progress = this.airGapDecoder.addFrame(raw);
        if (progress.total > 0) {
            this.airGapReceivePercent = Math.min(100, Math.round(progress.progress * 100));
            this.airGapReceiveLabel = i18n.t('airGapReceivingFrames')
                .replace('{received}', String(progress.received))
                .replace('{total}', String(progress.total));
        }

        if (!progress.done) return;
        this.airGapStatus = i18n.t('airGapReconstructing');

        try {
            const finalized = await this.airGapDecoder.finalizeIfComplete();
            if (!finalized.data) return;

            this.stopAirGapScanner();
            this.airGapReceiveActive = false;
            this.airGapStatus = i18n.t('airGapComplete');
            const loadName = finalized.fileName || 'Transferred_Document.pdf';
            await this.handleFile(finalized.data, loadName);
            this.closeAirGapModal();
        } catch (error) {
            console.error('Failed to finalize transfer:', error);
            this.airGapStatus = i18n.t('airGapDecodeFailed');
            this.showToast(i18n.t('airGapDecodeFailed'));
            this.airGapReceiveActive = false;
            this.stopAirGapScanner();
        }
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
            <div class="loader-overlay">
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
                        <select class="lang-select" data-testid="select-lang-home" @change=${this.handleLangChange}>
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
                            ${!this.verifyMode ? html`
                                <button class="btn" type="button" data-testid="btn-receive-airgap"
                                        @click=${(e: Event) => {
                                            e.stopPropagation();
                                            void this.openReceiveAirGapModal();
                                        }}>
                                    ${ICONS.camera} ${i18n.t('receiveDocument')}
                                </button>
                            ` : ''}
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
                            <a class="footer-link" data-testid="link-privacy" @click=${this.showPrivacy}>${i18n.t('privacyTitle')}</a>
                            <span>•</span>
                            <a href="mailto:${AppConfig.supportEmail}" class="footer-link">${i18n.t('contactUs')}</a>
                        </div>

                        <button class="btn share-app-btn" data-testid="btn-share-app" @click=${() => {
                            navigator.clipboard.writeText(`${AppConfig.website}/?lang=${i18n.lang}`);
                            this.showToast(i18n.t('linkCopied'));
                        }}>
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
                           @airgap-send=${(e: CustomEvent<{ data: Uint8Array; name: string }>) => void this.handleAirGapSendRequest(e)}
                           @exit-workspace=${this.handleExitWorkspace}>
            </pdf-workspace>
        `;
    }

    private renderPrivacyModal() {
        return html`
            <owq-modal .open=${this.showPrivacyModal}
                       .closeOnBackdrop=${false}
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
            <div class="verify-step-card info-panel">
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
                     .innerHTML=${i18n.t(this.integrityStatus === 'success' ? 'chainValidated' : 'chainValidatedPreliminary')
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

    private renderAirGapModal() {
        if (!this.showAirGapModal) return '';
        return html`
            <owq-modal .open=${this.showAirGapModal}
                       .closeOnBackdrop=${false}
                       ariaLabel="${i18n.t('airGapTransfer')}"
                       @modal-close=${() => this.closeAirGapModal()}>
                <div class="dialog-content" dir=${document.documentElement.dir || 'ltr'}>
                    <h2 class="modal-title">${i18n.t('airGapTransfer')}</h2>
                    <div class="mode-toggle">
                        <button data-testid="btn-airgap-send-tab"
                                class="${this.airGapMode === 'send' ? 'active' : ''}"
                                @click=${async () => {
                                    this.airGapMode = 'send';
                                    this.stopAirGapScanner();
                                    await this.updateComplete;
                                    if (this.airGapSender) this.startAirGapAnimation();
                                }}>
                            <span class="mode-label">${ICONS.qr} ${i18n.t('airGapSend')}</span>
                        </button>
                        <button data-testid="btn-airgap-receive-tab"
                                class="${this.airGapMode === 'receive' ? 'active' : ''}"
                                @click=${async () => {
                                    this.airGapMode = 'receive';
                                    this.stopAirGapSendLoop();
                                    await this.updateComplete;
                                    await this.startReceiveScanner();
                                }}>
                            <span class="mode-label">${ICONS.camera} ${i18n.t('airGapReceive')}</span>
                        </button>
                    </div>

                    ${this.airGapMode === 'send' ? html`
                        <p class="modal-copy">${i18n.t('airGapSendHelp')}</p>
                        <div class="info-panel">${this.airGapStatus}</div>
                        ${this.airGapSendReady ? html`
                            <canvas id="airgap-send-canvas" data-testid="airgap-send-canvas" class="airgap-qr-canvas"></canvas>
                            <p class="verify-step-note">${this.airGapSentFileName}</p>
                        ` : html`
                            <p class="verify-step-note">${i18n.t('airGapNoSendPayload')}</p>
                        `}
                    ` : html`
                        <p class="modal-copy">${i18n.t('airGapReceiveHelp')}</p>
                        <div class="info-panel">${this.airGapStatus}</div>
                        ${isNativePlatform() ? html`
                            <div class="airgap-native-hint">${i18n.t('airGapNativeScanner')}</div>
                        ` : html`
                            <div id="airgap-web-scanner" data-testid="airgap-web-scanner" class="airgap-video"></div>
                        `}
                        <div class="airgap-progress-wrap" data-testid="airgap-progress-wrap">
                            <div class="airgap-progress-bar" style="width:${this.airGapReceivePercent}%"></div>
                        </div>
                        <p class="verify-step-note">${this.airGapReceiveLabel}</p>
                        ${!this.airGapReceiveActive ? html`
                            <button class="btn btn-primary" data-testid="btn-airgap-retry"
                                    @click=${() => this.startReceiveScanner()}>
                                ${i18n.t('airGapRetryScan')}
                            </button>
                        ` : ''}
                    `}
                </div>
                <div class="dialog-footer">
                    <button class="btn" data-testid="btn-close-airgap" @click=${() => this.closeAirGapModal()}>
                        ${i18n.t('close')}
                    </button>
                </div>
            </owq-modal>
        `;
    }

    render() {
        return html`
            ${this.renderLoaderOverlay()}

            <div class="toast toast-passive ${this.toastMsg ? 'show' : ''}">${this.toastMsg}</div>

            ${this.renderUpdateToast()}

            ${this.renderHomeScreen()}
            ${this.renderWorkspace()}
            ${this.renderPrivacyModal()}
            ${this.renderDiagnosticsModal()}
            ${this.renderVerifyModal()}
            ${this.renderExitConfirmModal()}
            ${this.renderAirGapModal()}
        `;
    }
}
