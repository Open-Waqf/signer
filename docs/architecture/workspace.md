# Workspace Architecture

## Responsibilities
- Manage editor UI state and annotation interactions.
- Orchestrate save/share flows through `pdfEngine` and `fileService`.
- Enforce handover checks and chain-preserving UX.

## State Boundaries
- Persistent user preferences are read/written via `preferences`.
- Hash and handover parsing utilities are centralized in `src/domain/`.
- Workspace logic is split into:
  - `features/workspace/history-store.ts`
  - `features/workspace/annotation-store.ts`
  - `features/workspace/handover-workflow.ts`

## Contract
- Emits unchanged events: `toast`, `set-loading`, `exit-workspace`.
- Keeps existing rendering/test IDs to avoid Playwright regressions.
