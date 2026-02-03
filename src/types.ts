export type AnnotationType = 'signature' | 'initials' | 'date';

export interface Annotation {
    id: string;            // Unique ID to track items
    type: AnnotationType;
    page: number;          // Which page is this on? (0-index)
    xPct: number;          // 0.0 to 1.0 (Percentage of page width)
    yPct: number;          // 0.0 to 1.0 (Percentage of page height)
    widthPct: number;      // Width relative to page width
    data?: string;         // Base64 image or Text string
    aspectRatio?: number;  // height/width ratio (for images)
}