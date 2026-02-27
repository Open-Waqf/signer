import {css} from 'lit';

export const sharedStyles = css`
    .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 20px;
        border-radius: 8px;
        font-weight: 600;
        font-size: 0.95rem;
        cursor: pointer;
        transition: all 0.2s ease;
        border: 1px solid var(--border, #e5e7eb);
        background: white;
        color: var(--text-main, #1f2937);
        gap: 8px;
        font-family: inherit;
    }

    .btn:hover:not(:disabled) {
        background: #f9fafb;
        transform: translateY(-1px);
    }

    .btn:active:not(:disabled) {
        transform: translateY(0);
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
        background: #fee2e2;
        color: #b91c1c;
        border: none;
    }

    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* Shared Modal Styles */

    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        backdrop-filter: blur(2px);
    }

    .modal-card {
        background: white;
        padding: 24px;
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        width: 90%;
        max-width: 480px;
        text-align: left;
    }

    .modal-card.center {
        text-align: center;
    }

    .alert-box {
        padding: 12px;
        border-radius: 8px;
        font-size: 0.85rem;
        margin-bottom: 15px;
    }

    .alert-success {
        background: #dcfce7;
        color: #166534;
        border: 1px solid #bbf7d0;
    }

    .alert-warning {
        background: #fffbeb;
        color: #b45309;
        border: 1px solid #fde68a;
    }

    .alert-error {
        background: #fee2e2;
        color: #991b1b;
        border: 1px solid #fecaca;
    }
`;