import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

// --- Configuration ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_PATH = path.join(__dirname, 'src/i18n/locales.ts');
const SRC_PATH = path.join(__dirname, 'src');

console.log('🔍 Scanning for unused translations...');

// 1. Extract Keys from src/lib/locales.ts
const localesContent = fs.readFileSync(LOCALES_PATH, 'utf-8');

const definedKeys = new Set();

// 🟢 FIX: Improved Regex
// Instead of trying to find the "en" block (which breaks on nested braces),
// we look for any line that starts with a key definition.
// Matches:   myKey: "value"   OR   'myKey': 'value'
// It ignores the "en:" and "ar:" labels because they usually don't have quotes around the value part immediately.
const keyRegex = /^\s*["']?([a-zA-Z0-9_]+)["']?:\s*['"`]/gm;

let match;
while ((match = keyRegex.exec(localesContent)) !== null) {
    const key = match[1];
    // Ignore top-level language keys like 'en', 'ar', 'fr'
    if (['en', 'ar', 'fr', 'es'].includes(key)) continue;
    definedKeys.add(key);
}

console.log(`✅ Found ${definedKeys.size} defined keys in locales.ts`);

// 2. Scan Source Files for Usage
const usedKeys = new Set();

function scanDir(directory) {
    const files = fs.readdirSync(directory);

    for (const file of files) {
        const fullPath = path.join(directory, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            scanDir(fullPath);
        } else if (file.endsWith('.ts')) {
            const content = fs.readFileSync(fullPath, 'utf-8');

            // 🟢 FIX: Handle both single and double quotes in i18n.t()
            // Matches: i18n.t('key')  OR  i18n.t("key")
            const usageRegex = /i18n\.t\(\s*['"`](.*?)['"`]\s*\)/g;

            let usageMatch;
            while ((usageMatch = usageRegex.exec(content)) !== null) {
                usedKeys.add(usageMatch[1]);
            }
        }
    }
}

scanDir(SRC_PATH);
console.log(`✅ Found ${usedKeys.size} unique keys used in code`);

// 3. Compare and Report
const unusedKeys = [...definedKeys].filter(key => !usedKeys.has(key));

if (unusedKeys.length === 0) {
    console.log('\n🎉 Great job! No unused translations found.');
} else {
    console.log('\n⚠️  Found Unused Keys:');
    unusedKeys.forEach(key => console.log(`   - ${key}`));
    console.log(`\nTotal: ${unusedKeys.length} unused keys.`);
}