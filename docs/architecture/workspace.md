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
  - `features/workspace/save-workflow.ts`
  - `features/workspace/interaction-controller.ts` (pure drag/resize/snap geometry)
- Lit controllers attached to `pdf-workspace` (`components/controllers/`):
  - `history-controller.ts` (undo/redo)
  - `interaction-controller.ts` (pointer and keyboard interaction, uses the geometry above)
- Dialogs: `components/owq-modal.ts` (native `<dialog>`, with a bottom-sheet mode on phones) and
  `components/signature-modal.ts` (drawing pad and saved signatures).

## Contract
- Emits unchanged events: `toast`, `set-loading`, `exit-workspace`.
- Keeps existing rendering/test IDs to avoid Playwright regressions.
