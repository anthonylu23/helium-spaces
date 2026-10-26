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
//   6. Flag on: each space's tabs stay together in the tab strip, whatever
//      inserts or moves them: new tabs, links, extension moves, drops, pinning,
//      groups, split views, reopened tabs, removed spaces, other windows.
//   7. Flag on: keyboard tab moves and Shift-click ranges stay in the active
//      space, and tab menu commands only count its tabs.
//   8. Flag on: the space commands, the tab menu's Spaces items, and drops on
//      a space's icon.
//   9. Flag on: three spaces of ten tabs each, with a favorite, space-pinned
//      tabs and groups, come back the same after two restarts (Gate 1).
//  10. Flag on: a space with its own storage (Phase 5 spike) keeps its
//      cookies from other spaces, through navigations, popups and restarts.
// Needs a global WebSocket: Node 22+, or Node 20.10+ with --experimental-websocket.
// Exits non-zero on any failed check.

if (typeof WebSocket === 'undefined') {
  console.error('No global WebSocket. Use Node 22+, or run with --experimental-websocket.');
  process.exit(2);
}

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
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
    // Launched from a terminal, the GPU process otherwise gets its own macOS
    // privacy (TCC) identity, and with no Documents grant it hangs at launch
    // on a consent prompt nobody sees (development.md, Known environment
    // issues).
    '--disable-features=MacDisclaimGpuTccResponsibility',
    ...extraArgs,
    ...(attachTo ? [] : [url]),
  ], { stdio: ['ignore', 'ignore', process.env.SPACES_SMOKE_STDERR ? 'inherit' : 'ignore'] });
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
async function openTestTab(cdp, name, { background = false } = {}) {
  await cdp.send('Target.createTarget', { url: `data:text/html,<title>${name}</title>${name}`, background });
}

// Every tab of the first window, with its space as a name: a space's name, or
// "default" for the default space, no space, or a removed space.
function tabList(state, windowId = undefined) {
  const names = new Map(state.spaces.map((s) => [s.id, s.default ? 'default' : s.name]));
  const window = windowId === undefined ? state.windows[0] : state.windows.find((w) => w.session_id === windowId);
  return window.tabs.map((tab) => ({
    ...tab, window: window.session_id, name: testTabName(tab.url),
    space: tab.favorite ? 'favorites' : (names.get(tab.space_id) ?? 'default'),
  }));
}

// The name of the first window's active space.
function activeSpace(state) {
  const space = state.spaces.find((s) => s.id === state.windows[0].active_space_id);
  return space ? (space.default ? 'default' : space.name) : undefined;
}

// Maps every test tab in a "T" name to its space name. Other tabs are ignored.
// Whether two {tab name: space name} maps are the same, in any order.
const sameSpaces = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

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

  // A favorite shows in every space, as in Arc.
  await send('tabMenuCommand', win, find(state, 'D1').index, 'addToFavorites');
  state = await internalsState(cdp);
  check('a favorite is shown in other spaces',
        find(state, 'D1')?.favorite && find(state, 'D1')?.pinned && find(state, 'D1')?.in_active_space &&
        !find(state, 'D2')?.in_active_space, JSON.stringify(find(state, 'D1')));
  // Pinning keeps a tab in its space, the default space's too.
  await send('pinTab', win, find(state, 'D2').index, true);
  state = await internalsState(cdp);
  check("a pinned tab of the default space is no favorite, and hidden in other spaces",
        find(state, 'D2')?.pinned && find(state, 'D2')?.space === 'default' && !find(state, 'D2')?.in_active_space,
        JSON.stringify(find(state, 'D2')));
  await send('pinTab', win, find(state, 'D2').index, false);
  state = await internalsState(cdp);
  await send('runCommand', win, 'selectFirstTab');
  state = await internalsState(cdp);
  check('activating a favorite keeps the active space',
        active(state)?.name === 'D1' && activeSpace(state) === 'Work',
        `active ${active(state)?.name}, space ${activeSpace(state)}`);

  // Unpinned, D1 joins the active space, as in Arc.
  await send('pinTab', win, find(state, 'D1').index, false);
  state = await internalsState(cdp);
  check('unpinning the active favorite moves it to the active space',
        activeSpace(state) === 'Work' && active(state)?.name === 'D1' && find(state, 'D1')?.space === 'Work',
        `active space ${activeSpace(state)}, D1 in ${find(state, 'D1')?.space}`);
  // Make it a favorite again.
  await send('tabMenuCommand', win, find(state, 'D1').index, 'addToFavorites');
  state = await internalsState(cdp);

  await send('switchSpace', win, ids.Play);
  await openTestTab(cdp, 'P1');
  state = await waitForNamedTabs(cdp, ['P1']);
  check('switching away from a favorite moves to the new space',
        activeSpace(state) === 'Play' && find(state, 'P1')?.space === 'Play', activeSpace(state));

  // W4 opens in the background after W2 was last shown, so it is newer by
  // last-active time but was never viewed.
  await send('activateTab', win, find(state, 'W2').index);
  await openTestTab(cdp, 'W4', { background: true });
  state = await waitForNamedTabs(cdp, ['W4']);
  await send('switchSpace', win, ids.Play);
  await send('switchSpace', win, ids.Work);
  state = await internalsState(cdp);
  check('switching back activates the tab last active in the space', active(state)?.name === 'W2',
        `active ${active(state)?.name ?? active(state)?.url}, W4 in ${find(state, 'W4')?.space}`);

  // Close a Work tab whose right neighbor is in Play, which Chromium would
  // activate next.
  const workBefore = spaceTabs(state, 'Work');
  const rightOf = (t) => tabList(state).find((u) => u.index === t.index + 1);
  const closing = workBefore.find((t) => rightOf(t)?.space === 'Play');
  const neighbor = closing && rightOf(closing);
  await send('activateTab', win, closing?.index ?? -1);
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

  // Closing W1 leaves Work empty: stay in Work, with a new tab, instead of
  // jumping to another space, and without showing a tab of another space on
  // the way, which would bump its last-active time. So that no favorite can
  // stand in, D1 is a pinned tab of Play for this check.
  await send('assignTab', win, find(state, 'D1').index, ids.Play);
  state = await internalsState(cdp);
  await send('activateTab', win, find(state, 'W1').index);
  state = await internalsState(cdp);
  const othersBefore = tabList(state).filter((t) => t.space !== 'Work' && !t.pinned);
  await send('runCommand', win, 'closeTab');
  await sleep(500);
  state = await internalsState(cdp);
  const shownOnTheWay = othersBefore.filter((t) => tabList(state).find((u) => u.id === t.id)?.last_active !== t.last_active);
  check('closing the last tab of a space opens a new tab there',
        activeSpace(state) === 'Work' && active(state)?.space === 'Work' && !active(state)?.pinned &&
        spaceTabs(state, 'Work').length === 1 && shownOnTheWay.length === 0,
        `active space ${activeSpace(state)}, active tab ${active(state)?.name ?? active(state)?.url} in ${active(state)?.space}, ` +
        `shown on the way: ${shownOnTheWay.map((t) => t.name ?? t.url)}`);
  await send('tabMenuCommand', win, find(state, 'D1').index, 'addToFavorites');

  await send('activateTab', win, find(state, 'P1').index);
  state = await internalsState(cdp);
  check('activating a tab in another space switches to it', activeSpace(state) === 'Play', activeSpace(state));

  await send('removeSpace', ids.Play);
  state = await internalsState(cdp);
  check('removing the active space moves to the default space, with its tabs',
        activeSpace(state) === 'default' && find(state, 'P1')?.active && find(state, 'P1')?.in_active_space,
        `active space ${activeSpace(state)}, P1 active ${find(state, 'P1')?.active}, shown ${find(state, 'P1')?.in_active_space}`);

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
        activeSpace(state) === 'Work' && active(state)?.name === 'D1' && find(state, 'D1')?.favorite,
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
  // T5 goes to Work and back, to check that moving to the default space
  // overrides the earlier id in the same session file. Moving a tab to a space
  // moves it to that space's tabs, so look up its index each time.
  for (const [title, space] of [...Object.entries(expected), ['T5', 'Work'], ['T5', 'default']]) {
    const tab = (await internalsState(cdp)).windows[0].tabs.find((t) => t.url.endsWith(title));
    await internalsSend(cdp, 'assignTab', [window.session_id, tab.index, space === 'default' ? '' : ids[space]]);
  }
  state = await internalsState(cdp);
  check('tabs take the space they are assigned', sameSpaces(tabSpaces(state), expected),
        JSON.stringify(tabSpaces(state)));
  await close({ waitForSessionSave: true });

  ({ cdp, close } = await launch(profile, restore));
  state = await waitForTestTabs(cdp, Object.keys(expected).length);
  check('tabs keep their space after a restart', sameSpaces(tabSpaces(state), expected),
        JSON.stringify(tabSpaces(state)));
  await close({ waitForSessionSave: true });

  // Restored tabs are written to the new session file by BuildCommandsForTab(),
  // which drops tab extra data without our hook; a second restart with no
  // changes checks that.
  ({ cdp, close } = await launch(profile, restore));
  state = await waitForTestTabs(cdp, Object.keys(expected).length);
  check('tabs keep their space after a second restart', sameSpaces(tabSpaces(state), expected),
        JSON.stringify(tabSpaces(state)));
  await internalsSend(cdp, 'rewriteSession', []);
  await close({ waitForSessionSave: true });

  ({ cdp, close } = await launch(profile, restore));
  state = await waitForTestTabs(cdp, Object.keys(expected).length);
  check('tabs keep their space after the session file is rewritten',
        sameSpaces(tabSpaces(state), expected), JSON.stringify(tabSpaces(state)));

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

// Each space's tabs stay together in the tab strip: pinned and unpinned apart,
// favorites first. Every check also asks that the order never broke and had to
// be fixed afterwards, which SpaceController counts.
async function checkOrder() {
  const profile = newProfile();
  const { cdp, close } = await launch(profile, ['--enable-features=HeliumSpaces']);
  let state = await internalsState(cdp);
  const win = state.windows[0].session_id;
  const send = (message, ...rest) => internalsSend(cdp, message, rest);
  const find = (state, name, w = win) => tabList(state, w).find((t) => t.name === name);
  const active = (state, w = win) => tabList(state, w).find((t) => t.active);
  // A window's tabs in order: test tabs by name, N for a New Tab page, I for
  // this page, with the space of each run.
  const order = (state, w = win) => tabList(state, w).map((t) =>
    `${t.name ?? (t.url.startsWith(INTERNALS) ? 'I' : 'N')}${t.pinned ? '*' : ''}:${t.space}`).join(' ');
  // Indices of a space's unpinned tabs.
  const run = (state, space, w = win) =>
    tabList(state, w).filter((t) => t.space === space && !t.pinned).map((t) => t.index);
  let fixes = 0;
  const ordered = (state) => {
    const total = state.windows.reduce((sum, w) => sum + w.order_fixes, 0);
    const ok = total === fixes && state.windows.every((w) => w.order_ok);
    fixes = total;
    return ok;
  };

  await send('addSpace', 'Work');
  await send('addSpace', 'Play');
  for (const name of ['F1', 'F2', 'D1']) await openTestTab(cdp, name);
  state = await waitForNamedTabs(cdp, ['F1', 'F2', 'D1']);
  const ids = Object.fromEntries(state.spaces.map((s) => [s.name, s.id]));
  await send('tabMenuCommand', win, find(state, 'F1').index, 'addToFavorites');
  state = await internalsState(cdp);
  await send('tabMenuCommand', win, find(state, 'F2').index, 'addToFavorites');
  await send('switchSpace', win, ids.Work);
  for (const name of ['W1', 'W2']) await openTestTab(cdp, name);
  await send('switchSpace', win, ids.Play);
  for (const name of ['P1', 'P2']) await openTestTab(cdp, name);
  state = await waitForNamedTabs(cdp, ['W1', 'W2', 'P1', 'P2']);
  check('tabs opened in each space start out together', ordered(state), order(state));

  // Chromium puts Cmd+T at the end of the strip, after Play's tabs.
  await send('switchSpace', win, ids.Work);
  await send('runCommand', win, 'newTab');
  state = await internalsState(cdp);
  check("a new tab goes at the end of the active space's tabs",
        active(state)?.space === 'Work' && active(state)?.index === Math.max(...run(state, 'Work')) && ordered(state),
        order(state));

  // Chromium puts a link opened from a pinned tab first among unpinned tabs,
  // which are the default space's.
  await send('activateTab', win, find(state, 'F1').index);
  await send('openLink', win, 'data:text/html,<title>W3</title>W3', true);
  state = await waitForNamedTabs(cdp, ['W3']);
  check("a link opened from a favorite goes first among the active space's tabs",
        find(state, 'W3')?.space === 'Work' && find(state, 'W3')?.index === run(state, 'Work')[0] && ordered(state),
        order(state));

  await send('moveTab', win, find(state, 'W1').index, find(state, 'P2').index);
  state = await internalsState(cdp);
  check("an extension moving a tab among another space's tabs leaves it at the end of its own",
        find(state, 'W1')?.index === Math.max(...run(state, 'Work')) && ordered(state), order(state));

  await send('activateTab', win, find(state, 'W2').index);
  await send('moveSelectedTabs', win, find(state, 'P1').index);
  state = await internalsState(cdp);
  check("a tab dropped among another space's tabs stays at the end of its own",
        find(state, 'W2')?.index === Math.max(...run(state, 'Work')) && ordered(state), order(state));

  // Pinned tabs: F1 F2 W2 P1. Pinning W1 would put it after P1.
  await send('pinTab', win, find(state, 'W2').index, true);
  await send('switchSpace', win, ids.Play);
  state = await internalsState(cdp);
  await send('pinTab', win, find(state, 'P1').index, true);
  await send('switchSpace', win, ids.Work);
  state = await internalsState(cdp);
  await send('pinTab', win, find(state, 'W1').index, true);
  state = await internalsState(cdp);
  check("a pinned tab goes with its space's pinned tabs, after the favorites",
        find(state, 'W2')?.index === 2 && find(state, 'W1')?.index === 3 && find(state, 'P1')?.index === 4 &&
        ordered(state), order(state));

  await send('activateTab', win, find(state, 'W1').index);
  await send('moveSelectedTabs', win, 0);
  state = await internalsState(cdp);
  check('a pinned tab dragged over the favorites stays after them',
        find(state, 'W1')?.index === 2 && ordered(state), order(state));

  // Chromium puts an unpinned tab first among unpinned tabs, the default space's.
  await send('pinTab', win, find(state, 'W2').index, false);
  state = await internalsState(cdp);
  check("an unpinned tab goes first among its space's tabs",
        find(state, 'W2')?.index === run(state, 'Work')[0] && ordered(state), order(state));

  // Play's tabs are last, so P2 would stay after them.
  await send('assignTab', win, find(state, 'P2').index, ids.Work);
  state = await internalsState(cdp);
  check("a tab moved to another space goes to the end of that space's tabs",
        find(state, 'P2')?.space === 'Work' && find(state, 'P2')?.index === Math.max(...run(state, 'Work')) &&
        ordered(state), order(state));

  // The default space's tabs come before Work's, so the pair would end up
  // after them.
  await send('splitTabs', win, [find(state, 'W3').index, find(state, 'P2').index]);
  state = await internalsState(cdp);
  await send('assignTab', win, find(state, 'W3').index, '');
  state = await internalsState(cdp);
  const defaults = run(state, 'default');
  check('a tab in a split view moves to another space with the other tab, to the end of its tabs',
        find(state, 'W3')?.space === 'default' && find(state, 'P2')?.space === 'default' &&
        defaults.slice(-2).join() === [find(state, 'W3')?.index, find(state, 'P2')?.index].sort((a, b) => a - b).join() &&
        ordered(state), order(state));

  // Added to the favorites, the default space's split moves from the end of
  // the pinned tabs, after Work's and Play's, to the favorites.
  await send('tabMenuCommand', win, find(state, 'W3').index, 'addToFavorites');
  state = await internalsState(cdp);
  check('a split view added to the favorites goes with them',
        find(state, 'W3')?.favorite && find(state, 'P2')?.favorite &&
        [find(state, 'W3')?.index, find(state, 'P2')?.index].sort().join() === '2,3' && ordered(state),
        order(state));

  // A tab added to a group joins the group's space.
  const playTab = tabList(state).find((t) => t.space === 'Play' && !t.pinned);
  await send('groupTabs', win, [playTab.index]);
  state = await internalsState(cdp);
  await send('addToGroup', win, find(state, 'D1').index, playTab.index);
  state = await internalsState(cdp);
  const playGroup = tabList(state).find((t) => t.id === playTab.id)?.group;
  check("a tab added to another space's group joins that space",
        find(state, 'D1')?.space === 'Play' && find(state, 'D1')?.group === playGroup && ordered(state),
        order(state));

  await send('groupTabs', win, [find(state, 'W2').index]);
  state = await internalsState(cdp);
  await send('moveGroup', win, find(state, 'W2').index, 0);
  state = await internalsState(cdp);
  check("a group dragged among another space's tabs stays with its own",
        find(state, 'W2')?.index === run(state, 'Work')[0] && ordered(state), order(state));

  // Grouping unpins a favorite, which then joins the active space.
  await send('groupTabs', win, [find(state, 'F2').index, find(state, 'W2').index]);
  state = await internalsState(cdp);
  check('a favorite grouped with tabs of the active space joins it',
        find(state, 'F2')?.space === 'Work' && !find(state, 'F2')?.pinned &&
        find(state, 'F2')?.group && find(state, 'F2')?.group === find(state, 'W2')?.group && ordered(state),
        order(state));

  // Reopening a tab puts it back at its old index. With the tab first among
  // Work's, moving a Play tab to the default space, whose tabs come before
  // Work's, puts that index among the default space's tabs.
  const ungrouped = tabList(state).find((t) => t.space === 'Work' && !t.pinned && !t.grouped);
  await send('moveTab', win, ungrouped.index, run(state, 'Work')[0]);
  state = await internalsState(cdp);
  const firstWork = tabList(state).find((t) => t.id === ungrouped.id);
  await send('closeTab', win, firstWork.index);
  state = await internalsState(cdp);
  await send('assignTab', win, tabList(state).find((t) => t.space === 'Play' && !t.pinned).index, '');
  await send('reopenClosedTab', win);
  await sleep(500);
  state = await internalsState(cdp);
  const reopened = tabList(state).find((t) => t.url === firstWork.url && t.space === 'Work');
  check("a reopened tab goes back among its space's tabs",
        reopened && run(state, 'Work').includes(reopened.index) && ordered(state), order(state));

  // Play's pinned tab becomes a pinned tab of the default space, not a
  // favorite.
  await send('removeSpace', ids.Play);
  state = await internalsState(cdp);
  check("removing a space puts its tabs with the default space's, its pinned tabs too",
        find(state, 'P1')?.space === 'default' && find(state, 'P1')?.pinned && ordered(state), order(state));

  for (const name of ['W4', 'W5']) await openTestTab(cdp, name);
  state = await waitForNamedTabs(cdp, ['W4', 'W5']);
  await send('runCommand', win, 'newWindow');
  await sleep(500);
  state = await internalsState(cdp);
  const win2 = state.windows.find((w) => w.session_id !== win)?.session_id;
  await send('switchSpace', win2, ids.Work);
  state = await internalsState(cdp);
  await send('moveTabToWindow', win, find(state, 'D1').index, win2, 0);
  state = await internalsState(cdp);
  check("a tab moved to another window joins that window's space",
        find(state, 'D1', win2)?.space === 'Work' && find(state, 'D1', win2)?.active && ordered(state),
        order(state, win2));
  await send('moveTabToWindow', win, find(state, 'F1').index, win2, 0);
  state = await internalsState(cdp);
  check('a favorite moved to another window stays a favorite',
        find(state, 'F1', win2)?.favorite && ordered(state),
        order(state, win2));
  await send('splitTabs', win, [find(state, 'W4').index, find(state, 'W5').index]);
  state = await internalsState(cdp);
  await send('moveSplitToWindow', win, find(state, 'W4').index, win2, 0);
  state = await internalsState(cdp);
  check("a split view moved to another window joins that window's space",
        find(state, 'W4', win2)?.space === 'Work' && find(state, 'W5', win2)?.space === 'Work' &&
        ordered(state), order(state, win2));
  await send('moveGroupToWindow', win, find(state, 'W2').index, win2, 0);
  state = await internalsState(cdp);
  check("a group moved to another window joins that window's space",
        find(state, 'W2', win2)?.space === 'Work' && find(state, 'F2', win2)?.space === 'Work' &&
        find(state, 'F2', win2)?.index === run(state, 'Work', win2)[0] && ordered(state),
        order(state, win2));

  // A split view of a favorite and Work's active tab: the favorite is unpinned
  // and joins Work, the space of the split's first tab.
  await send('switchSpace', win, '');
  await send('runCommand', win, 'newTab');
  state = await internalsState(cdp);
  const favorite = active(state);
  await send('tabMenuCommand', win, favorite.index, 'addToFavorites');
  await send('switchSpace', win, ids.Work);
  await send('runCommand', win, 'newTab');
  state = await internalsState(cdp);
  const pivot = active(state);
  await send('splitTabs', win, [pivot.index, tabList(state).find((t) => t.id === favorite.id).index]);
  state = await internalsState(cdp);
  const split = tabList(state).filter((t) => t.id === favorite.id || t.id === pivot.id);
  check("a favorite split with the active space's tab joins its space",
        split.length === 2 && split.every((t) => t.space === 'Work' && !t.pinned && t.split) && ordered(state),
        order(state));

  // Moved to a new window with a favorite, which arrives first, Work's tabs
  // keep their space.
  await send('runCommand', win, 'newTab');
  state = await internalsState(cdp);
  const workTab = active(state);
  const fav = tabList(state).find((t) => t.favorite);
  await send('moveTabsToNewWindow', win, [fav.index, workTab.index]);
  await sleep(500);
  state = await internalsState(cdp);
  const win3 = state.windows.find((w) => w.session_id !== win && w.session_id !== win2)?.session_id;
  const moved = tabList(state, win3);
  check('tabs moved to a new window with a favorite keep their space',
        moved.find((t) => t.id === workTab.id)?.space === 'Work' &&
        moved.find((t) => t.id === fav.id)?.favorite && ordered(state),
        win3 ? order(state, win3) : 'no new window');
  await close();
}

// Keyboard tab moves and Shift-click ranges stay in the active space, and tab
// menu commands only count its tabs.
async function checkMovesInSpace() {
  const profile = newProfile();
  const { cdp, close } = await launch(profile, ['--enable-features=HeliumSpaces']);
  let state = await internalsState(cdp);
  const win = state.windows[0].session_id;
  const send = (message, ...rest) => internalsSend(cdp, message, rest);
  const find = (state, name) => tabList(state).find((t) => t.name === name);
  const order = (state) => tabList(state).map((t) =>
    `${t.name ?? (t.url.startsWith(INTERNALS) ? 'I' : 'N')}${t.pinned ? '*' : ''}:${t.space}`).join(' ');
  const ordered = (state) => state.windows.every((w) => w.order_ok && w.order_fixes === 0);

  await send('addSpace', 'Work');
  await send('addSpace', 'Play');
  await send('addSpace', 'Solo');
  for (const name of ['F1', 'D1']) await openTestTab(cdp, name);
  state = await waitForNamedTabs(cdp, ['F1', 'D1']);
  const ids = Object.fromEntries(state.spaces.map((s) => [s.name, s.id]));
  await send('tabMenuCommand', win, find(state, 'F1').index, 'addToFavorites');
  await send('switchSpace', win, ids.Play);
  for (const name of ['P1', 'P2']) await openTestTab(cdp, name);
  await send('switchSpace', win, ids.Work);
  for (const name of ['W1', 'W2', 'W3']) await openTestTab(cdp, name);
  state = await waitForNamedTabs(cdp, ['P1', 'P2', 'W1', 'W2', 'W3']);
  // Solo gets a New Tab page, after Work's tabs.
  await send('switchSpace', win, ids.Solo);
  await send('switchSpace', win, ids.Work);
  // F1* | I D1 | N P1 P2 | N W1 W2 W3 | N. Group Play's last tabs, so a Work
  // tab moving left past its run would join a hidden group.
  await send('groupTabs', win, [find(state, 'P1').index, find(state, 'P2').index]);
  await send('pinTab', win, find(state, 'W1').index, true);
  state = await internalsState(cdp);
  const before = order(state);

  // The first unpinned Work tab, after Play's group.
  const firstWork = tabList(state).find((t) => t.space === 'Work' && !t.pinned);
  await send('activateTab', win, firstWork.index);
  await send('runCommand', win, 'moveTabPrevious');
  state = await internalsState(cdp);
  const moved = tabList(state).find((t) => t.id === firstWork.id);
  check("Ctrl+Shift+PgUp stops at the start of the active space's tabs",
        moved?.index === firstWork.index && moved?.space === 'Work' && !moved?.grouped && ordered(state),
        `${before} -> ${order(state)}`);

  // W1 is Work's only pinned tab, after the favorite F1.
  await send('activateTab', win, find(state, 'W1').index);
  await send('runCommand', win, 'moveTabPrevious');
  state = await internalsState(cdp);
  check("Ctrl+Shift+PgUp doesn't move a space's pinned tab before the favorites",
        find(state, 'W1')?.index === 1 && ordered(state), order(state));

  await send('activateTab', win, find(state, 'W3').index);
  await send('runCommand', win, 'moveTabNext');
  state = await internalsState(cdp);
  const last = Math.max(...tabList(state).filter((t) => t.space === 'Work').map((t) => t.index));
  check("Ctrl+Shift+PgDn stops at the end of the active space's tabs",
        find(state, 'W3')?.index === last && ordered(state), order(state));
  await send('runCommand', win, 'moveTabPrevious');
  state = await internalsState(cdp);
  check('Ctrl+Shift+PgUp still moves a tab within its space',
        find(state, 'W3')?.index === last - 1 && ordered(state), order(state));

  // From the favorite F1 to W3, past the default and Play tabs.
  await send('activateTab', win, find(state, 'F1').index);
  await send('selectRange', win, find(state, 'W3').index, false);
  state = await internalsState(cdp);
  const selected = tabList(state).filter((t) => t.selected);
  check('a Shift-click range skips tabs of other spaces',
        selected.length > 2 && selected.every((t) => t.in_active_space) &&
        selected.some((t) => t.name === 'F1') && selected.some((t) => t.name === 'W3'),
        selected.map((t) => t.name ?? t.url).join());
  await send('activateTab', win, find(state, 'F1').index);
  await send('selectRange', win, find(state, 'W2').index, true);
  state = await internalsState(cdp);
  const added = tabList(state).filter((t) => t.selected);
  check('a Cmd+Shift-click range skips tabs of other spaces',
        added.length > 2 && added.every((t) => t.in_active_space) && added.some((t) => t.name === 'W2'),
        added.map((t) => t.name ?? t.url).join());

  // "Close tabs to the left" on D1, hidden left of Work's tabs, closes
  // nothing: only pinned and hidden tabs are to its left.
  await send('activateTab', win, find(state, 'W2').index);
  const workCount = tabList(state).filter((t) => t.space === 'Work').length;
  await send('tabMenuCommand', win, find(state, 'D1').index, 'closeTabsToLeft');
  state = await internalsState(cdp);
  check('"Close tabs to the left" on a hidden tab only looks left of it',
        tabList(state).filter((t) => t.space === 'Work').length === workCount && find(state, 'D1'),
        order(state));

  // Solo's only tab has no other tab of its space to close.
  await send('switchSpace', win, ids.Solo);
  state = await internalsState(cdp);
  const solo = tabList(state).find((t) => t.space === 'Solo');
  check('"Close other tabs" is off for the only tab of a space', solo && !solo.close_other_enabled,
        `enabled: ${solo?.close_other_enabled}`);
  await close();
}

// Space switching commands, and the tab context menu's Spaces items.
async function checkSpaceCommands() {
  const profile = newProfile();
  const { cdp, close } = await launch(profile, ['--enable-features=HeliumSpaces']);
  let state = await internalsState(cdp);
  const win = state.windows[0].session_id;
  const send = (message, ...rest) => internalsSend(cdp, message, rest);
  const find = (state, name) => tabList(state).find((t) => t.name === name);
  const order = (state) => tabList(state).map((t) =>
    `${t.name ?? (t.url.startsWith(INTERNALS) ? 'I' : 'N')}${t.pinned ? '*' : ''}${t.active ? '!' : ''}:${t.space}`).join(' ');
  const ordered = (state) => state.windows.every((w) => w.order_ok && w.order_fixes === 0);
  const activeTab = (state) => tabList(state).find((t) => t.active);
  const menu = async (name) => {
    await send('tabMenu', win, find(await internalsState(cdp), name).index);
    return (await internalsState(cdp)).tab_menu;
  };
  const labels = (items) => items.map((item) => item.label);
  const submenu = (items, label) => items.find((item) => item.label === label)?.items;
  // Fails the run if the item is missing, disabled or hidden.
  const menuItem = async (name, ...path) => {
    await send('tabMenuItem', win, find(await internalsState(cdp), name).index, path);
    const state = await internalsState(cdp);
    if (!state.tab_menu_item_activated) throw new Error(`no enabled menu item ${path.join(' > ')} on ${name}`);
    return state;
  };

  await send('addSpace', 'Work');
  await send('addSpace', 'Play');
  for (const name of ['F1', 'D1']) await openTestTab(cdp, name);
  state = await waitForNamedTabs(cdp, ['F1', 'D1']);
  const ids = Object.fromEntries(state.spaces.map((s) => [s.name, s.id]));
  await send('tabMenuCommand', win, find(state, 'F1').index, 'addToFavorites');
  await send('switchSpace', win, ids.Work);
  for (const name of ['W1', 'W2', 'W3', 'W4', 'W5']) await openTestTab(cdp, name);
  await send('switchSpace', win, ids.Play);
  for (const name of ['P1', 'P2']) await openTestTab(cdp, name);
  state = await waitForNamedTabs(cdp, ['W1', 'W2', 'W3', 'W4', 'W5', 'P1', 'P2']);
  await send('groupTabs', win, [find(state, 'P1').index, find(state, 'P2').index]);
  state = await internalsState(cdp);
  await send('groupTabs', win, [find(state, 'W2').index, find(state, 'W3').index]);

  // Default, Work, Play, in switcher order, wrapping around.
  const switched = [];
  for (const command of ['selectNextSpace', 'selectNextSpace', 'selectPreviousSpace', 'selectSpace2',
                         'selectSpace9', 'selectSpace1', 'selectPreviousSpace']) {
    await send('runCommand', win, command);
    switched.push(activeSpace(await internalsState(cdp)));
  }
  check('next and previous space wrap around, and Ctrl+N selects the Nth space',
        switched.join() === 'default,Work,default,Work,Work,default,Play', switched.join());

  await send('switchSpace', win, ids.Work);
  let items = await menu('W1');
  check('"Move to Space" lists the other spaces',
        JSON.stringify(labels(submenu(items, 'Move to Space') ?? [])) === '["Default","Play"]',
        JSON.stringify(submenu(items, 'Move to Space')));
  check('a tab of a space offers Pin and Add to Favorites',
        labels(items).includes('Pin') && labels(items).includes('Add to Favorites'), labels(items).join());
  // "New Group", then Work's group only; Play's is hidden. Adding W1 to the
  // group listed puts it in W2's group.
  const groups = labels(submenu(items, 'Add Tab to Group') ?? []);
  state = groups.length === 2 ? await menuItem('W1', 'Add Tab to Group', groups[1]) : await internalsState(cdp);
  check('"Add Tab to Group" lists only the active space\'s groups',
        groups.length === 2 && find(state, 'W1')?.group === find(state, 'W2')?.group && find(state, 'W1')?.grouped &&
        find(state, 'W1')?.space === 'Work' && ordered(state), `${groups.join()} | ${order(state)}`);
  items = await menu('F1');
  check('a favorite offers Remove from Favorites',
        labels(items).includes('Remove from Favorites') && !labels(items).includes('Unpin'), labels(items).join());

  // F1 and a Work tab selected: Pin would pin the Work tab in Work.
  state = await internalsState(cdp);
  await send('activateTab', win, find(state, 'F1').index);
  await send('selectRange', win, find(state, 'W1').index, true);
  items = await menu('F1');
  check('a selection that isn\'t all favorites keeps Pin',
        labels(items).includes('Pin') && !labels(items).some((l) => l.includes('Favorites')),
        labels(items).join());
  state = await internalsState(cdp);
  await send('activateTab', win, find(state, 'W1').index);

  await send('switchSpace', win, ids[undefined] ?? state.spaces.find((s) => s.default).id);
  items = await menu('D1');
  check("a tab of the default space offers Pin and Add to Favorites too",
        labels(items).includes('Pin') && labels(items).filter((l) => l === 'Add to Favorites').length === 1,
        labels(items).join());

  await send('switchSpace', win, ids.Work);
  state = await internalsState(cdp);
  await send('activateTab', win, find(state, 'W1').index);
  state = await menuItem('W1', 'Move to Space', 'Play');
  check('"Move to Space" moves the tab and keeps the window in its space',
        find(state, 'W1')?.space === 'Play' && activeSpace(state) === 'Work' &&
        activeTab(state)?.space === 'Work' && ordered(state), order(state));

  await send('activateTab', win, find(state, 'W4').index);
  await send('selectRange', win, find(state, 'W5').index, false);
  state = await menuItem('W4', 'Move to Space', 'Play');
  check('"Move to Space" moves every selected tab',
        find(state, 'W4')?.space === 'Play' && find(state, 'W5')?.space === 'Play' && ordered(state),
        order(state));

  await send('activateTab', win, find(state, 'W2').index);
  state = await menuItem('W2', 'Add to Favorites');
  check('"Add to Favorites" makes the active tab a favorite and keeps the space',
        find(state, 'W2')?.favorite && find(state, 'W2')?.pinned && !find(state, 'W2')?.grouped &&
        find(state, 'W2')?.active && activeSpace(state) === 'Work' && ordered(state), order(state));
  state = await menuItem('W2', 'Remove from Favorites');
  check('"Remove from Favorites" moves a favorite to the active space',
        !find(state, 'W2')?.pinned && find(state, 'W2')?.space === 'Work' && ordered(state), order(state));

  await send('splitTabs', win, [find(state, 'W2').index, find(state, 'W3').index]);
  state = await internalsState(cdp);
  await send('activateTab', win, find(state, 'W2').index);
  // F1 takes W2's place in the split view, and W2 F1's: they swap spaces.
  state = await menuItem('F1', 'Move Tab into Split View', 'Swap with Left View');
  check('swapping a favorite into a split view swaps the two tabs\' spaces',
        find(state, 'F1')?.space === 'Work' && !find(state, 'F1')?.pinned && find(state, 'F1')?.split &&
        find(state, 'W2')?.favorite && ordered(state), order(state));

  // Leave Work with W6, W7 and W8, then group W7 and W8, the last of Work's
  // tabs, followed by Play's.
  for (const name of ['W6', 'W7', 'W8']) await openTestTab(cdp, name);
  state = await waitForNamedTabs(cdp, ['W6', 'W7', 'W8']);
  state = await menuItem('F1', 'Move to Space', 'Play');
  for (const tab of tabList(state).filter((t) => t.space === 'Work' && !t.name)) {
    await send('tabMenuItem', win, tab.index, ['Move to Space', 'Play']);
  }
  state = await internalsState(cdp);
  await send('groupTabs', win, [find(state, 'W7').index, find(state, 'W8').index]);
  state = await internalsState(cdp);
  await send('activateTab', win, find(state, 'W8').index);
  await send('collapseGroup', win, find(state, 'W8').index);
  state = await internalsState(cdp);
  check("collapsing the active tab's group activates a tab of the active space",
        activeTab(state)?.name === 'W6' && activeSpace(state) === 'Work' && ordered(state), order(state));

  // Move W6 after the collapsed group, so its neighbors are the collapsed W8
  // and Play's first tab, which Chromium's own fallback would pick. Without
  // favorites, the group's tabs are the only others in the space.
  await send('closeTab', win, find(state, 'W2').index);
  state = await internalsState(cdp);
  await send('moveTab', win, find(state, 'W6').index, find(state, 'W8').index);
  state = await internalsState(cdp);
  await send('closeTab', win, find(state, 'W6').index);
  state = await internalsState(cdp);
  check('closing a tab next to a collapsed group stays in the active space',
        ['W7', 'W8'].includes(activeTab(state)?.name) && activeSpace(state) === 'Work' && ordered(state),
        order(state));

  // Dropping tabs on a space's icon: one by one, or a group by its header.
  await send('dropOnSpace', win, [find(state, 'D1').index], ids.Play, false);
  await sleep(500);
  state = await internalsState(cdp);
  check("tabs dropped on a space's icon move there",
        find(state, 'D1')?.space === 'Play' && activeSpace(state) === 'Work' && ordered(state), order(state));
  await send('activateTab', win, find(state, 'W8').index);
  await send('dropOnSpace', win, [find(state, 'W7').index], ids.Play, true);
  await sleep(500);
  state = await internalsState(cdp);
  check("a group dropped on a space's icon moves there whole",
        find(state, 'W7')?.space === 'Play' && find(state, 'W8')?.space === 'Play' && find(state, 'W7')?.grouped &&
        find(state, 'W7')?.group === find(state, 'W8')?.group && activeSpace(state) === 'Work' &&
        activeTab(state)?.space === 'Work' && ordered(state), order(state));
  await close();
}

// Gate 1 in spec.md: three spaces of ten tabs each survive restarts in the
// right spaces, with their pinned state, groups and order, and the window
// comes back in the space it was in.
async function checkRestartAtScale() {
  const profile = newProfile();
  const args = ['--enable-features=HeliumSpaces'];
  let { cdp, close } = await launch(profile, args);
  let state = await internalsState(cdp);
  const win = state.windows[0].session_id;
  const send = (message, ...rest) => internalsSend(cdp, message, rest);
  const find = (state, name) => tabList(state).find((t) => t.name === name);
  const spaceNames = { default: 'D', Work: 'W', Play: 'P' };
  const names = Object.values(spaceNames).flatMap((p) => [...Array(10).keys()].map((i) => p + i));

  await send('addSpace', 'Work');
  await send('addSpace', 'Play');
  state = await internalsState(cdp);
  const ids = Object.fromEntries(state.spaces.map((s) => [s.default ? 'default' : s.name, s.id]));
  // New tabs join the active space, so open each space's tabs while it shows.
  for (const [space, prefix] of Object.entries(spaceNames)) {
    await send('switchSpace', win, ids[space]);
    for (let i = 0; i < 10; i++) await openTestTab(cdp, prefix + i, { background: true });
    state = await waitForNamedTabs(cdp, names.filter((n) => n.startsWith(prefix)));
    // Pins 0 and 1, but makes D0 a favorite, and groups 2 to 4.
    for (const n of [0, 1]) {
      state = await internalsState(cdp);
      if (prefix + n === 'D0') {
        await send('tabMenuCommand', win, find(state, prefix + n).index, 'addToFavorites');
      } else {
        await send('pinTab', win, find(state, prefix + n).index, true);
      }
    }
    state = await internalsState(cdp);
    await send('groupTabs', win, [2, 3, 4].map((n) => find(state, prefix + n).index));
  }
  await send('switchSpace', win, ids.Work);
  state = await internalsState(cdp);
  await send('activateTab', win, find(state, 'W5').index);

  // Each test tab's space, pinned state and group (named by its first tab),
  // in tab strip order.
  const snapshot = (state) => {
    const tabs = tabList(state).filter((t) => t.name);
    const groupName = new Map();
    for (const t of tabs) if (t.grouped && !groupName.has(t.group)) groupName.set(t.group, t.name);
    return tabs.map((t) => `${t.name}:${t.space}${t.pinned ? ':pinned' : ''}${t.grouped ? ':' + groupName.get(t.group) : ''}`).join(' ');
  };
  const ordered = (state) => state.windows.every((w) => w.order_ok && w.order_fixes === 0);
  const active = (state) => tabList(state).find((t) => t.active)?.name;
  state = await internalsState(cdp);
  const before = snapshot(state);
  check('30 tabs in three spaces, with favorites, space-pinned tabs and groups',
        tabList(state).filter((t) => t.name).length === 30 && ordered(state) &&
        ['D0', 'D1', 'W0', 'W1', 'P0', 'P1'].every((n) => find(state, n)?.pinned) &&
        find(state, 'D0')?.favorite && find(state, 'D1')?.space === 'default' &&
        ['D', 'W', 'P'].every((p) => find(state, p + 2)?.grouped && find(state, p + 2)?.group === find(state, p + 4)?.group) &&
        activeSpace(state) === 'Work' && active(state) === 'W5', before);
  await close({ waitForSessionSave: true });

  // Restored tabs are rewritten without our hook on a later restart, so do two.
  for (const which of ['a restart', 'a second restart']) {
    ({ cdp, close } = await launch(profile, [...args, '--restore-last-session'], undefined, INTERNALS));
    state = await waitForNamedTabs(cdp, names);
    check(`30 tabs keep their space, pin, group and order after ${which}`,
          snapshot(state) === before && ordered(state), snapshot(state));
    check(`the window comes back in Work, on W5, after ${which}`,
          activeSpace(state) === 'Work' && active(state) === 'W5',
          `active space ${activeSpace(state)}, active tab ${active(state)}`);
    await close({ waitForSessionSave: true });
  }
}

// A local site for the isolation checks. /show?tag=X answers with a page
// titled "X|<the cookies it was sent>|<a request count>", the count telling a
// reloaded page from one restored with its old title; /set?c=a=1 and
// /setsession set a persistent and a session cookie, in a page titled
// "set a=1|"; /go navigates the page by script; /redirect answers
// with a redirect; /popup opens /show in a new window, with or without an
// opener; /blank clicks a target=_blank link to /show.
function startSite() {
  let requests = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const q = (name) => url.searchParams.get(name) ?? '';
    const page = (title, body = '') => {
      // Uncached, so that a restored tab asks again, with its cookies.
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      res.end(`<title>${title}</title>${body}`);
    };
    switch (url.pathname) {
      case '/show': return page(`${q('tag')}|${req.headers.cookie ?? ''}|${++requests}`);
      case '/set':
        res.setHeader('set-cookie', `${q('c')}; Max-Age=86400; Path=/`);
        return page(`set ${q('c')}|`);
      case '/setsession':
        res.setHeader('set-cookie', `${q('c')}; Path=/`);
        return page(`set ${q('c')}|`);
      case '/go': return page('go', `<script>location.href = ${JSON.stringify(q('to'))};</script>`);
      case '/redirect':
        res.writeHead(302, { location: q('to') });
        return res.end();
      case '/popup': return page('popup', `<script>window.open(${JSON.stringify('/show?tag=' + q('tag'))}, '_blank', ${JSON.stringify(q('mode') === 'noopener' ? 'noopener' : '')});</script>`);
      case '/blank': return page('blank', `<a id="a" target="_blank" href="/show?tag=${q('tag')}">a</a><script>document.getElementById('a').click();</script>`);
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Phase 5 spike, `docs/spaces/spikes/space-isolation.md`: Work keeps its tabs
// in its own storage partition, and the default space doesn't.
async function checkIsolation() {
  const server = await startSite();
  const port = server.address().port;
  const site = `http://127.0.0.1:${port}`;
  const other = `http://localhost:${port}`;
  const profile = newProfile();
  const args = ['--enable-features=HeliumSpaces', '--disable-popup-blocking'];
  try {
    let { cdp, close } = await launch(profile, args);
    let state = await internalsState(cdp);
    const win = state.windows[0].session_id;
    const send = (message, ...rest) => internalsSend(cdp, message, rest);
    const tabs = (state) => state.windows.flatMap((w) => w.tabs.map((t) => ({ ...t, window: w.session_id })));
    // The tab whose /show page has `tag`, once it has loaded, and loaded
    // again if `before` is the tab as it was.
    const shown = (state, tag) => tabs(state).find((t) => t.title.startsWith(`${tag}|`));
    const waitForShown = async (tag, before = undefined) => {
      for (let i = 0; i < 40; i++) {
        state = await internalsState(cdp);
        const tab = shown(state, tag);
        if (tab && tab.title !== before?.title) return tab;
        await sleep(250);
      }
      return undefined;
    };
    const cookies = (tab) => tab?.title.split('|')[1] ?? '(not loaded)';
    const inWorkPartition = (tab) => !!tab && tab.partition.startsWith('heliumspace');
    const open = (url) => send('openLink', win, url, true);

    await send('addSpace', 'Work');
    state = await internalsState(cdp);
    const work = state.spaces.find((s) => s.name === 'Work').id;
    await send('setIsolation', work, true);

    // Default space first: its cookie must never reach Work.
    await open(`${site}/set?c=d=1`);
    await waitForShown('set d=1');
    await send('switchSpace', win, work);
    await open(`${site}/set?c=w=1`);
    await waitForShown('set w=1');
    await open(`${site}/setsession?c=s=1`);
    await waitForShown('set s=1');
    await open(`${site}/show?tag=W1`);
    let tab = await waitForShown('W1');
    check('a new tab of an isolated space opens in its own partition', inWorkPartition(tab), tab?.partition);
    check("an isolated space sees only its own cookies", cookies(tab) === 'w=1; s=1' || cookies(tab) === 's=1; w=1', cookies(tab));

    const defaultSpace = state.spaces.find((s) => s.default).id;
    await send('switchSpace', win, defaultSpace);
    await open(`${site}/show?tag=D1`);
    tab = await waitForShown('D1');
    check("the default space doesn't see an isolated space's cookies, nor it the default's",
          tab?.partition === '' && cookies(tab) === 'd=1', `${tab?.partition} ${cookies(tab)}`);

    await send('switchSpace', win, work);
    const show = (tag) => encodeURIComponent(`${site}/show?tag=${tag}`);
    await open(`${other}/go?to=${encodeURIComponent(`${site}/redirect?to=`)}${show('W2')}`);
    tab = await waitForShown('W2');
    check('a cross-site navigation and a redirect stay in the partition',
          inWorkPartition(tab) && cookies(tab).includes('w=1'), `${tab?.partition} ${cookies(tab)}`);

    for (const [tag, path, what] of [['W3', 'popup?mode=noopener&', 'a noopener popup'],
                                     ['W4', 'popup?mode=opener&', 'a popup with an opener'],
                                     ['W5', 'blank?', 'a target=_blank link']]) {
      await open(`${site}/${path}tag=${tag}`);
      tab = await waitForShown(tag);
      check(`${what} stays in the partition`, inWorkPartition(tab) && cookies(tab).includes('w=1'),
            `${tab?.partition} ${cookies(tab)}`);
    }

    // Restore: the tab comes back in Work's partition with the persistent
    // cookie. Session cookies of other partitions aren't kept across a restart
    // (a v1 hook); record what happens without failing.
    const beforeRestart = { W1: shown(state, 'W1'), D1: shown(state, 'D1') };
    await close({ waitForSessionSave: true });
    ({ cdp, close } = await launch(profile, [...args, '--restore-last-session'], undefined, INTERNALS));
    // A restored tab loads once it is activated.
    const loadRestored = async (tag) => {
      state = await internalsState(cdp);
      const restored = tabs(state).find((t) => t.url.endsWith(`/show?tag=${tag}`));
      if (restored) await send('activateTab', restored.window, restored.index);
      return waitForShown(tag, beforeRestart[tag]);
    };
    tab = await loadRestored('W1');
    check("a restored tab of an isolated space is back in its partition, with its cookies",
          inWorkPartition(tab) && cookies(tab).includes('w=1') && !cookies(tab).includes('d=1'),
          `${tab?.partition} ${cookies(tab)}`);
    console.log(`NOTE  session cookie after a restart in an isolated space: ${cookies(tab).includes('s=1') ? 'kept' : 'lost'}`);
    tab = await loadRestored('D1');
    check('a restored tab of the default space stays in the default partition',
          tab?.partition === '' && cookies(tab) === 'd=1', `${tab?.partition} ${cookies(tab)}`);

    state = await internalsState(cdp);
    tab = tabs(state).find((t) => t.url.endsWith('/show?tag=W2'));
    await send('closeTab', tab.window, tab.index);
    await sleep(500);
    await send('reopenClosedTab', tab.window);
    tab = await waitForShown('W2');
    check('a reopened tab of an isolated space is back in its partition', inWorkPartition(tab), tab?.partition);
    await close();
  } finally {
    server.close();
  }
}

// SPACES_SMOKE_ONLY=checkOrder runs one section; SPACES_SMOKE_STDERR=1 shows
// the browser's stderr.
const sections = { checkFlagOff, checkDefaultSpace, checkTabSpaces, checkSwitching, checkOrder, checkMovesInSpace, checkSpaceCommands, checkRestartAtScale, checkIsolation };
try {
  for (const [name, section] of Object.entries(sections)) {
    if (!process.env.SPACES_SMOKE_ONLY || process.env.SPACES_SMOKE_ONLY === name) await section();
  }
} catch (err) {
  check('smoke run', false, err.message);
} finally {
  // A failed check can leave a browser running.
  for (const browser of browsers) if (browser.exitCode === null) browser.kill('SIGKILL');
  for (const dir of profiles) rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
