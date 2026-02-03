import {html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {App} from '@capacitor/app'; // For Native Back Button
import {fileService} from './lib/file-service';
import {i18n} from './lib/i18n-service';
import packageJson from '../package.json'; // Displays Version v1.0.0
import './components/pdf-workspace';

@customElement('app-root')
export class AppRoot extends LitElement {
    @state() mode: 'home' | 'workspace' = 'home';
    @state() isLoading = false;
    @state() toastMsg: string | null = null; // Toast State

    @query('pdf-workspace') workspace: any;
    @query('dialog') privacyDialog!: HTMLDialogElement;

    // Disable Shadow DOM so global styles apply easily
    createRenderRoot() {
        return this;
    }

    connectedCallback() {
        super.connectedCallback();

        // 1. Listen for Language Changes
        window.addEventListener('lang-changed', () => this.requestUpdate());

        // 2. Handle Native Android Back Button
        App.addListener('backButton', () => {
            // Priority 1: Close Privacy Modal if open
            if (this.privacyDialog && this.privacyDialog.open) {
                this.closePrivacy();
                return;
            }

            // Priority 2: If inside Workspace, ask to exit
            if (this.mode === 'workspace') {
                if (confirm(i18n.t('exitConfirm'))) {
                    this.mode = 'home';
                }
                return;
            }

            // Priority 3: Exit App
            App.exitApp();
        });
    }

    // --- TOAST SYSTEM ---
    showToast(msg: string) {
        this.toastMsg = msg;
        // Auto-hide after 3 seconds
        setTimeout(() => {
            this.toastMsg = null;
        }, 3000);
    }

    // --- FILE HANDLING ---
    async handleFile(data: Uint8Array, name: string) {
        this.isLoading = true;
        this.requestUpdate();

        // Small delay to let UI render the spinner
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
            // User cancelled selection
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

    // --- PRIVACY MODAL ---
    showPrivacy() {
        this.privacyDialog.showModal();
    }

    closePrivacy() {
        this.privacyDialog.close();
    }

    // --- RENDER ---
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
                    <button @click=${() => i18n.cycleNext()} class="lang-switcher">
                        🌐 ${i18n.getCurrentLabel()}
                    </button>
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
                </div>
            </div>

            <pdf-workspace class="${this.mode === 'home' ? 'hidden' : ''}"
                           @toast=${(e: CustomEvent) => this.showToast(e.detail)}>
            </pdf-workspace>

            <dialog>
                <div class="dialog-content">
                    <h2>${i18n.t('privacyTitle')}</h2>
                    <p>${i18n.t('privacyContent')}</p>
                </div>
                <div class="dialog-footer">
                    <button @click=${this.closePrivacy}>${i18n.t('close')}</button>
                </div>
            </dialog>
        `;
    }
}