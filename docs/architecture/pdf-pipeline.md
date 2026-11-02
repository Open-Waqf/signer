# PDF Pipeline Architecture

## Core Engine
- `pdfEngine` remains the public facade for loading, rendering, saving, metadata reads, and chain verification.
- Internal PDF modules:
  - `lib/pdf/hash-service.ts`
  - `lib/pdf/metadata-service.ts`
  - `lib/pdf/audit-page-service.ts`
  - `lib/pdf/signature-chain-service.ts` (signer history consistency, information only)
  - `lib/pdf/cms-signature-service.ts` (certificate signing; its heavy libraries load only when used)
  - `lib/pdf/hash.worker.ts` (hashing and normalization off the main thread)
  - `lib/pdf/constants.ts`

## pdf.js assets
- `public/cmaps/`, `public/standard_fonts/` and `public/wasm/` (JBIG2/CCITT decoder) are copied from
  `node_modules/pdfjs-dist/` and must match its version. Without `wasm/`, scanned pages render blank.
- Close a pdf.js document with `doc.loadingTask.destroy()` (pdf.js 6 removed `doc.destroy()`).

## Invariants
- Signature chain metadata prefix remains `OWQ_CHAIN:`.
- Audit marker prefix remains `OWQ_AUDIT_PAGE_V1:`.
- Save/verify chain semantics remain backward compatible with existing signed documents.

## Refactor Direction
- Keep the facade stable while extracting internal helpers into smaller modules over future slices.
