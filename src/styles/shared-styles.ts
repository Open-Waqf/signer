import {css} from 'lit';

export const sharedStyles = css`
    :host {
        --transition-fast: 0.15s ease;
        --transition-base: 0.2s ease;
    }

    .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 20px;
        min-height: 44px; /* ✨ Accessibility: Touch target */
        min-width: 44px;
        border-radius: var(--radius-md, 10px);
        font-weight: 600;
        font-size: 0.95rem;
        cursor: pointer;
        transition: var(--transition-fast);
        border: 1px solid var(--border, #e5e7eb);
        background: var(--bg-surface, #ffffff);
        color: var(--text-main, #1f2937);
        gap: 8px;
        font-family: inherit;
        user-select: none;
    }

    /* RTL Support */
    :host-context([dir="rtl"]) .mirror-rtl,
    :host([dir="rtl"]) .mirror-rtl,
    [dir="rtl"] .mirror-rtl {
        transform: scaleX(-1) !important;
    }

    .btn:hover:not(:disabled) {
        background: color-mix(in srgb, var(--bg-muted, #f3f4f6), #fff 30%);
        border-color: var(--border-strong, #d1d5db);
        transform: translateY(-1px);
    }

    .btn:active:not(:disabled) {
        transform: scale(0.97);
    }

    .btn-primary {
        background: var(--primary, #2563eb);
        color: white;
        border: none;
    }

    .btn-primary:hover:not(:disabled) {
        background: var(--primary-hover, #1d4ed8);
    }

    .btn-outline {
        background: transparent;
        border: 1px solid var(--border-strong, #d1d5db);
        color: var(--text-sub-strong, #4b5563);
    }

    .btn-danger {
        background: var(--danger-bg, #fee2e2);
        color: var(--danger, #ef4444);
        border: none;
    }

    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .btn:focus-visible {
        outline: 3px solid color-mix(in srgb, var(--primary, #2563eb), #fff 25%);
        outline-offset: 2px;
    }

    /* Shared Modal Styles */

    .modal-overlay {
        position: fixed;
        inset: 0;
        background: var(--owq-modal-backdrop, rgba(0, 0, 0, 0.4));
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: var(--owq-modal-z, 99999);
        backdrop-filter: blur(var(--owq-modal-blur, 4px));
        padding: var(--owq-modal-padding, 12px);
        box-sizing: border-box;
    }

    .modal-card {
        background: var(--bg-surface, #ffffff);
        padding: var(--owq-modal-content-padding, clamp(16px, 3.5vw, 24px));
        border-radius: var(--owq-modal-radius, var(--radius-lg, 16px));
        box-shadow: var(--shadow-floating);
        width: 100%;
        max-width: var(--owq-modal-max-width, 420px);
        max-height: var(--owq-modal-max-height, min(92dvh, 760px));
        overflow-y: auto;
        text-align: start;
        direction: inherit;
        box-sizing: border-box;
        animation: modalScale var(--owq-modal-animation-duration, 0.2s) ease-out;
    }

    @keyframes modalScale {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
    }

    .modal-card.center {
        text-align: center;
    }

    .modal-title {
        margin-top: 0;
        margin-bottom: 10px;
    }

    .modal-copy {
        color: var(--text-sub, #6b7280);
        font-size: 0.95rem;
        margin: 0 0 16px 0;
    }

    .modal-input-spaced {
        margin-bottom: 15px;
    }

    .modal-warning-copy {
        margin: 0 0 12px 0;
        color: var(--warning-text, #9a3412);
        font-size: 0.82rem;
        text-align: start;
    }

    .modal-icon-wrap {
        margin-bottom: 15px;
        display: flex;
        justify-content: center;
    }

    .modal-icon-badge {
        padding: 15px;
        border-radius: 50%;
    }

    .modal-icon-badge.success {
        color: var(--success, #10b981);
        background: var(--success-bg, #ecfdf5);
    }

    .modal-card-surface {
        background: var(--bg-app, #f7f4ee);
        padding: 15px;
        margin: 15px 0;
        border-radius: 8px;
        border: 1px solid var(--border, #e5e7eb);
        text-align: start;
    }

    .modal-section-title {
        font-size: 0.85rem;
        color: var(--text-main, #1f2937);
        font-weight: 700;
        margin: 8px 0 6px 0;
    }

    .modal-label {
        font-size: 0.8rem;
        color: var(--text-sub, #6b7280);
        font-weight: 600;
    }

    .modal-label.inline-icon {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .modal-value-mono {
        font-family: monospace;
        color: var(--text-main, #1f2937);
        border-radius: 6px;
        margin-top: 4px;
    }

    .modal-value-mono.hash {
        font-size: 0.75rem;
        word-break: break-all;
        background: var(--border, #e5e7eb);
        padding: 8px;
    }

    .modal-value-mono.id {
        font-size: 1.1rem;
        margin-bottom: 15px;
    }

    .modal-value-mono.code {
        font-size: 1.2rem;
        letter-spacing: 0.2rem;
        background: var(--bg-surface, #fff);
        padding: 8px;
    }

    .modal-actions-spaced {
        margin-bottom: 12px;
    }

    .modal-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
    }

    .modal-actions .btn {
        flex: 1 1 140px;
    }

    .modal-actions.center {
        justify-content: center;
    }

    .modal-btn-flex {
        flex: 1;
    }

    .modal-btn-full {
        flex: 1 1 100%;
    }

    .alert-box {
        padding: 12px 16px;
        border-radius: var(--radius-md, 10px);
        font-size: 0.9rem;
        margin-bottom: 16px;
        line-height: 1.5;
    }

    .alert-success {
        background: var(--success-bg, #ecfdf5);
        color: var(--success-text, #065f46);
        border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .alert-warning {
        background: var(--warning-bg, #fff7ed);
        color: var(--warning-text, #9a3412);
        border: 1px solid rgba(245, 158, 11, 0.2);
    }

    .alert-error {
        background: var(--danger-bg, #fee2e2);
        color: var(--danger-text, #991b1b);
        border: 1px solid rgba(239, 68, 68, 0.2);
    }

    @media (max-width: 480px) {
        .modal-overlay {
            padding: var(--owq-modal-padding-mobile, 8px);
        }

        .modal-card {
            border-radius: var(--owq-modal-radius-mobile, 12px);
        }
    }
`;
