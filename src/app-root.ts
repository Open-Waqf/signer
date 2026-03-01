import {html, LitElement, PropertyValues} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {App} from '@capacitor/app';
import {fileService} from './lib/file-service';
import {i18n} from './lib/i18n-service';
import packageJson from '../package.json';
import './components/pdf-workspace';
import {Capacitor} from '@capacitor/core';
import {registerSW} from 'virtual:pwa-register';
import {AppConfig} from './config';
import {LANGUAGES} from './i18n/locales';
import {pdfEngine} from './lib/pdf-engine';
import {PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import {ICONS} from './lib/icons';
import {StatusBar, Style} from '@capacitor/status-bar';

@customElement('app-root')
export class AppRoot extends LitElement {
    @state() mode: 'home' | 'workspace' = 'home';
    @state() isLoading = false;
    @state() toastMsg: string | null = null;
    @state() updateAvailable = false;
    @state() verifyMode = false;
    @state() verifyResult: { status: 'success' | 'fail' | 'pending_file' | null, id?: string } = {status: null};
    @state() expectedVerifyId: string | null = null;
    @state() verifyHashInput = '';
    @state() verifyFileHash = '';
    @query('dialog#verify-dialog') verifyDialog!: HTMLDialogElement;
    @state() integrityStatus: 'idle' | 'success' | 'fail' = 'idle';

    @state() showDiagnostics = false;
    private logoTapCount = 0;
    private logoTapTimeout: any = null;
    @state() showExitConfirm = false;

    private updateSW: ((reload: boolean) => void) | undefined;

    @query('pdf-workspace') workspace: any;
    @query('dialog#privacy-dialog') privacyDialog!: HTMLDialogElement;

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
        const id = params.get('id');

        if (id) {
            this.verifyMode = true;
            this.expectedVerifyId = id;
            this.verifyResult = {status: 'pending_file', id: id};
            await this.updateComplete;
            if (this.verifyDialog) this.verifyDialog.showModal();
        }
    }

    connectedCallback() {
        super.connectedCallback();
        if (Capacitor.isNativePlatform()) {
            StatusBar.setStyle({style: Style.Light}).catch(console.error);
            StatusBar.setBackgroundColor({color: '#ffffff'}).catch(console.error);
        }
        window.addEventListener('lang-changed', () => this.requestUpdate());
        this.setupPWA();

        App.addListener('backButton', () => {
            if (this.privacyDialog && this.privacyDialog.open) {
                this.closePrivacy();
                return;
            }
            const sigModal = document.querySelector('signature-modal');
            if (sigModal) {
                sigModal.remove();
                return;
            }
            if (this.mode === 'workspace') {
                this.handleExitWorkspace();
                return;
            }
            App.exitApp();
        });
    }

    setupPWA() {
        if (!Capacitor.isNativePlatform()) {
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

    async handleVerify(file: File) {
        this.isLoading = true;
        this.requestUpdate();

        try {
            const buffer = await file.arrayBuffer();
            const data = new Uint8Array(buffer);
            const fileId = await pdfEngine.readMetadataID(new Uint8Array(buffer));
            this.verifyFileHash = await pdfEngine.getFileHash(data)
            this.isLoading = false;

            let status: 'success' | 'fail' | null = null;
            if (this.expectedVerifyId) {
                status = (fileId && fileId.toLowerCase() === this.expectedVerifyId.toLowerCase()) ? 'success' : 'fail';
                this.expectedVerifyId = null;
            } else {
                status = fileId ? 'success' : 'fail';
            }

            this.verifyResult = {status, id: fileId || undefined};
            this.verifyHashInput = '';
            this.integrityStatus = 'idle';

            if (this.verifyDialog && !this.verifyDialog.open) this.verifyDialog.showModal();
        } catch (e) {
            this.isLoading = false;
            this.showToast(i18n.t('errorReadingFile') || 'Error reading file');
        }
    }

    checkHash() {
        const input = this.verifyHashInput.replace(/[\s\n-]/g, '').trim().toLowerCase();
        const actual = this.verifyFileHash.toLowerCase();
        if (!input) return;
        this.integrityStatus = (input === actual) ? 'success' : 'fail';
    }

    closeVerify() {
        if (this.verifyDialog) this.verifyDialog.close();
        this.verifyResult = {status: null};
        this.expectedVerifyId = null;
        this.integrityStatus = 'idle';
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    async startPendingVerification() {
        if (this.verifyDialog) this.verifyDialog.close();
        await this.openFile();
    }

    async handleFile(data: Uint8Array, name: string) {
        const sizeInMB = data.byteLength / (1024 * 1024);
        const isMobile = Capacitor.isNativePlatform() || window.innerWidth < 768;
        if (sizeInMB > (isMobile ? 25 : 50)) {
            if (!confirm(i18n.t('fileTooBigMsg').replace('{size}', sizeInMB.toFixed(1)))) return;
        }

        this.isLoading = true;
        this.requestUpdate();
        await new Promise(r => setTimeout(r, 50));

        try {
            this.mode = 'workspace';
            await this.updateComplete;
            if (this.workspace) await this.workspace.loadPdf(data, name);
        } catch (e) {
            this.showToast(i18n.t('errorLoading'));
            this.mode = 'home';
        } finally {
            this.isLoading = false;
        }
    }

    async loadSamplePdf() {
        this.isLoading = true;
        try {
            const pdfDoc = await PDFDocument.create();
            const page = pdfDoc.addPage([595.28, 841.89]);
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            page.drawText(i18n.t('sampleDocTitle'), {x: 50, y: 750, size: 24, font, color: rgb(0, 0.33, 0.71)});
            page.drawText(i18n.t('sampleDocText1'), {
                x: 50,
                y: 700,
                size: 12,
                font
            });
            page.drawText(i18n.t('sampleDocText2'), {
                x: 50,
                y: 680,
                size: 12,
                font
            });

            const pdfBytes = await pdfDoc.save();
            this.mode = 'workspace';
            await this.updateComplete;
            await this.workspace.loadPdf(pdfBytes, 'sample_document.pdf');
        } catch (e) {
            this.showToast(i18n.t('errorSamplePdf'));
        } finally {
            this.isLoading = false;
        }
    }

    async openFile() {
        try {
            const {data, name} = await fileService.openPdf();
            if (this.verifyMode) {
                await this.handleVerify(new File([data as any], name, {type: 'application/pdf'}));
            } else {
                await this.handleFile(data, name);
            }
        } catch (e) {
            console.error('Error opening file:', e);
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
        if (this.privacyDialog) this.privacyDialog.showModal();
    }

    closePrivacy() {
        if (this.privacyDialog) this.privacyDialog.close();
    }

    clearAppCache() {
        if (confirm(i18n.t('confirmClear'))) {
            localStorage.clear();
            window.location.reload();
        }
    }

    handleExitWorkspace() {
        if (this.workspace && this.workspace.isDirty) {
            this.showExitConfirm = true;
        } else {
            this.workspace.reset();
            this.mode = 'home';
        }
    }

    render() {
        return html`
            ${this.isLoading ? html`
                <div class="loader-overlay">
                    <div class="spinner"></div>
                    <div>${i18n.t('loadingDoc')}</div>
                </div>
            ` : ''}

            <div class="toast ${this.toastMsg ? 'show' : ''}">${this.toastMsg}</div>

            ${this.updateAvailable ? html`
                <div class="toast show">
                    <span style="display:flex; align-items:center; gap:8px;">${ICONS.alert} ${i18n.t('updateAvailable')}</span>
                    <button class="btn btn-primary" style="padding: 4px 8px; margin-top: 8px;"
                            @click=${() => this.updateSW && this.updateSW(true)}>
                        ${i18n.t('reload')}
                    </button>
                </div>
            ` : ''}

            <div class="drop-zone ${this.mode === 'workspace' ? 'hidden' : ''}"
                 @dragover=${(e: DragEvent) => e.preventDefault()} @drop=${this.handleDrop}>

                <div class="layout-header">
                    <select class="lang-select" @change=${this.handleLangChange}>
                        ${LANGUAGES.map(l => html`
                            <option value="${l.code}" ?selected=${i18n.lang === l.code}>${l.label}</option>
                        `)}
                    </select>
                </div>

                <div class="drop-card">
                    <img src="./icons/icon-192.webp" alt="${i18n.t('appTitle')}" @click=${this.handleSecretTap}
                         draggable="false"/>
                    <h1>${i18n.t('appTitle')}</h1>
                    <p class="sub">v${packageJson.version} • ${i18n.t('tagline')}</p>

                    <div class="mode-toggle">
                        <button class="${!this.verifyMode ? 'active' : ''}" @click=${() => this.verifyMode = false}>
                            <span style="display:flex; align-items:center; justify-content:center; gap:6px;">${ICONS.sign} ${i18n.t('signMode') || 'Sign'}</span>
                        </button>
                        <button class="${this.verifyMode ? 'active' : ''}" @click=${() => this.verifyMode = true}>
                            <span style="display:flex; align-items:center; justify-content:center; gap:6px;">${ICONS.search} ${i18n.t('verifyMode') || 'Verify'}</span>
                        </button>
                    </div>

                    <div class="drop-area-visual" @click=${this.openFile}>
                        <button class="btn btn-primary">
                            ${this.verifyMode ? i18n.t('selectFileVerify') : i18n.t('selectFile')}
                        </button>
                        <p class="sub" style="margin-top: 12px; font-size: 0.85rem;">
                            ${this.verifyMode ? i18n.t('dropHintVerify') : i18n.t('dragDropHint')}
                        </p>
                    </div>

                    ${!this.verifyMode ? html`
                        <button class="text-link" style="margin-top: 15px;" @click=${this.loadSamplePdf}>
                            ${i18n.t('trySample') || 'No file? Try with a sample PDF'}
                        </button>
                    ` : ''}

                    <div style="margin-top: 16px;">
                        <span class="badge-success">${ICONS.shield} ${i18n.t('privacyBadge')}</span>
                    </div>

                    <div class="footer-links">
                        <a class="footer-link" @click=${this.showPrivacy}>${i18n.t('privacyTitle')}</a>
                        <span>•</span>
                        <a href="mailto:${AppConfig.supportEmail}" class="footer-link">${i18n.t('contactUs')}</a>
                    </div>

                    <button class="btn" style="margin-top: 20px; width: 100%;" @click=${() => {
                        navigator.clipboard.writeText(`${AppConfig.website}/?lang=${i18n.lang}`);
                        this.showToast(i18n.t('linkCopied'));
                    }}>
                        ${ICONS.link} ${i18n.t('shareApp')}
                    </button>
                </div>

                ${!this.verifyMode ? html`
                    <div class="features-section">
                        <h3 style="text-align: center; color: var(--text-main); margin-bottom: 24px;">
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
                ` : ''}
                <div style="height: 40px; flex-shrink: 0;"></div>
            </div>

            <pdf-workspace class="${this.mode === 'home' ? 'hidden' : ''}"
                           @toast=${(e: CustomEvent) => this.showToast(e.detail)}
                           @set-loading=${(e: CustomEvent) => {
                               this.isLoading = e.detail;
                               this.requestUpdate();
                           }}
                           @exit-workspace=${this.handleExitWorkspace}>
            </pdf-workspace>

            <dialog id="privacy-dialog" aria-modal="true" aria-label="${i18n.t('privacyTitle')}">
                <div class="dialog-content">
                    <h2>${i18n.t('privacyTitle')}</h2>
                    <p style="font-size: 0.95rem; color: var(--text-sub);">${i18n.t('privacyContent')}</p>

                    <div class="amanah-panel">
                        <h4 style="margin: 0 0 5px 0; color: #065f46; display:flex; align-items:center; gap:6px;">
                            ${ICONS.shield} ${i18n.t('securityModel')}
                        </h4>
                        <p style="margin: 0; font-size: 0.85rem; color: #047857;">${i18n.t('securityModelText')}</p>
                    </div>

                    <div class="info-panel">
                        <a href="https://github.com/open-waqf/signer" target="_blank"
                           style="color: var(--primary); display: block; margin-bottom: 4px;">
                            ${i18n.t('viewSourceCode')} ↗
                        </a>
                    </div>

                    <button class="btn btn-danger" style="width: 100%; margin-top: 15px;" @click=${this.clearAppCache}>
                        ${i18n.t('forgetData')}
                    </button>
                </div>
                <div class="dialog-footer">
                    <button class="btn" @click=${this.closePrivacy}>${i18n.t('close')}</button>
                </div>
            </dialog>

            ${this.showDiagnostics ? html`
                <div class="modal-overlay" @click=${() => this.showDiagnostics = false}>
                    <div class="modal-card" style="max-width: 420px; border-radius: 16px;"
                         @click=${(e: Event) => e.stopPropagation()}>
                        <h2 style="margin-top:0; display:flex; align-items:center; gap:8px;">${ICONS.cog}
                            ${i18n.t('diagnostics')}</h2>
                        <div class="diagnostics-panel">
                            <div>${i18n.t('appVersion')}: ${packageJson.version}</div>
                            <div>${i18n.t('platform')}:
                                ${Capacitor.isNativePlatform() ? i18n.t('platformNative') : i18n.t('platformWeb')}
                            </div>
                            <div>${i18n.t('userAgent')}: ${navigator.userAgent}</div>
                            <div>${i18n.t('windowSize')}: ${window.innerWidth}x${window.innerHeight}</div>
                            <div>${i18n.t('connection')}: ${navigator.onLine ? i18n.t('online') : i18n.t('offline')}
                            </div>
                        </div>
                        <div style="display: flex; justify-content: center; margin-top: 15px;">
                            <button class="btn" style="width:100%;" @click=${() => this.showDiagnostics = false}>
                                ${i18n.t('close')}
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}

            <dialog id="verify-dialog" @cancel=${this.closeVerify} aria-modal="true" aria-label="${i18n.t('verifyMode')}">
                <div class="dialog-content" style="text-align: center;">
                    ${this.verifyResult.status === 'pending_file' ? html`
                        <div style="color:var(--primary); margin-bottom:15px; display:flex; justify-content:center;">
                            <div style="padding:15px; background:#eff6ff; border-radius:50%;">${ICONS.search}</div>
                        </div>
                        <h2>${i18n.t('linkDetected')}</h2>
                        <p class="sub">${i18n.t('linkDetectedMsg')} <strong>${this.verifyResult.id}</strong></p>
                        <button class="btn btn-primary" style="width: 100%;" @click=${this.startPendingVerification}>
                            ${i18n.t('selectFileVerify')}
                        </button>
                    ` : this.verifyResult.status === 'success' ? html`
                        <div style="color:#10b981; margin-bottom:15px; display:flex; justify-content:center;">
                            <div style="padding:15px; background:#ecfdf5; border-radius:50%;">${ICONS.info}</div>
                        </div>
                        <h2 style="color:#166534;">${i18n.t('recordFound')}</h2>
                        <p class="sub">${i18n.t('internalRefLabel')} <strong>${this.verifyResult.id}</strong></p>
                        <div class="amanah-panel"
                             style="text-align:left; color:#b45309; background:#fffbeb; border-color:#fde68a;">
                            ${i18n.t('recordFoundDisclaimer')}
                        </div>
                    ` : html`
                        <div style="color:#ef4444; margin-bottom:15px; display:flex; justify-content:center;">
                            <div style="padding:15px; background:#fee2e2; border-radius:50%;">${ICONS.alert}</div>
                        </div>
                        <h2 style="color:#991b1b;">${i18n.t('noRecordFound')}</h2>
                    `}

                    ${this.verifyResult.status !== 'pending_file' ? html`
                        <hr style="margin: 20px 0; border: 0; border-top: 1px dashed var(--border);"/>
                        <div class="info-panel" style="text-align:left;">
                            <h3 style="margin: 0 0 10px 0; font-size: 0.95rem;">${i18n.t('integrityCheck')}</h3>
                            <div style="display:flex; gap:8px;">
                                <input type="text" class="input-field" .value="${this.verifyHashInput}"
                                       @input="${(e: any) => {
                                           this.verifyHashInput = e.target.value;
                                           this.integrityStatus = 'idle';
                                       }}" placeholder="${i18n.t('pasteHashPlaceholder')}">
                                <button class="btn btn-primary" @click="${this.checkHash}">${i18n.t('verifyBtn')}
                                </button>
                            </div>
                            ${this.integrityStatus === 'success' ? html`
                                <div class="info-panel alert-success" style="margin-top:10px;"
                                     .innerHTML=${i18n.t('statusVerified')}></div>` : ''}
                            ${this.integrityStatus === 'fail' ? html`
                                <div class="info-panel alert-error" style="margin-top:10px;"
                                     .innerHTML=${i18n.t('statusMismatch')}></div>` : ''}
                        </div>
                    ` : ''}
                </div>
                <div class="dialog-footer">
                    <button class="btn" style="width: 100%;" @click=${this.closeVerify}>${i18n.t('close')}</button>
                </div>
            </dialog>

            ${this.showExitConfirm ? html`
                <div class="modal-overlay" @click=${() => this.showExitConfirm = false}>
                    <div class="modal-card center" role="dialog" aria-modal="true"
                         aria-label="${i18n.t('exitConfirmTitle')}"
                         @click=${(e: Event) => e.stopPropagation()}>
                        <div style="color:#ef4444; margin-bottom:15px; display:flex; justify-content:center;">
                            <div style="padding:15px; background:#fee2e2; border-radius:50%;">${ICONS.alert}</div>
                        </div>
                        <h2 style="margin-top:0; color: var(--text-main);">
                            ${i18n.t('exitConfirmTitle') || 'Unsaved Changes'}</h2>
                        <p style="color:var(--text-sub); font-size:0.95rem; margin-bottom:20px;">
                            ${i18n.t('exitConfirmText') || 'You have unsaved changes. Are you sure you want to go back? Your edits will be lost.'}
                        </p>
                        <div style="display:flex; gap:10px;">
                            <button class="btn" style="flex:1;" @click=${() => this.showExitConfirm = false}>
                                ${i18n.t('cancel') || 'Cancel'}
                            </button>
                            <button class="btn btn-danger" style="flex:1;" @click=${() => {
                                this.showExitConfirm = false;
                                this.workspace.reset();
                                this.mode = 'home';
                            }}>${i18n.t('exitBtn') || 'Exit'}
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
        `;
    }
}