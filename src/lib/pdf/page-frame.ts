// page-frame.ts: the page as a reader shows it, for drawing on existing pages.
//
// Readers (and the editor, through pdf.js) show only the CropBox, turned by /Rotate.
// Items are placed on that shown page, but pdf-lib draws in the page's own coordinates
// (unturned, from the MediaBox origin). Without this conversion an item on a scanned page
// (often turned 90 degrees) or a cropped page landed elsewhere and sideways (step 4).
import {degrees, type PDFPage} from 'pdf-lib';

export type PageFrame = {
    /** Width and height of the page as shown. */
    width: number;
    height: number;
    /** Pass to pdf-lib's drawImage/drawText so the item is shown upright. */
    rotate: ReturnType<typeof degrees>;
    /** A point on the shown page (from its bottom-left, y up) in the page's own coordinates. */
    toPage(u: number, v: number): {x: number; y: number};
};

export function shownFrame(page: PDFPage): PageFrame {
    const {x: cx, y: cy, width: cw, height: ch} = page.getCropBox(); // MediaBox when there is no CropBox
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    const turn = angle === 90 || angle === 180 || angle === 270 ? angle : 0;
    const sideways = turn === 90 || turn === 270;
    return {
        width: sideways ? ch : cw,
        height: sideways ? cw : ch,
        rotate: degrees(turn),
        toPage(u, v) {
            switch (turn) {
                case 90: return {x: cx + cw - v, y: cy + u};
                case 180: return {x: cx + cw - u, y: cy + ch - v};
                case 270: return {x: cx + v, y: cy + ch - u};
                default: return {x: cx + u, y: cy + v};
            }
        },
    };
}
