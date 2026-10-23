// Headless smoke test for a helium-spaces dev build.
// Usage: node --experimental-websocket devutils/spaces_smoke.mjs [path/to/Helium.app]
//        (the flag is only needed on Node 20/21)
// Launches the build with throwaway profiles and checks it over the DevTools
// protocol and the profile's Preferences file:
//   1. Flag off: the helium-spaces flag is registered and off by default, and
//      no spaces are written.
//   2. Flag on: the profile gets exactly one default space.
//   3. Flag on, same profile: the default space keeps its id.
//   4. Flag on: tabs assigned to spaces through chrome://spaces-internals keep
//      their space across restarts, including a restart with no changes and
//      one after a forced rewrite of the session file.
//   5. Flag on: switching spaces, new tabs joining the active space, tab
//      commands staying inside it, favorites, closing a space's last tab,
//      removing the active space, and the active space after a restart.
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
const browsers = [];

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

// Returns the first page target whose URL starts with `url`.
async function devtoolsTarget(port, url) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page' && t.url.startsWith(url));
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
  // Rejects after 30 s, e.g. when a bug closes the tab this session drives.
  const send = async (method, params = {}) => {
    await ready;
    const msgId = ++id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(msgId);
        reject(new Error(`${method} got no reply`));
      }, 30000);
      pending.set(msgId, (msg) => { clearTimeout(timer); resolve(msg); });
    });
  };
  return { send, close: () => ws.close() };
}

// Starts the browser on `profile` with `url` and returns a DevTools session for
// that page, plus close(), which shuts down cleanly so prefs and the session
// get written to disk. With `attachTo` instead of a URL, opens no extra tab and
// attaches to the first restored page whose URL starts with it.
async function launch(profile, extraArgs = [], url = 'about:blank', attachTo = undefined) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const browser = spawn(binary, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--use-mock-keychain',
    '--no-first-run',
    ...extraArgs,
    ...(attachTo ? [] : [url]),
  ], { stdio: 'ignore' });
  browsers.push(browser);
  const exited = new Promise((r) => browser.once('exit', r));
  try {
    const cdp = session((await devtoolsTarget(port, attachTo ?? url)).webSocketDebuggerUrl);
    const close = async ({ waitForSessionSave = false } = {}) => {
      // Session commands are written 2.5 s after a change (kSaveDelay in
      // command_storage_manager.cc), and a headless quit drops any still
      // pending, so let them land first.
      if (waitForSessionSave) await sleep(3500);
      // Browser.close shuts down gracefully; never answers, so don't await it.
      cdp.send('Browser.close').catch(() => {});
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

// Reloads chrome://spaces-internals in `cdp` and returns its state.
async function internalsState(cdp) {
  await cdp.send('Page.navigate', { url: INTERNALS });
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const r = await cdp.send('Runtime.evaluate', {
      expression: "document.getElementById('state')?.textContent ?? ''", returnByValue: true });
    const text = r.result?.result?.value;
    if (text) return JSON.parse(text);
  }
  throw new Error('chrome://spaces-internals did not render');
}

// Sends a chrome.send() message to chrome://spaces-internals, which must be
// loaded in `cdp`.
async function internalsSend(cdp, message, args) {
  await cdp.send('Runtime.evaluate', { expression: `chrome.send(${JSON.stringify(message)}, ${JSON.stringify(args)})` });
}

const INTERNALS = 'chrome://spaces-internals/';

// A test tab's name ("T1", "W2", ...) from the end of its data: URL, or
// undefined. Matches on URL because a restored background tab has no title
// until it loads.
const testTabName = (url) => /^data:.*([A-Z]\d)$/.exec(url)?.[1];

// Opens a test tab named `name`, the way a link or tab API would.
async function openTestTab(cdp, name) {
  await cdp.send('Target.createTarget', { url: `data:text/html,<title>${name}</title>${name}` });
}

// Every tab of the first window, with its space as a name: a space's name, or
// "default" for the default space, no space, or a removed space.
function tabList(state) {
  const names = new Map(state.spaces.map((s) => [s.id, s.default ? 'default' : s.name]));
  const window = state.windows[0];
  return window.tabs.map((tab) => ({
    ...tab, window: window.session_id, name: testTabName(tab.url),
    space: names.get(tab.space_id) ?? 'default',
  }));
}

// The name of the first window's active space.
function activeSpace(state) {
  const space = state.spaces.find((s) => s.id === state.windows[0].active_space_id);
  return space ? (space.default ? 'default' : space.name) : undefined;
}

// Maps every test tab in a "T" name to its space name. Other tabs are ignored.
function tabSpaces(state) {
  const result = {};
  for (const window of state.windows) {
    for (const tab of window.tabs) {
      const name = testTabName(tab.url);
      if (name?.startsWith('T')) {
        const space = state.spaces.find((s) => s.id === tab.space_id);
        result[name] = space && !space.default ? space.name : 'default';
      }
    }
  }
  return result;
}

// Reloads chrome://spaces-internals until all `count` test tabs have loaded
// (background tabs take a few seconds), and returns its state.
async function waitForTestTabs(cdp, count) {
  let state;
  for (let i = 0; i < 40; i++) {
    state = await internalsState(cdp);
    if (Object.keys(tabSpaces(state)).length === count) return state;
    await sleep(250);
  }
  return state;
}

// Reloads chrome://spaces-internals until every named test tab has loaded, and
// returns its state.
async function waitForNamedTabs(cdp, names) {
  let state;
  for (let i = 0; i < 40; i++) {
    state = await internalsState(cdp);
    const loaded = new Set(tabList(state).map((t) => t.name));
    if (names.every((n) => loaded.has(n))) return state;
    await sleep(250);
  }
  return state;
}

async function checkSwitching() {
  const profile = newProfile();
  const args = ['--enable-features=HeliumSpaces'];
  let { cdp, close } = await launch(profile, args);
  let state = await internalsState(cdp);
  const win = state.windows[0].session_id;
  const send = (message, ...rest) => internalsSend(cdp, message, rest);
  const find = (state, name) => tabList(state).find((t) => t.name === name);
  const active = (state) => tabList(state).find((t) => t.active);
  const spaceTabs = (state, space) => tabList(state).filter((t) => t.space === space && !t.pinned);

  await send('addSpace', 'Work');
  await send('addSpace', 'Play');
  await openTestTab(cdp, 'D1');
  await openTestTab(cdp, 'D2');
  state = await waitForNamedTabs(cdp, ['D1', 'D2']);
  const ids = Object.fromEntries(state.spaces.map((s) => [s.name, s.id]));
  check('a window starts in the default space', activeSpace(state) === 'default', activeSpace(state));

  await send('switchSpace', win, ids.Work);
  state = await internalsState(cdp);
  check('switching to an empty space opens a new tab in it',
        activeSpace(state) === 'Work' && active(state)?.space === 'Work' && spaceTabs(state, 'Work').length === 1,
        `active space ${activeSpace(state)}, active tab in ${active(state)?.space}`);

  await openTestTab(cdp, 'W1');
  await openTestTab(cdp, 'W2');
  await send('runCommand', win, 'newTab');
  state = await waitForNamedTabs(cdp, ['W1', 'W2']);
  check('new tabs join the active space',
        find(state, 'W1')?.space === 'Work' && find(state, 'W2')?.space === 'Work' &&
        spaceTabs(state, 'Work').length === 4,
        JSON.stringify(spaceTabs(state, 'Work').map((t) => t.name ?? t.url)));

  // Ctrl+Tab from W1 must visit exactly the Work tabs.
  const workIndices = spaceTabs(state, 'Work').map((t) => t.index).sort((a, b) => a - b);
  await send('activateTab', win, find(state, 'W1').index);
  const visited = new Set();
  for (let i = 0; i < workIndices.length + 2; i++) {
    await send('runCommand', win, 'selectNextTab');
    state = await internalsState(cdp);
    visited.add(active(state)?.index);
  }
  check('Ctrl+Tab stays in the active space',
        JSON.stringify([...visited].sort((a, b) => a - b)) === JSON.stringify(workIndices),
        `visited ${[...visited]}, Work tabs ${workIndices}`);

  await send('runCommand', win, 'selectFirstTab');
  state = await internalsState(cdp);
  const first = active(state)?.index;
  await send('runCommand', win, 'selectLastTab');
  state = await internalsState(cdp);
  const last = active(state)?.index;
  check('Cmd+1 and Cmd+9 pick the first and last tab of the active space',
        first === workIndices[0] && last === workIndices.at(-1), `got ${first}, ${last}; Work tabs ${workIndices}`);

  // A pinned tab in the default space is a favorite, shown in every space.
  await send('pinTab', win, find(state, 'D1').index, true);
  state = await internalsState(cdp);
  check('a pinned default tab is shown in other spaces',
        find(state, 'D1')?.pinned && find(state, 'D1')?.in_active_space && !find(state, 'D2')?.in_active_space);
  await send('runCommand', win, 'selectFirstTab');
  state = await internalsState(cdp);
  check('activating a favorite keeps the active space',
        active(state)?.name === 'D1' && activeSpace(state) === 'Work',
        `active ${active(state)?.name}, space ${activeSpace(state)}`);

  await send('switchSpace', win, ids.Play);
  await openTestTab(cdp, 'P1');
  state = await waitForNamedTabs(cdp, ['P1']);
  check('switching away from a favorite moves to the new space',
        activeSpace(state) === 'Play' && find(state, 'P1')?.space === 'Play', activeSpace(state));

  await send('activateTab', win, find(state, 'W2').index);
  await send('switchSpace', win, ids.Play);
  await send('switchSpace', win, ids.Work);
  state = await internalsState(cdp);
  check('switching back activates the space\'s most recent tab', active(state)?.name === 'W2',
        `active ${active(state)?.name ?? active(state)?.url}`);

  // The last Work tab's right neighbor is in Play, which Chromium would
  // activate after closing it.
  const workBefore = spaceTabs(state, 'Work');
  const neighbor = tabList(state).find((t) => t.index === workBefore.at(-1).index + 1);
  await send('activateTab', win, workBefore.at(-1).index);
  await send('runCommand', win, 'closeTab');
  state = await internalsState(cdp);
  check('closing a tab activates another tab of the same space',
        neighbor?.space === 'Play' && activeSpace(state) === 'Work' && active(state)?.space === 'Work' &&
        spaceTabs(state, 'Work').length === workBefore.length - 1,
        `neighbor in ${neighbor?.space}, active space ${activeSpace(state)}, active tab in ${active(state)?.space}`);

  await send('closeOtherTabs', win, find(state, 'W1').index);
  state = await internalsState(cdp);
  check('"Close other tabs" only closes tabs in the active space',
        spaceTabs(state, 'Work').map((t) => t.name).join() === 'W1' &&
        ['D1', 'D2', 'P1'].every((n) => find(state, n)),
        JSON.stringify(tabList(state).map((t) => t.name ?? t.url)));

  // Closing W1 leaves Work empty but for the favorite: stay in Work, with a
  // new tab, instead of jumping to another space.
  await send('activateTab', win, find(state, 'W1').index);
  await send('runCommand', win, 'closeTab');
  await sleep(500);
  state = await internalsState(cdp);
  check('closing the last tab of a space opens a new tab there',
        activeSpace(state) === 'Work' && active(state)?.space === 'Work' && !active(state)?.pinned &&
        spaceTabs(state, 'Work').length === 1,
        `active space ${activeSpace(state)}, active tab ${active(state)?.name ?? active(state)?.url} in ${active(state)?.space}`);

  await send('activateTab', win, find(state, 'P1').index);
  state = await internalsState(cdp);
  check('activating a tab in another space switches to it', activeSpace(state) === 'Play', activeSpace(state));

  await send('removeSpace', ids.Play);
  state = await internalsState(cdp);
  check('removing the active space moves to the default space, with its tabs',
        activeSpace(state) === 'default' && find(state, 'P1')?.space === 'default',
        `active space ${activeSpace(state)}, P1 in ${find(state, 'P1')?.space}`);

  // Restart with a favorite active while in Work.
  await send('switchSpace', win, ids.Work);
  await openTestTab(cdp, 'W3');
  state = await waitForNamedTabs(cdp, ['W3']);
  await send('activateTab', win, find(state, 'D1').index);
  state = await internalsState(cdp);
  await close({ waitForSessionSave: true });

  // A startup URL would open a tab that joins the active space and becomes
  // active, so attach to the restored chrome://spaces-internals tab instead.
  ({ cdp, close } = await launch(profile, [...args, '--restore-last-session'], undefined, INTERNALS));
  state = await waitForNamedTabs(cdp, ['D1', 'D2', 'W3', 'P1']);
  check('the active space survives a restart with a favorite active',
        activeSpace(state) === 'Work' && active(state)?.name === 'D1' && find(state, 'D1')?.pinned,
        `active space ${activeSpace(state)}, active tab ${active(state)?.name ?? active(state)?.url}`);
  await close();
}

async function checkTabSpaces() {
  const profile = newProfile();
  const args = ['--enable-features=HeliumSpaces'];
  const restore = [...args, '--restore-last-session'];
  const expected = { T1: 'Work', T2: 'Work', T3: 'Play', T4: 'Play', T5: 'default', T6: 'default' };

  let { cdp, close } = await launch(profile, args);
  await internalsState(cdp);
  await internalsSend(cdp, 'addSpace', ['Work']);
  await internalsSend(cdp, 'addSpace', ['Play']);
  for (const title of Object.keys(expected)) {
    await cdp.send('Target.createTarget', { url: `data:text/html,<title>${title}</title>${title}` });
  }
  let state = await waitForTestTabs(cdp, Object.keys(expected).length);
  const ids = Object.fromEntries(state.spaces.map((s) => [s.name, s.id]));
  const window = state.windows[0];
  const index = Object.fromEntries(window.tabs.map((t) => [/(T\d)$/.exec(t.url)?.[1], t.index]));
  // T5 goes to Work and back, to check that moving to the default space
  // overrides the earlier id in the same session file.
  for (const [title, space] of [...Object.entries(expected), ['T5', 'Work'], ['T5', 'default']]) {
    await internalsSend(cdp, 'assignTab', [window.session_id, index[title], space === 'default' ? '' : ids[space]]);
  }
  state = await internalsState(cdp);
  check('tabs take the space they are assigned', JSON.stringify(tabSpaces(state)) === JSON.stringify(expected),
        JSON.stringify(tabSpaces(state)));
  await close({ waitForSessionSave: true });

  ({ cdp, close } = await launch(profile, restore));
  state = await waitForTestTabs(cdp, Object.keys(expected).length);
  check('tabs keep their space after a restart', JSON.stringify(tabSpaces(state)) === JSON.stringify(expected),
        JSON.stringify(tabSpaces(state)));
  await close({ waitForSessionSave: true });

  // Restored tabs are written to the new session file by BuildCommandsForTab(),
  // which drops tab extra data without our hook; a second restart with no
  // changes checks that.
  ({ cdp, close } = await launch(profile, restore));
  state = await waitForTestTabs(cdp, Object.keys(expected).length);
  check('tabs keep their space after a second restart', JSON.stringify(tabSpaces(state)) === JSON.stringify(expected),
        JSON.stringify(tabSpaces(state)));
  await internalsSend(cdp, 'rewriteSession', []);
  await close({ waitForSessionSave: true });

  ({ cdp, close } = await launch(profile, restore));
  state = await waitForTestTabs(cdp, Object.keys(expected).length);
  check('tabs keep their space after the session file is rewritten',
        JSON.stringify(tabSpaces(state)) === JSON.stringify(expected), JSON.stringify(tabSpaces(state)));

  // Reopening a closed tab (Cmd+Shift+T) goes through tab restore instead.
  const t3 = state.windows.flatMap((w) => w.tabs.map((t) => ({ window: w.session_id, ...t })))
      .find((t) => t.url.endsWith('T3'));
  await internalsSend(cdp, 'closeTab', [t3.window, t3.index]);
  state = await waitForTestTabs(cdp, Object.keys(expected).length - 1);
  await internalsSend(cdp, 'reopenClosedTab', [t3.window]);
  state = await waitForTestTabs(cdp, Object.keys(expected).length);
  check('a closed tab reopens in its space', tabSpaces(state).T3 === 'Play', `T3: ${tabSpaces(state).T3}`);
  await close();
}

try {
  await checkFlagOff();
  await checkDefaultSpace();
  await checkTabSpaces();
  await checkSwitching();
} catch (err) {
  check('smoke run', false, err.message);
} finally {
  // A failed check can leave a browser running.
  for (const browser of browsers) if (browser.exitCode === null) browser.kill('SIGKILL');
  for (const dir of profiles) rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
