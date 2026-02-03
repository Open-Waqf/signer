import {html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {App} from '@capacitor/app';
import {fileService} from './lib/file-service';
import {i18n} from './lib/i18n-service';
import packageJson from '../package.json';
import './components/pdf-workspace';

@customElement('app-root')
export class AppRoot extends LitElement {
    @state() mode: 'home' | 'workspace' = 'home';
    @state() isLoading = false;
    @state() toastMsg: string | null = null;

    @query('pdf-workspace') workspace: any;
    @query('dialog') privacyDialog!: HTMLDialogElement;

    createRenderRoot() {
        return this;
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('lang-changed', () => this.requestUpdate());

        App.addListener('backButton', () => {
            if (this.privacyDialog && this.privacyDialog.open) {
                this.closePrivacy();
                return;
            }
            if (this.mode === 'workspace') {
                if (confirm(i18n.t('exitConfirm'))) {
                    this.mode = 'home';
                }
                return;
            }
            App.exitApp();
        });
    }

    showToast(msg: string) {
        this.toastMsg = msg;
        setTimeout(() => {
            this.toastMsg = null;
        }, 3000);
    }

    async handleFile(data: Uint8Array, name: string) {
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
            const data = await fileService.openPdf();
            await this.handleFile(data, 'document.pdf');
        } catch (e) {
            // Cancelled
        }
    }

    handleDrop(e: DragEvent) {
        e.preventDefault();
        if (e.dataTransfer?.files[0]) {
            const file = e.dataTransfer.files[0];
            if (file.type === 'application/pdf') {
                file.arrayBuffer().then(buffer => {
                    this.handleFile(new Uint8Array(buffer), file.name);
                });
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

    render() {
        return html`
            ${this.isLoading ? html`
                <div class="loader-overlay">
                    <div class="spinner"></div>
                    <div>${i18n.t('loadingDoc')}</div>
                </div>
            ` : ''}

            <div class="toast ${this.toastMsg ? 'show' : ''}">${this.toastMsg}</div>

            <div class="drop-zone ${this.mode === 'workspace' ? 'hidden' : ''}"
                 @dragover=${(e: DragEvent) => e.preventDefault()}
                 @drop=${this.handleDrop}>

                <div style="position: absolute; top: 20px; right: 20px;">
                    <select @change=${this.handleLangChange}
                            style="padding: 6px; border-radius: 6px; border: 1px solid #ddd;">
                        <option value="en" ?selected=${i18n.lang === 'en'}>English</option>
                        <option value="ar" ?selected=${i18n.lang === 'ar'}>العربية</option>
                        <option value="fr" ?selected=${i18n.lang === 'fr'}>Français</option>
                    </select>
                </div>

                <div class="drop-card">
                    <img src="/icons/icon-192.webp" alt="Logo" onerror="this.style.display='none'"/>

                    <h1>${i18n.t('appTitle')}</h1>
                    <p class="sub">v${packageJson.version} • Secure. Offline. Free.</p>

                    <div class="drop-area-visual">
                        <button @click=${this.openFile}>${i18n.t('selectFile')}</button>
                        <p class="sub" style="margin: 12px 0 0 0; font-size: 0.85rem;">${i18n.t('dragDropHint')}</p>
                    </div>

                    <a href="#" class="footer-link" @click=${(e: Event) => {
                        e.preventDefault();
                        this.showPrivacy();
                    }}>
                        ${i18n.t('privacyTitle')}
                    </a>

                    <button @click=${() => {
                        const url = `${window.location.origin}/?lang=${i18n.lang}`;
                        navigator.clipboard.writeText(url);
                        this.showToast(i18n.t('linkCopied')); // <--- Translated
                    }}
                            style="margin-top:10px; background:#fff; color:#333; border:1px solid #ddd; padding: 12px 30px; border-radius: 8px; font-size: 1rem; cursor: pointer; font-weight: 600;">
                        ${i18n.t('shareApp')}
                    </button>
                </div>
            </div>

            <pdf-workspace
                    class="${this.mode === 'home' ? 'hidden' : ''}"
                    @toast=${(e: CustomEvent) => this.showToast(e.detail)}
                    @set-loading=${(e: CustomEvent) => {
                        this.isLoading = e.detail;
                        this.requestUpdate();
                    }}
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

        `;
    }

    clearAppCache() {
        if (confirm(i18n.t('confirmClear'))) {
            localStorage.clear();
            window.location.reload();
        }
    }
}