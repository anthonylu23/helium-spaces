// Headless smoke test for a helium-spaces dev build.
// Usage: node --experimental-websocket devutils/spaces_smoke.mjs [path/to/Helium.app]
//        (the flag is only needed on Node 20/21)
// Launches the build with throwaway profiles and checks it over the DevTools
// protocol and the profile's Preferences file:
//   1. Flag off: the helium-spaces flag is registered and off by default, and
//      no spaces are written.
//   2. Flag on: the profile gets exactly one default space.
//   3. Flag on, same profile: the default space keeps its id.
// Needs a global WebSocket: Node 22+, or Node 20.10+ with --experimental-websocket.
// Exits non-zero on any failed check.

if (typeof WebSocket === 'undefined') {
  console.error('No global WebSocket. Use Node 22+, or run with --experimental-websocket.');
  process.exit(2);
}

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const app = resolve(process.argv[2] ?? 'build/src/out/Default/Helium.app');
const binary = join(app, 'Contents/MacOS/Helium');
const profiles = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

function newProfile() {
  const dir = mkdtempSync(join(tmpdir(), 'spaces-smoke-'));
  profiles.push(dir);
  return dir;
}

async function devtoolsTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('browser did not expose a DevTools page target');
}

function session(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => {
    await ready;
    const msgId = ++id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((r) => pending.set(msgId, r));
  };
  return { send, close: () => ws.close() };
}

// Starts the browser on `profile` and returns a DevTools session for its page,
// plus close(), which shuts down cleanly so prefs get written to disk.
async function launch(profile, extraArgs = []) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const browser = spawn(binary, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--use-mock-keychain',
    '--no-first-run',
    ...extraArgs,
    'about:blank',
  ], { stdio: 'ignore' });
  const exited = new Promise((r) => browser.once('exit', r));
  try {
    const cdp = session((await devtoolsTarget(port)).webSocketDebuggerUrl);
    const close = async () => {
      // Browser.close shuts down gracefully; never answers, so don't await it.
      cdp.send('Browser.close');
      const timedOut = await Promise.race([exited.then(() => false), sleep(15000).then(() => true)]);
      if (timedOut) browser.kill('SIGKILL');
      cdp.close();
    };
    return { cdp, close };
  } catch (err) {
    browser.kill('SIGKILL');
    throw err;
  }
}

// The profile's saved spaces, or undefined if none were written.
function savedSpaces(profile) {
  const file = join(profile, 'Default', 'Preferences');
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')).helium_spaces?.spaces;
}

// Finds the <flags-experiment> for `internalName` in chrome://flags (piercing
// shadow roots) and returns {text, selected} as JSON, or null. The element
// renders inside its own shadow root, so read text from there.
const findFlag = (internalName) => `(() => {
  const walk = (root) => {
    const hit = root.querySelector('flags-experiment#${internalName}');
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) { const r = walk(el.shadowRoot); if (r) return r; }
    }
    return null;
  };
  const el = walk(document);
  if (!el) return null;
  const root = el.shadowRoot ?? el;
  const select = root.querySelector('select');
  return JSON.stringify({
    text: root.textContent.replace(/\\s+/g, ' ').trim(),
    selected: select?.selectedOptions[0]?.textContent.trim() ?? null,
  });
})()`;

async function checkFlagOff() {
  const profile = newProfile();
  const { cdp, close } = await launch(profile);

  const version = await cdp.send('Browser.getVersion');
  const product = version.result?.product ?? '';
  check('browser starts and reports a version', product.length > 0, product);

  await cdp.send('Page.navigate', { url: 'chrome://flags/#helium-spaces' });
  let flag = null;
  for (let i = 0; i < 20 && !flag; i++) {
    await sleep(500);
    const r = await cdp.send('Runtime.evaluate', { expression: findFlag('helium-spaces'), returnByValue: true });
    const value = r.result?.result?.value;
    flag = value ? JSON.parse(value) : null;
  }
  check('chrome://flags lists #helium-spaces', !!flag, flag?.text.slice(0, 100));
  check('flag is titled "Helium Spaces"', !!flag && flag.text.includes('Helium Spaces'));
  // Helium labels the default choice with the feature's default state.
  check('flag is off by default on a fresh profile', flag?.selected === 'Default (Disabled)', `selected: ${flag?.selected}`);

  await close();
  check('flag off: no spaces are saved', savedSpaces(profile) === undefined);
}

async function checkDefaultSpace() {
  const profile = newProfile();
  const enable = ['--enable-features=HeliumSpaces'];

  await (await launch(profile, enable)).close();
  const first = savedSpaces(profile) ?? [];
  const defaults = first.filter((s) => s.default);
  check('flag on: profile gets exactly one space, the default', first.length === 1 && defaults.length === 1,
        JSON.stringify(first));

  await (await launch(profile, enable)).close();
  const second = savedSpaces(profile) ?? [];
  check('default space keeps its id across a restart',
        defaults.length === 1 && second.length === 1 && second[0].id === defaults[0].id,
        `${defaults[0]?.id} -> ${second[0]?.id}`);
}

try {
  await checkFlagOff();
  await checkDefaultSpace();
} catch (err) {
  check('smoke run', false, err.message);
} finally {
  for (const dir of profiles) rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
