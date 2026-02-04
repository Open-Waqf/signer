import {html, LitElement} from 'lit';
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
    @state() verifyResult: { status: 'success' | 'fail' | null, id?: string } = {status: null};
    @query('dialog#verify-dialog') verifyDialog!: HTMLDialogElement;

    private updateSW: ((reload: boolean) => void) | undefined;

    @query('pdf-workspace') workspace: any;
    @query('dialog') privacyDialog!: HTMLDialogElement;

    createRenderRoot() {
        return this;
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
                    this.showToast(i18n.t('updateAvailable') || 'New update available!');
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
            const id = await pdfEngine.readMetadataID(new Uint8Array(buffer));
            this.isLoading = false;

            if (id) {
                // ✅ SUCCESS
                this.verifyResult = {status: 'success', id};
            } else {
                // ❌ FAILURE
                this.verifyResult = {status: 'fail'};
            }
            // Open the new nice dialog
            this.verifyDialog.showModal();

        } catch (e) {
            this.isLoading = false;
            this.showToast(i18n.t('errorReadingFile') || 'Error reading file');
        }
    }

    closeVerify() {
        this.verifyDialog.close();
        this.verifyResult = {status: null}; // Reset
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

                    <img src="/icons/icon-192.webp" alt="${i18n.t('appTitle')}"
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
                        const url = `${window.location.origin}/?lang=${i18n.lang}`;
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
                    style="border-radius: 20px; padding: 0; border: none; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); max-width: 400px; width: 90%;">
                <div style="padding: 30px; text-align: center;">

                    ${this.verifyResult.status === 'success' ? html`
                        <div style="width: 80px; height: 80px; background: #dcfce7; color: #16a34a; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 40px; margin: 0 auto 20px;">
                            ✓
                        </div>
                        <h2 style="margin: 0 0 10px 0; color: #166534;">
                            ${i18n.t('validDocTitle') || 'Valid Document'}</h2>
                        <p style="color: #4b5563; font-size: 0.95rem; line-height: 1.5;">
                            ${i18n.t('validDocMsg') || 'This document has a valid digital ID embedded by Open Signer.'}
                        </p>

                        <div style="background: #f3f4f6; padding: 15px; border-radius: 12px; margin: 20px 0; font-family: monospace; font-size: 1.1rem; letter-spacing: 1px; color: #111;">
                            ${this.verifyResult.id}
                        </div>

                        <p style="font-size: 0.8rem; color: #6b7280;">
                            ℹ️
                            ${i18n.t('validDocHint') || 'Please ensure this ID matches the footer code on every page of the document.'}
                        </p>

                    ` : html`
                        <div style="width: 80px; height: 80px; background: #fee2e2; color: #dc2626; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 40px; margin: 0 auto 20px;">
                            !
                        </div>
                        <h2 style="margin: 0 0 10px 0; color: #991b1b;">
                            ${i18n.t('invalidDocTitle') || 'No ID Found'}</h2>
                        <p style="color: #4b5563; font-size: 0.95rem; line-height: 1.5;">
                            ${i18n.t('invalidDocMsg') || 'This document does not contain a valid digital signature ID from this app.'}
                        </p>
                        <div style="margin-top: 20px; font-size: 0.8rem; color: #dc2626; background: #fef2f2; padding: 10px; border-radius: 8px;">
                            ⚠️ Warning: The file may have been modified or tampererd with.
                        </div>
                    `}

                    <button @click=${() => this.closeVerify()}
                            style="margin-top: 25px; width: 100%; padding: 12px; background: #111827; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">
                        ${i18n.t('close') || 'Close'}
                    </button>
                </div>
            </dialog>
        `;
    }
}