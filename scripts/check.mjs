#!/usr/bin/env node
/**
 * check.mjs: everything to run before a commit, in one command.
 *
 *   npm run check
 *
 * Runs, in order, and stops at the first failure:
 *   1. typecheck     (tsc --noEmit)
 *   2. translations  (check-i18n.js)
 *   3. tests         (Playwright, all of them)
 * The fast checks run first, so a typo fails in seconds, not after the test suite.
 */
import {spawnSync} from 'node:child_process';

const steps = [
    {name: 'Typecheck', cmd: 'npx', args: ['tsc', '--noEmit'], hint: 'Fix the TypeScript errors above.'},
    {name: 'Translations', cmd: 'node', args: ['check-i18n.js'], hint: 'Fix src/i18n/locales.ts as listed above.'},
    {name: 'Tests', cmd: 'npx', args: ['playwright', 'test'], hint: 'See the failing tests above. `npx playwright show-report` opens the details.'},
];

const started = Date.now();
for (const [i, step] of steps.entries()) {
    console.log(`\n▶ ${i + 1}/${steps.length} ${step.name}…`);
    const r = spawnSync(step.cmd, step.args, {stdio: 'inherit'});
    if (r.status !== 0) {
        console.error(`\n✖ ${step.name} failed. ${step.hint}`);
        const skipped = steps.slice(i + 1).map((s) => s.name.toLowerCase());
        if (skipped.length) console.error(`  Not run yet: ${skipped.join(', ')}.`);
        console.error('  Fix it, then run `npm run check` again.');
        process.exit(1);
    }
}
console.log(`\n✓ All checks passed in ${Math.round((Date.now() - started) / 1000)} s. Safe to commit.`);
