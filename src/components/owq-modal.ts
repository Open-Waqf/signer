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

    @query('.modal-card') card!: HTMLDivElement;

    static styles = [sharedStyles, css`
        :host {
            position: fixed;
            inset: 0;
            z-index: 99999;
        }

        :host(:not([open])) {
            display: none;
        }
    `];

    updated(changed: Map<string, unknown>) {
        if (changed.has('open') && this.open) {
            queueMicrotask(() => this.focusFirstElement());
        }
    }

    private dispatchClose() {
        this.dispatchEvent(new CustomEvent('modal-close', {bubbles: true, composed: true}));
    }

    private onBackdropClick() {
        if (this.closeOnBackdrop) this.dispatchClose();
    }

    private onKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape' && this.closeOnEsc) {
            e.preventDefault();
            this.dispatchClose();
            return;
        }
        if (e.key === 'Tab') this.trapTab(e);
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

    private trapTab(e: KeyboardEvent) {
        const focusables = this.getFocusableElements();
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = (this.shadowRoot?.activeElement || document.activeElement) as HTMLElement | null;

        if (e.shiftKey && active === first) {
            e.preventDefault();
            last.focus();
            return;
        }
        if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
        }
    }

    render() {
        if (!this.open) return html``;
        const dir = document.documentElement.dir || 'ltr';
        return html`
            <div class="modal-overlay" dir=${dir} @click=${this.onBackdropClick} @keydown=${this.onKeydown}>
                <div class="modal-card ${this.center ? 'center' : ''}" role="dialog" aria-modal="true"
                     dir=${dir}
                     aria-label=${this.ariaLabel || nothing} aria-labelledby=${this.ariaLabelledby || nothing}
                     @click=${(e: Event) => e.stopPropagation()}>
                    <slot></slot>
                </div>
            </div>
        `;
    }
}
