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
import {pdfEngine} from './lib/pdf-engine';

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

    private updateSW: ((reload: boolean) => void) | undefined;

    @query('pdf-workspace') workspace: any;
    @query('dialog') privacyDialog!: HTMLDialogElement;

    createRenderRoot() {
        return this;
    }

    async firstUpdated(_changedProperties: PropertyValues) {
        super.firstUpdated(_changedProperties);

        const params = new URLSearchParams(window.location.search);
        const id = params.get('id');

        if (id) {
            this.verifyMode = true;
            this.expectedVerifyId = id;
            this.verifyResult = {
                status: 'pending_file',
                id: id
            };

            await this.updateComplete;

            if (this.verifyDialog) {
                this.verifyDialog.showModal();
            }
        }
    }

    connectedCallback() {
        super.connectedCallback();
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
                    console.log("App ready for offline use.");
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
                // Secure Check: Match file ID against the Deep Link ID
                if (fileId && fileId.toLowerCase() === this.expectedVerifyId.toLowerCase()) {
                    status = 'success';
                } else {
                    status = 'fail';
                }
                this.expectedVerifyId = null; // Clear it to prevent reuse
            } else {
                // Standard manual upload check
                status = fileId ? 'success' : 'fail';
            }

            this.verifyResult = {status, id: fileId || undefined};
            this.verifyHashInput = '';
            this.integrityStatus = 'idle';

            if (!this.verifyDialog.open) {
                this.verifyDialog.showModal();
            }

        } catch (e) {
            this.isLoading = false;
            this.showToast(i18n.t('errorReadingFile') || 'Error reading file');
        }
    }

    checkHash() {
        const input = this.verifyHashInput.trim().toLowerCase();
        const actual = this.verifyFileHash.toLowerCase();

        if (!input) return;

        if (input === actual) {
            this.integrityStatus = 'success';
        } else {
            this.integrityStatus = 'fail';
        }
    }

    closeVerify() {
        this.verifyDialog.close();
        this.verifyResult = {status: null};
        this.expectedVerifyId = null;
        this.integrityStatus = 'idle';
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    async startPendingVerification() {
        this.verifyDialog.close();
        await this.openFile();
    }

    async handleFile(data: Uint8Array, name: string) {
        const sizeInMB = data.byteLength / (1024 * 1024);
        const isMobile = Capacitor.isNativePlatform() || window.innerWidth < 768;
        const limit = isMobile ? 25 : 50;

        if (sizeInMB > limit) {
            const msg = i18n.t('fileTooBigMsg').replace('{size}', sizeInMB.toFixed(1));
            if (!confirm(msg)) {
                return;
            }
        }

        this.isLoading = true;
        this.requestUpdate();
        await new Promise(r => setTimeout(r, 50));

        try {
            this.mode = 'workspace';
            await this.updateComplete;
            if (this.workspace) {
                await this.workspace.loadPdf(data, name);
            }
        } catch (e) {
            console.error(e);
            this.showToast(i18n.t('errorLoading'));
            this.mode = 'home';
        } finally {
            this.isLoading = false;
        }
    }

    async openFile() {
        try {
            const {data, name} = await fileService.openPdf();

            // 🛡️ FIX: Check Mode!
            if (this.verifyMode) {
                // If in Verify Mode, run the check immediately
                // We create a "File" object manually to reuse handleVerify logic
                const file = new File([data as any], name, {type: 'application/pdf'});
                await this.handleVerify(file);
            } else {
                // Normal Edit Mode
                await this.handleFile(data, name);
            }
        } catch (e) {
            // User cancelled
        }
    }

    handleDrop(e: DragEvent) {
        e.preventDefault();
        if (e.dataTransfer?.files[0]) {
            const file = e.dataTransfer.files[0];

            // ✨ BRANCH LOGIC
            if (this.verifyMode) {
                this.handleVerify(file);
            } else {
                if (file.type === 'application/pdf') {
                    file.arrayBuffer().then(buffer => {
                        this.handleFile(new Uint8Array(buffer), file.name);
                    });
                }
            }
        }
    }

    handleLangChange(e: Event) {
        const select = e.target as HTMLSelectElement;
        i18n.setLanguage(select.value as any);
    }

    showPrivacy() {
        this.privacyDialog.showModal();
    }

    closePrivacy() {
        this.privacyDialog.close();
    }

    clearAppCache() {
        if (confirm(i18n.t('confirmClear'))) {
            localStorage.clear();
            window.location.reload();
        }
    }

    handleExitWorkspace() {
        if (confirm(i18n.t('exitConfirm'))) {
            this.workspace.reset();
            this.mode = 'home';
        }
    }

    handleImageError(e: Event) {
        const img = e.target as HTMLImageElement;
        img.style.display = 'none';
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
                <div class="toast show" style="bottom: 80px; background: #333; color: white;">
                    <span>🚀 ${i18n.t('updateAvailable') || 'New version available'}</span>
                    <button
                            @click=${() => this.updateSW && this.updateSW(true)}
                            style="margin-left:10px; padding:4px 8px; font-size:0.8rem; background:white; color:black; border:none; border-radius:4px;">
                        Reload
                    </button>
                </div>
            ` : ''}

            <div class="drop-zone ${this.mode === 'workspace' ? 'hidden' : ''}"
                 style="height: 100vh; overflow-y: auto; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 0;"
                 @dragover=${(e: DragEvent) => e.preventDefault()}
                 @drop=${this.handleDrop}>

                <div style="width: 100%; display: flex; justify-content: flex-end; padding: 20px; box-sizing: border-box; flex-shrink: 0;">
                    <select @change=${this.handleLangChange}
                            style="padding: 8px; border-radius: 8px; border: 1px solid #ddd; background: white; font-size: 0.9rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <option value="en" ?selected=${i18n.lang === 'en'}>English</option>
                        <option value="ar" ?selected=${i18n.lang === 'ar'}>العربية</option>
                        <option value="fr" ?selected=${i18n.lang === 'fr'}>Français</option>
                    </select>
                </div>

                <div class="drop-card" style="margin: auto 20px; width: 90%; max-width: 400px; flex-shrink: 0;">

                    <img src="./icons/icon-192.webp" alt="${i18n.t('appTitle')}"
                         style="width: 80px; height: 80px; margin-bottom: 20px; border-radius: 16px;"
                         @error=${this.handleImageError}/>

                    <h1>${i18n.t('appTitle')}</h1>
                    <p class="sub">v${packageJson.version} • ${i18n.t('tagline')}</p>

                    <div style="display:flex; background:#f3f4f6; padding:4px; border-radius:8px; margin-bottom:20px; width:100%;">
                        <button
                                @click=${() => this.verifyMode = false}
                                style="flex:1; background: ${!this.verifyMode ? '#fff' : 'transparent'}; color: ${!this.verifyMode ? '#000' : '#666'}; box-shadow: ${!this.verifyMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}; padding:8px; font-size:0.9rem;">
                            ✍️ ${i18n.t('signMode') || 'Sign'}
                        </button>
                        <button
                                @click=${() => this.verifyMode = true}
                                style="flex:1; background: ${this.verifyMode ? '#fff' : 'transparent'}; color: ${this.verifyMode ? '#000' : '#666'}; box-shadow: ${this.verifyMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}; padding:8px; font-size:0.9rem;">
                            🔍 ${i18n.t('verifyMode') || 'Verify'}
                        </button>
                    </div>

                    <div class="drop-area-visual">
                        <button @click=${this.openFile}>
                            ${this.verifyMode ? (i18n.t('selectFileVerify') || 'Select PDF to Verify') : i18n.t('selectFile')}
                        </button>
                        <p class="sub" style="margin: 12px 0 0 0; font-size: 0.85rem;">
                            ${this.verifyMode ? (i18n.t('dropHintVerify') || 'Drop a signed document here to check its digital ID') : i18n.t('dragDropHint')}
                        </p>
                    </div>

                    <div style="margin-top: 16px; font-size: 0.8rem; color: #10b981; font-weight: 500; background: #ecfdf5; padding: 6px 12px; border-radius: 20px;">
                        🛡️ ${i18n.t('privacyBadge')}
                    </div>

                    <div style="margin-top: 24px; display: flex; gap: 15px; font-size: 0.85rem;">
                        <a href="#" class="footer-link" @click=${(e: Event) => {
                            e.preventDefault();
                            this.showPrivacy();
                        }}>
                            ${i18n.t('privacyTitle')}
                        </a>

                        <span style="color: #ccc;">•</span>

                        <a href="mailto:${AppConfig.supportEmail}" class="footer-link">
                            ${i18n.t('contactUs')}
                        </a>
                    </div>

                    <button @click=${() => {
                        const url = `${AppConfig.website}/?lang=${i18n.lang}`;
                        navigator.clipboard.writeText(url);
                        this.showToast(i18n.t('linkCopied'));
                    }}
                            style="margin-top:20px; background:white; color:#333; border:1px solid #ddd; padding: 10px 20px; border-radius: 8px; font-size: 0.9rem; cursor: pointer;">
                        🔗 ${i18n.t('shareApp')}
                    </button>
                </div>

                <div style="height: 20px; flex-shrink: 0;"></div>
            </div>

            <pdf-workspace
                    class="${this.mode === 'home' ? 'hidden' : ''}"
                    @toast=${(e: CustomEvent) => this.showToast(e.detail)}
                    @set-loading=${(e: CustomEvent) => {
                        this.isLoading = e.detail;
                        this.requestUpdate();
                    }}
                    @exit-workspace=${this.handleExitWorkspace}
            ></pdf-workspace>

            <dialog>
                <div class="dialog-content">
                    <h2>${i18n.t('privacyTitle')}</h2>
                    <p>${i18n.t('privacyContent')}</p>
                    <hr style="margin: 20px 0; border: 0; border-top: 1px solid #eee;"/>
                    <button @click=${this.clearAppCache}
                            style="background: #fee2e2; color: #b91c1c; border: none; width: 100%; margin-bottom: 10px;">
                        ${i18n.t('forgetData')}
                    </button>
                </div>
                <div class="dialog-footer">
                    <button @click=${this.closePrivacy}>${i18n.t('close')}</button>
                </div>
            </dialog>

            <dialog id="verify-dialog"
                    @cancel=${this.closeVerify}
                    style="border-radius:20px; padding:0; border:none; box-shadow:0 20px 25px rgba(0,0,0,0.1); width:90%; max-width:450px;">
                <div style="padding: 24px;">
                    <div style="text-align:center; padding-bottom: 20px;">
                        ${this.verifyResult.status === 'pending_file' ? html`
                            <div style="width:60px; height:60px; background:#e0f2fe; color:#0284c7; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:30px; margin:0 auto 15px;">
                                🔍
                            </div>
                            <h2 style="margin:0 0 5px 0; color:#0369a1;">
                                ${i18n.t('linkDetected') || 'Link Detected'}</h2>
                            <p style="color:#4b5563; font-size:0.9rem; margin:0 0 15px 0;">
                                ${i18n.t('linkDetectedMsg') || 'Please select the document to verify against ID:'}
                                <strong>${this.verifyResult.id}</strong>
                            </p>
                            <button @click=${this.startPendingVerification}
                                    style="background:#2563eb; color:white; border:none; padding:10px 20px; border-radius:6px; cursor:pointer; width: 100%; font-size: 1rem;">
                                ${i18n.t('selectFileVerify')}
                            </button>
                        ` : this.verifyResult.status === 'success' ? html`
                            <div style="width:60px; height:60px; background:#dcfce7; color:#16a34a; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:30px; margin:0 auto 15px;">
                                ✓
                            </div>
                            <h2 style="margin:0 0 5px 0; color:#166534;">${i18n.t('recordFound')}</h2>
                            <p style="color:#4b5563; font-size:0.9rem; margin:0;">
                                ${i18n.t('internalRefLabel')} <strong>${this.verifyResult.id}</strong>
                            </p>
                        ` : html`
                            <div style="width:60px; height:60px; background:#fee2e2; color:#dc2626; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:30px; margin:0 auto 15px;">
                                !
                            </div>
                            <h2 style="margin:0 0 5px 0; color:#991b1b;">${i18n.t('noRecordFound')}</h2>
                        `}
                    </div>

                    ${this.verifyResult.status !== 'pending_file' ? html`
                        <hr style="border:0; border-top:1px dashed #e5e7eb; margin:0 0 20px 0;"/>

                        <div style="background:#f9fafb; padding:15px; border-radius:12px; border:1px solid #f3f4f6;">
                            <h3 style="font-size:0.9rem; margin:0 0 10px 0;">${i18n.t('integrityCheck')}</h3>

                            <div style="display:flex; gap:8px;">
                                <input type="text"
                                       .value="${this.verifyHashInput}"
                                       @input="${(e: any) => {
                                           this.verifyHashInput = e.target.value;
                                           this.integrityStatus = 'idle';
                                       }}"
                                       placeholder="${i18n.t('pasteHashPlaceholder')}"
                                       style="flex:1; padding:8px; border:1px solid #d1d5db; border-radius:6px;">
                                <button @click="${this.checkHash}"
                                        style="background:#2563eb; color:white; border:none; padding:0 15px; border-radius:6px; cursor:pointer;">
                                    ${i18n.t('verifyBtn')}
                                </button>
                            </div>

                            ${this.integrityStatus === 'success' ? html`
                                <div style="margin-top:10px; padding:10px; background:#dcfce7; color:#166534; border-radius:6px; font-size:0.85rem; border:1px solid #bbf7d0;">
                                    <span .innerHTML=${i18n.t('statusVerified')}></span>
                                </div>
                            ` : ''}

                            ${this.integrityStatus === 'fail' ? html`
                                <div style="margin-top:10px; padding:10px; background:#fee2e2; color:#991b1b; border-radius:6px; font-size:0.85rem; border:1px solid #fecaca;">
                                    <span .innerHTML=${i18n.t('statusMismatch')}></span>
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}

                    <button @click=${() => this.closeVerify()}
                            style="margin-top: 20px; width: 100%; padding: 12px; background: transparent; color: #4b5563; border: 1px solid #e5e7eb; border-radius: 8px; font-weight: 500; cursor: pointer;">
                        ${i18n.t('close')}
                    </button>
                </div>
            </dialog>
        `;
    }
}