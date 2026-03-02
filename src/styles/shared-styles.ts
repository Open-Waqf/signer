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
        background: var(--bg-muted, #f3f4f6);
        border-color: #d1d5db;
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
        border: 1px solid #d1d5db;
        color: #4b5563;
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
        outline: 3px solid var(--primary, #2563eb);
        outline-offset: 2px;
    }

    /* Shared Modal Styles */

    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        backdrop-filter: blur(4px);
        padding: 12px;
        box-sizing: border-box;
    }

    .modal-card {
        background: var(--bg-surface, #ffffff);
        padding: clamp(16px, 3.5vw, 24px);
        border-radius: var(--radius-lg, 16px);
        box-shadow: var(--shadow-floating);
        width: 100%;
        max-width: 420px;
        max-height: min(92dvh, 760px);
        overflow-y: auto;
        text-align: left;
        box-sizing: border-box;
        animation: modalScale 0.2s ease-out;
    }

    @keyframes modalScale {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
    }

    .modal-card.center {
        text-align: center;
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
        color: #065f46;
        border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .alert-warning {
        background: var(--warning-bg, #fff7ed);
        color: #9a3412;
        border: 1px solid rgba(245, 158, 11, 0.2);
    }

    .alert-error {
        background: var(--danger-bg, #fee2e2);
        color: #991b1b;
        border: 1px solid rgba(239, 68, 68, 0.2);
    }

    @media (max-width: 480px) {
        .modal-overlay {
            padding: 8px;
        }

        .modal-card {
            border-radius: 12px;
        }
    }
`;
