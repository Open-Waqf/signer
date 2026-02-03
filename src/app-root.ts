import {html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {fileService} from './lib/file-service';
import {i18n} from './lib/i18n-service';
import './components/pdf-workspace';

@customElement('app-root')
export class AppRoot extends LitElement {
    @state() mode: 'home' | 'workspace' = 'home';
    @state() isLoading = false; // New Loading State

    @query('pdf-workspace') workspace: any;
    @query('dialog') privacyDialog!: HTMLDialogElement;

    createRenderRoot() {
        return this;
    }

    connectedCallback() {
        super.connectedCallback();
        // Listen for language changes and re-render
        window.addEventListener('lang-changed', () => this.requestUpdate());
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('lang-changed', () => this.requestUpdate());
    }

    async handleFile(data: Uint8Array, name: string) {
        // 1. Show Loader immediately
        this.isLoading = true;
        this.requestUpdate(); // Force UI update

        // 2. Small delay to let the UI render the spinner before blocking CPU
        await new Promise(r => setTimeout(r, 50));

        try {
            this.mode = 'workspace';
            // Wait for the workspace component to exist in DOM
            await this.updateComplete;

            if (this.workspace) {
                await this.workspace.loadPdf(data, name);
            }
        } catch (e) {
            console.error(e);
            alert('Error loading PDF');
            this.mode = 'home';
        } finally {
            // 3. Hide Loader
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
                    <div>Loading Document...</div>
                </div>
            ` : ''}

            <div class="drop-zone ${this.mode === 'workspace' ? 'hidden' : ''}"
                 @dragover=${(e: DragEvent) => {
                     e.preventDefault();
                     // Optional: Add visual feedback class here if desired
                 }}
                 @drop=${this.handleDrop}>

                <div style="position: absolute; top: 20px; right: 20px;">
                    <button @click=${() => i18n.cycleNext()}
                            style="background: transparent; color: var(--text-sub); border: 1px solid var(--border); padding: 6px 12px; box-shadow:none;">
                        🌐 ${i18n.getCurrentLabel()}
                    </button>
                </div>

                <div class="drop-card">
                    <img src="/icons/icon-192.webp" alt="Open Waqf" onerror="this.style.display='none'"/>

                    <h1>${i18n.t('appTitle')}</h1>
                    <p class="sub">Secure. Offline. Free.</p>

                    <div class="drop-area-visual">
                        <button @click=${this.openFile}>Select PDF File</button>
                        <p class="sub" style="margin: 12px 0 0 0; font-size: 0.85rem;">or drag and drop here</p>
                    </div>

                    <a href="#" class="footer-link" @click=${(e: Event) => {
                        e.preventDefault();
                        this.showPrivacy();
                    }}>
                        ${i18n.t('privacyTitle')}
                    </a>
                </div>
            </div>

            <pdf-workspace class="${this.mode === 'home' ? 'hidden' : ''}"></pdf-workspace>

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