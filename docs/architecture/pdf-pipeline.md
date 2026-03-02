# PDF Pipeline Architecture

## Core Engine
- `pdfEngine` remains the public facade for loading, rendering, saving, metadata reads, and chain verification.

## Invariants
- Signature chain metadata prefix remains `OWQ_CHAIN:`.
- Audit marker prefix remains `OWQ_AUDIT_PAGE_V1:`.
- Save/verify chain semantics remain backward compatible with existing signed documents.

## Refactor Direction
- Keep the facade stable while extracting internal helpers into smaller modules over future slices.

