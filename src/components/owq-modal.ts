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
            flex-direction: column;
            /* Horizontally centre the card, but anchor it near the top so a modal
               whose content grows after opening (e.g. verify alerts) does not
               re-centre and jump under the reader. */
            align-items: center;
            justify-content: flex-start;
            /* Respect device safe areas (notch / home indicator) — the top-layer
               dialog lives outside <body>, so body safe-area padding never applies. */
            padding:
                max(8vh, env(safe-area-inset-top, 0px))
                max(var(--owq-modal-padding, 12px), env(safe-area-inset-right, 0px))
                max(var(--owq-modal-padding, 12px), env(safe-area-inset-bottom, 0px))
                max(var(--owq-modal-padding, 12px), env(safe-area-inset-left, 0px));
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
        // Fires for clicks on the ::backdrop / dialog element itself (the gutters
        // outside the 420px box on wide viewports).
        if (event.target !== this.dialogEl) return;
        if (this.closeOnBackdrop) this.dispatchClose();
    }

    private onShellClick(event: MouseEvent) {
        // On narrow viewports the shell fills the dialog, so backdrop clicks land
        // here (above/below the card) rather than on the dialog element. The card
        // stops propagation, so target===currentTarget means the empty area.
        if (event.target !== event.currentTarget) return;
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
        // Look in the card AND in the slotted light-DOM content — slotted nodes are
        // projected, not descendants of the card, so a card-only query misses an
        // [autofocus] that consumers put on their slotted content.
        const autofocus = (root.querySelector('[autofocus]')
            || this.querySelector('[autofocus]')) as HTMLElement | null;
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
                <div class="modal-shell" dir=${dir} @click=${this.onShellClick}>
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
