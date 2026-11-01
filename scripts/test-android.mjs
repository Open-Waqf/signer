#!/usr/bin/env node
/**
 * test-android.mjs: run the Maestro flows on your USB phone.
 *
 *   npm run test:android                 install the Signer Dev build, then run all flows
 *   npm run test:android -- --no-install run the flows on the Signer Dev already installed
 *   npm run test:android -- <flow.yaml>  run one flow instead of all
 *
 * The flows always target Signer Dev (org.openwaqf.signer.dev), never the Play Store
 * app, so your real saved signatures are never touched.
 * Keep the phone unlocked with the screen on while the flows run.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, androidEnv, requireDevice} from './android-env.mjs';

const APP_ID = 'org.openwaqf.signer.dev';
const args = process.argv.slice(2);
const noInstall = args.includes('--no-install');
const flow = args.find((a) => a.endsWith('.yaml')) || 'maestro/android/full-e2e.yaml';
const env = androidEnv();

function findMaestro() {
    const which = spawnSync('which', ['maestro'], {encoding: 'utf8'});
    if (which.status === 0) return which.stdout.trim();
    const home = path.join(process.env.HOME || '', '.maestro/bin/maestro');
    return fs.existsSync(home) ? home : null;
}

const maestro = findMaestro();
if (!maestro) {
    console.error('✖ Maestro is not installed. It drives the app on your phone for these tests.');
    console.error('  Install it once (needs Java 17+, which you already have for Android):');
    console.error('    curl -Ls "https://get.maestro.mobile.dev" | bash');
    console.error('  Then open a new terminal and run `npm run test:android` again.');
    process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, flow))) {
    console.error(`✖ Flow not found: ${flow}`);
    process.exit(1);
}
requireDevice(env);

if (!noInstall) {
    console.log('▶ Installing a fresh Signer Dev build on the phone…');
    const r = spawnSync('node', ['scripts/run-android.mjs'], {stdio: 'inherit', cwd: ROOT, env});
    if (r.status !== 0) {
        console.error('\n✖ Could not install Signer Dev (see above), so the flows were not run.');
        process.exit(1);
    }
}

console.log(`▶ Running ${flow} on Signer Dev (keep the phone unlocked)…`);
const r = spawnSync(maestro, ['test', '-e', `APP_ID=${APP_ID}`, flow], {stdio: 'inherit', cwd: ROOT, env});
if (r.status !== 0) {
    console.error('\n✖ Some Maestro flows failed (see above). Screenshots of failures are in ~/.maestro/tests/.');
    process.exit(1);
}
console.log('\n✓ All Maestro flows passed on the phone.');
