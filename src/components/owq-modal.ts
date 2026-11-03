import {css, html, LitElement, nothing} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';
import {sharedStyles} from '../styles/shared-styles';

@customElement('owq-modal')
export class OwqModal extends LitElement {
    @property({type: Boolean, reflect: true}) open = false;
    @property({type: Boolean}) center = false;
    /** On phones, dock the card to the bottom of the screen like a native sheet. */
    @property({type: Boolean, reflect: true}) sheet = false;
    /** Near the top instead of centred: for dialogs whose content grows while open (Verify). */
    @property({type: Boolean, reflect: true}) top = false;
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
            /* Centred. The bottom padding grows by the height of the phone keyboard
               (--owq-keyboard, set while open), so the card moves up above the keyboard.
               The card scrolls inside itself when it is taller than the space. */
            align-items: center;
            justify-content: center;
            /* Respect device safe areas (notch / home indicator) — the top-layer
               dialog lives outside <body>, so body safe-area padding never applies. */
            padding:
                max(var(--owq-modal-padding, 12px), env(safe-area-inset-top, 0px))
                max(var(--owq-modal-padding, 12px), env(safe-area-inset-right, 0px))
                calc(max(var(--owq-modal-padding, 12px), env(safe-area-inset-bottom, 0px)) + var(--owq-keyboard, 0px))
                max(var(--owq-modal-padding, 12px), env(safe-area-inset-left, 0px));
            box-sizing: border-box;
        }

        /* Dialogs whose content grows after opening (Verify results) stay near the top,
           so they do not re-centre and jump under the reader. */
        :host([top]) .modal-shell {
            justify-content: flex-start;
            padding-top: max(8vh, env(safe-area-inset-top, 0px));
        }

        :host .modal-card {
            max-height: calc(100dvh - 24px - var(--owq-keyboard, 0px));
        }

        /* Bottom sheet on phones: the card sits on the bottom edge, under the thumb. */
        @media (max-width: 768px) {
            :host([sheet]) dialog {
                width: 100%;
                max-width: 100%;
            }

            :host([sheet]) .modal-shell {
                justify-content: flex-end;
                padding: 0;
            }

            :host([sheet]) .modal-card {
                max-width: 100%;
                border-radius: var(--radius-lg, 16px) var(--radius-lg, 16px) 0 0;
                padding-bottom: calc(max(env(safe-area-inset-bottom, 0px), 12px) + 12px);
                animation-name: sheetUp;
            }
        }

        @keyframes sheetUp {
            from { transform: translateY(24px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `];

    firstUpdated() {
        this.syncDialogState();
    }

    // The phone keyboard: when it covers part of the screen (the visual viewport is
    // smaller than the window), lift the card above it. Where the system instead shrinks
    // the whole window, this stays 0 and the centring follows the smaller window.
    private onViewportChange = () => {
        const vv = window.visualViewport;
        const covered = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
        this.style.setProperty('--owq-keyboard', `${Math.round(covered)}px`);
    };

    private watchKeyboard(on: boolean) {
        const vv = window.visualViewport;
        if (!vv) return;
        if (on) {
            vv.addEventListener('resize', this.onViewportChange);
            vv.addEventListener('scroll', this.onViewportChange);
            this.onViewportChange();
        } else {
            vv.removeEventListener('resize', this.onViewportChange);
            vv.removeEventListener('scroll', this.onViewportChange);
            this.style.removeProperty('--owq-keyboard');
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.watchKeyboard(false);
    }

    updated(changed: Map<string, unknown>) {
        if (changed.has('open')) {
            this.syncDialogState();
            this.watchKeyboard(this.open);
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
