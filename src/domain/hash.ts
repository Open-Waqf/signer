export function extractHex64(input: string): string | null {
    const match = input.match(/(?:^|[^a-fA-F0-9])([a-fA-F0-9]{64})(?:[^a-fA-F0-9]|$)/);
    return match ? match[1].toLowerCase() : null;
}

export function normalizeHashInput(input: string): string {
    return input.replace(/[\s\n-]/g, '').trim().toLowerCase();
}

export function strictOrNormalizedHash(input: string): string {
    return extractHex64(input) || normalizeHashInput(input);
}

export function groupedHashPreview(hash: string): string {
    if (!hash) return '';
    return hash.match(/.{1,4}/g)?.join(' ') ?? hash;
}

