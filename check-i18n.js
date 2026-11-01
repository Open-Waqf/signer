// check-i18n.js: make sure every language has every text, and nothing is unused.
//
//   npm run check-i18n
//
// It reads the real `resources` object from src/i18n/locales.ts (compiled in memory with
// the TypeScript package we already have), then checks:
//   1. every language has exactly the same keys as English (no missing, no extra)
//   2. no text is empty
//   3. placeholders such as {count} are the same in every language
//   4. every key used in src/ exists, and every key that exists is used
// Exits with code 1 and a plain-English list when something is wrong.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_PATH = path.join(ROOT, 'src/i18n/locales.ts');
const SRC_PATH = path.join(ROOT, 'src');

async function loadResources() {
    const source = fs.readFileSync(LOCALES_PATH, 'utf8');
    const js = ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
    }).outputText;
    const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
    if (!mod.resources || !mod.resources.en) {
        throw new Error('src/i18n/locales.ts must export `resources` with an `en` block.');
    }
    return mod.resources;
}

function findUsedKeys(directory, used = new Set()) {
    for (const file of fs.readdirSync(directory)) {
        const fullPath = path.join(directory, file);
        if (fs.statSync(fullPath).isDirectory()) {
            findUsedKeys(fullPath, used);
        } else if (file.endsWith('.ts')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            // Direct calls: i18n.t('key') and this.t('key') inside the service.
            for (const m of content.matchAll(/(i18n|this)\.t\(\s*['"`](.*?)['"`]\s*\)/g)) used.add(m[2]);
            // Keys passed around as data, e.g. {labelKey: 'inkBlue'}.
            for (const m of content.matchAll(/labelKey:\s*['"`](.*?)['"`]/g)) used.add(m[1]);
        }
    }
    return used;
}

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const resources = await loadResources();
const en = resources.en;
const enKeys = Object.keys(en);
const problems = [];

for (const [lang, texts] of Object.entries(resources)) {
    const keys = Object.keys(texts);
    for (const key of enKeys.filter((k) => !keys.includes(k))) problems.push(`${lang}: missing "${key}"`);
    for (const key of keys.filter((k) => !enKeys.includes(k))) problems.push(`${lang}: "${key}" is not in English (typo or leftover?)`);
    for (const key of keys) {
        if (String(texts[key]).trim() === '') problems.push(`${lang}: "${key}" is empty`);
        if (lang !== 'en' && key in en && placeholders(texts[key]) !== placeholders(en[key])) {
            problems.push(`${lang}: "${key}" has placeholders {${placeholders(texts[key])}} but English has {${placeholders(en[key])}}`);
        }
    }
}

const used = findUsedKeys(SRC_PATH);
for (const key of [...used].filter((k) => !enKeys.includes(k))) problems.push(`code uses "${key}" but it is not defined in locales.ts`);
for (const key of enKeys.filter((k) => !used.has(k))) problems.push(`"${key}" is defined but never used (remove it, or use it)`);

const langs = Object.keys(resources).join(', ');
if (problems.length) {
    console.error(`✖ Translations have ${problems.length} problem(s):`);
    for (const p of problems) console.error(`   - ${p}`);
    console.error('\nFix these in src/i18n/locales.ts, then run `npm run check-i18n` again.');
    process.exit(1);
}
console.log(`✓ Translations OK: ${enKeys.length} keys, complete in ${langs}, all used.`);
