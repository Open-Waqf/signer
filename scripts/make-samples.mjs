#!/usr/bin/env node
/**
 * make-samples.mjs: build the "Try with a sample PDF" file in every language.
 *
 *   node scripts/make-samples.mjs        writes public/sample_document.<lang>.pdf
 *
 * pdf-lib cannot shape Arabic, so each line is drawn by Chromium (Playwright) on a canvas,
 * with the app's own fonts, and placed in the PDF as a sharp image. Run it again after
 * changing the sampleDoc* texts in src/i18n/locales.ts, and commit the PDFs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(root, 'src/i18n/locales.ts'), 'utf8');

/** The sampleDoc* texts of one language block in locales.ts. */
function texts(lang) {
    const start = src.indexOf(`\n    ${lang}: {`);
    const block = src.slice(start, src.indexOf('\n    },', start));
    const get = (key) => JSON.parse(block.match(new RegExp(`\\n        ${key}: (".*?"),\\n`))[1]);
    return {title: get('sampleDocTitle'), lines: [get('sampleDocText1'), get('sampleDocText2')]};
}
const langs = [...src.matchAll(/\{code: '([a-z]{2})', label: .*?, dir: '(ltr|rtl)'\}/g)].map((m) => ({code: m[1], dir: m[2]}));

const font = (file) => `data:font/ttf;base64,${fs.readFileSync(path.join(root, 'public/fonts', file)).toString('base64')}`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<style>
  @font-face {font-family: Amiri; src: url(${font('Amiri-Regular.ttf')});}
  @font-face {font-family: Noto; src: url(${font('NotoSans-Regular.ttf')});}
</style><body>x</body>`);
await page.evaluate(() => Promise.all([document.fonts.load('40px Amiri'), document.fonts.load('40px Noto')]));

/** One line of text as a PNG (3x for sharpness): {png, width, height} in PDF points. */
const drawLine = (text, size, color, dir) => page.evaluate(({text, size, color, dir}) => {
    const scale = 3;
    const family = /[؀-ۿ]/.test(text) ? 'Amiri' : 'Noto';
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = `${size * scale}px ${family}`;
    const width = Math.ceil(ctx.measureText(text).width) + 4;
    const height = Math.ceil(size * scale * 1.6);
    c.width = width;
    c.height = height;
    ctx.font = `${size * scale}px ${family}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.direction = dir;
    ctx.textAlign = 'left';
    ctx.fillText(text, 2, height / 2);
    return {png: c.toDataURL('image/png'), width: width / scale, height: height / scale};
}, {text, size, color, dir});

for (const {code, dir} of langs) {
    const {title, lines} = texts(code);
    const doc = await PDFDocument.create();
    doc.setTitle(title);
    const pdfPage = doc.addPage([595.28, 841.89]);
    const margin = 50;
    const place = async (text, size, color, top) => {
        const line = await drawLine(text, size, color, dir);
        const image = await doc.embedPng(line.png);
        const x = dir === 'rtl' ? 595.28 - margin - line.width : margin;
        pdfPage.drawImage(image, {x, y: 841.89 - top - line.height, width: line.width, height: line.height});
    };
    await place(title, 24, '#0054b5', 70);
    await place(lines[0], 12, '#000000', 130);
    await place(lines[1], 12, '#000000', 152);
    const out = path.join(root, 'public', `sample_document.${code}.pdf`);
    fs.writeFileSync(out, await doc.save());
    console.log(`✓ ${path.relative(root, out)}`);
}
await browser.close();
