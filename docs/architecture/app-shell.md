# App Shell Architecture

## Responsibilities
- Render the home and workspace shells.
- Route user interactions to feature controllers.
- Handle dialogs and top-level app state (`mode`, toasts, loading overlays).

## Controllers
- `IncomingFileController` handles native and PWA shared PDF intake.
- `VerifyController` handles verify-mode file analysis and hash comparison state.

## Contract
- `app-root` keeps existing template structure and `data-testid` values.
- `pdf-workspace` remains the child editor surface and receives file bytes through `loadPdf`.

