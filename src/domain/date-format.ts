// date-format.ts: the signing date in three formats (step 5).
// Uses the calendars built into the browser and phone (Intl), so no extra library.

export type DateFormat = 'numeric' | 'long' | 'hijri';

export const DATE_FORMATS: DateFormat[] = ['numeric', 'long', 'hijri'];

export const isDateFormat = (value: unknown): value is DateFormat =>
    value === 'numeric' || value === 'long' || value === 'hijri';

// English uses the day-first British order ("3 November 2026"), like the numeric date.
const locale = (lang: string) => (lang === 'en' ? 'en-GB' : lang);

/**
 * numeric: 03/11/2026 (day first, Latin digits, kept left-to-right in Arabic text)
 * long:    3 November 2026 / 3 novembre 2026 / 3 نوفمبر 2026
 * hijri:   23 Jumada I 1448 AH / 23 جمادى الأولى 1448 هـ
 *          Umm al-Qura calendar: it can differ by a day from a local moon sighting
 *          (Morocco), so the text stays editable.
 */
export function formatSigningDate(date: Date, lang: string, format: DateFormat): string {
    if (format === 'long' || format === 'hijri') {
        const calendar = format === 'hijri' ? '-u-ca-islamic-umalqura' : '';
        try {
            return new Intl.DateTimeFormat(`${locale(lang)}${calendar}`, {
                day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn',
            }).format(date);
        } catch {
            // An old browser without this calendar: fall back to the numeric date.
        }
    }
    const parts = new Intl.DateTimeFormat(lang, {
        day: '2-digit', month: '2-digit', year: 'numeric', numberingSystem: 'latn',
    }).formatToParts(date);
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const year = parts.find((p) => p.type === 'year')?.value ?? '';
    const lrm = '‎';
    return day && month && year
        ? `${lrm}${day}/${month}/${year}${lrm}`
        : new Intl.DateTimeFormat('en-GB', {day: '2-digit', month: '2-digit', year: 'numeric'}).format(date);
}
