import {css, html, LitElement, nothing} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';
import {sharedStyles} from '../styles/shared-styles';

@customElement('owq-modal')
export class OwqModal extends LitElement {
    @property({type: Boolean, reflect: true}) open = false;
    @property({type: Boolean}) center = false;
    @property({type: Boolean}) closeOnBackdrop = true;
    @property({type: Boolean}) closeOnEsc = true;
    @property({type: String}) ariaLabel = '';
    @property({type: String}) ariaLabelledby = '';

    @query('dialog') dialogEl!: HTMLDialogElement;
    @query('.modal-card') card!: HTMLDivElement;

    static styles = [sharedStyles, css`
        :host {
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: none;
        }

        :host([open]) {
            display: block;
        }

        dialog {
            border: none;
            padding: 0;
            margin: auto;
            width: min(100%, var(--owq-modal-max-width, 420px));
            max-width: var(--owq-modal-max-width, 420px);
            max-height: none;
            background: transparent;
            color: inherit;
            overflow: visible;
            box-sizing: border-box;
        }

        dialog:focus-visible {
            outline: none;
        }

        dialog::backdrop {
            background: var(--owq-modal-backdrop, rgba(0, 0, 0, 0.4));
            backdrop-filter: blur(var(--owq-modal-blur, 4px));
            -webkit-backdrop-filter: blur(var(--owq-modal-blur, 4px));
        }

        .modal-shell {
            min-height: 100dvh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--owq-modal-padding, 12px);
            box-sizing: border-box;
        }
    `];

    firstUpdated() {
        this.syncDialogState();
    }

    updated(changed: Map<string, unknown>) {
        if (changed.has('open')) {
            this.syncDialogState();
        }
        if (changed.has('open') && this.open) {
            queueMicrotask(() => this.focusFirstElement());
        }
    }

    private dispatchClose() {
        this.dispatchEvent(new CustomEvent('modal-close', {bubbles: true, composed: true}));
    }

    private syncDialogState() {
        if (!this.dialogEl) return;

        if (this.open) {
            if (!this.dialogEl.open) {
                try {
                    this.dialogEl.showModal();
                } catch {
                    this.dialogEl.setAttribute('open', '');
                }
            }
            return;
        }

        if (this.dialogEl.open) {
            this.dialogEl.close();
        } else {
            this.dialogEl.removeAttribute('open');
        }
    }

    private onBackdropClick(event: MouseEvent) {
        if (event.target !== this.dialogEl) return;
        if (this.closeOnBackdrop) this.dispatchClose();
    }

    private onCancel(e: Event) {
        // Keep state in Lit as the single source of truth.
        e.preventDefault();
        if (this.closeOnEsc) {
            this.dispatchClose();
        }
    }

    private focusFirstElement() {
        const root = this.card || (this.renderRoot as ShadowRoot);
        const autofocus = root.querySelector('[autofocus]') as HTMLElement | null;
        if (autofocus) {
            autofocus.focus();
            return;
        }
        const first = this.getFocusableElements()[0];
        first?.focus();
    }

    private getFocusableElements(): HTMLElement[] {
        const nodes = Array.from(this.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ));
        return nodes.filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
    }

    render() {
        const dir = document.documentElement.dir || 'ltr';
        return html`
            <dialog
                aria-label=${this.ariaLabel || nothing}
                aria-labelledby=${this.ariaLabelledby || nothing}
                @click=${this.onBackdropClick}
                @cancel=${this.onCancel}
            >
                <div class="modal-shell" dir=${dir}>
                    <div class="modal-card ${this.center ? 'center' : ''}" role="dialog" aria-modal="true"
                         dir=${dir}
                         @click=${(e: Event) => e.stopPropagation()}>
                        <slot></slot>
                    </div>
                </div>
            </dialog>
        `;
    }
}
