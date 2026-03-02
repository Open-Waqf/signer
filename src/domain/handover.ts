export function extractPin6(input: string): string | null {
    const all = input.match(/\d{6}/g);
    if (!all || all.length === 0) return null;
    return all[all.length - 1];
}

