import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

// --- Configuration ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_PATH = path.join(__dirname, 'src/i18n/locales.ts');
const SRC_PATH = path.join(__dirname, 'src');

console.log('🔍 Scanning for unused translations...');

// 1. Extract keys only from resources.en in locales.ts
const localesContent = fs.readFileSync(LOCALES_PATH, 'utf-8');

const definedKeys = new Set();
const enStart = localesContent.indexOf('en: {');
if (enStart === -1) {
    throw new Error('Could not find resources.en block in locales.ts');
}
const openBrace = localesContent.indexOf('{', enStart);
let depth = 0;
let endIndex = -1;
for (let i = openBrace; i < localesContent.length; i++) {
    const ch = localesContent[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) {
        endIndex = i;
        break;
    }
}
if (endIndex === -1) {
    throw new Error('Could not parse end of resources.en block in locales.ts');
}

const enContent = localesContent.slice(openBrace + 1, endIndex);
const keyRegex = /^\s*["']?([a-zA-Z0-9_]+)["']?:\s*['"`]/gm;
let match;
while ((match = keyRegex.exec(enContent)) !== null) {
    definedKeys.add(match[1]);
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

            // Match direct calls in app code and service-internal calls.
            const usageRegex = /(i18n|this)\.t\(\s*['"`](.*?)['"`]\s*\)/g;

            let usageMatch;
            while ((usageMatch = usageRegex.exec(content)) !== null) {
                usedKeys.add(usageMatch[2]);
            }

            // Match known dynamic key carriers (e.g. signature color label keys).
            const dynamicKeyRegex = /labelKey:\s*['"`](.*?)['"`]/g;
            let dynamicMatch;
            while ((dynamicMatch = dynamicKeyRegex.exec(content)) !== null) {
                usedKeys.add(dynamicMatch[1]);
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
