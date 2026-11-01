#!/usr/bin/env node
/**
 * run-android.mjs: build the app and open it on an Android device in one command.
 *
 *   npm run android:run     build, install and open the "Signer Dev" test app
 *
 * The test app has its own id (org.openwaqf.signer.dev), name and data, so it
 * installs next to the Play Store app without touching it.
 *
 * Device: your phone over USB (or Wi-Fi debugging), or an emulator.
 * If several are available, `cap run` asks which.
 * Extra args are passed to `cap run`, e.g. `npm run android:run -- --target <id>`.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, androidEnv, ensureGradlewExecutable} from './android-env.mjs';

const capArgs = process.argv.slice(2);
const env = androidEnv();

function run(cmd, args) {
    const r = spawnSync(cmd, args, {stdio: 'inherit', cwd: ROOT, env});
    if (r.status !== 0) {
        console.error(`\n✖ \`${cmd} ${args.join(' ')}\` failed`);
        process.exit(1);
    }
}

// Stop early with help if there is nothing to run on.
function checkDevices() {
    const adb = spawnSync('adb', ['devices'], {encoding: 'utf8', env});
    const devices = (adb.stdout || '').split('\n').filter((l) => /\tdevice$/.test(l));
    const avdDir = path.join(process.env.HOME || '', '.android/avd');
    const hasAvd = fs.existsSync(avdDir) && fs.readdirSync(avdDir).some((f) => f.endsWith('.ini'));
    if (devices.length || hasAvd) return;

    console.error('\n✖ No phone found. Plug in your phone with USB debugging on, then run again:');
    console.error('   1. Settings → About phone → tap "Build number" 7 times (turns on Developer options)');
    console.error('   2. Developer options → turn on "USB debugging"');
    console.error('   3. Plug in the cable and tap "Allow" on the phone');
    process.exit(1);
}

console.log('▶ Building web assets…');
run('npm', ['run', 'build']);
console.log('▶ Syncing Android project…');
run('npx', ['cap', 'sync', 'android']);
ensureGradlewExecutable();
checkDevices();
run('npx', ['cap', 'run', 'android', '--no-sync', ...capArgs]);
