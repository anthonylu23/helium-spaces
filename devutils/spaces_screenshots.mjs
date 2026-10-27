// Screenshots of a helium-spaces dev build in every tab layout and space.
// Usage: node --experimental-websocket devutils/spaces_screenshots.mjs [out-dir] [path/to/Helium.app]
// Opens a real (not headless) window on a throwaway profile, so it needs a
// logged-in macOS session, and Screen Recording permission for the terminal
// that runs it (screencapture). Builds this fixture through
// chrome://spaces-internals:
//   default space: F1 (a favorite), D1, and the internals tab
//   Work:          W1, W2 and W3, with W2 and W3 in a tab group
//   Play:          P1 (pinned, so only shown in Play) and P2
// then, for each layout (Classic, Compact, Vertical, Dynamic) and each space,
// saves <out-dir>/<layout>-<space>.png. Look at them: every tab of the space,
// plus F1, should show, and nothing else.

if (typeof WebSocket === 'undefined') {
  console.error('No global WebSocket. Use Node 22+, or run with --experimental-websocket.');
  process.exit(2);
}

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'spaces-screenshots');
const app = resolve(process.argv[3] ?? 'build/src/out/Default/Helium.app');
const INTERNALS = 'chrome://spaces-internals/';
const LAYOUTS = ['classic', 'compact', 'vertical', 'dynamic'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function pageTarget(port) {
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

const profile = mkdtempSync(join(tmpdir(), 'spaces-shots-'));
const port = 9800 + Math.floor(Math.random() * 100);
const browser = spawn(join(app, 'Contents/MacOS/Helium'), [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-mock-keychain',
  '--no-first-run', '--no-default-browser-check', '--enable-features=HeliumSpaces',
  '--window-position=40,60', '--window-size=1100,700', 'about:blank',
], { stdio: 'ignore' });

try {
  mkdirSync(outDir, { recursive: true });
  const target = await pageTarget(port);
  const cdp = session(target.webSocketDebuggerUrl);
  const state = async () => {
    await cdp.send('Page.navigate', { url: INTERNALS });
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      const r = await cdp.send('Runtime.evaluate', {
        expression: "document.getElementById('state')?.textContent ?? ''", returnByValue: true });
      if (r.result?.result?.value) return JSON.parse(r.result.result.value);
    }
    throw new Error('chrome://spaces-internals did not render');
  };
  const send = (message, ...args) =>
    cdp.send('Runtime.evaluate', { expression: `chrome.send(${JSON.stringify(message)}, ${JSON.stringify(args)})` });
  const open = (name) =>
    cdp.send('Target.createTarget', { url: `data:text/html,<title>${name}</title><h1>${name}</h1>`, background: true });
  const index = (s, name) => s.windows[0].tabs.find((t) => t.url.endsWith(`<h1>${name}</h1>`))?.index;

  let s = await state();
  const win = s.windows[0].session_id;
  await send('addSpace', 'Work');
  await send('addSpace', 'Play');
  s = await state();
  const ids = Object.fromEntries(s.spaces.map((sp) => [sp.default ? 'default' : sp.name, sp.id]));

  for (const name of ['F1', 'D1']) await open(name);
  await send('switchSpace', win, ids.Work);
  for (const name of ['W1', 'W2', 'W3']) await open(name);
  await send('switchSpace', win, ids.Play);
  for (const name of ['P1', 'P2']) await open(name);
  await sleep(1500);
  s = await state();
  await send('tabMenuCommand', win, index(s, 'F1'), 'addToFavorites');
  s = await state();
  await send('pinTab', win, index(s, 'P1'), true);
  s = await state();
  await send('groupTabs', win, [index(s, 'W2'), index(s, 'W3')]);
  // Close the New Tab pages that switching to the empty spaces opened.
  s = await state();
  for (const tab of [...s.windows[0].tabs].reverse()) {
    if (tab.url.startsWith('chrome://newtab')) await send('closeTab', win, tab.index);
  }

  const { result: { windowId } } = await cdp.send('Browser.getWindowForTarget', { targetId: target.id });
  for (const [layout, name] of LAYOUTS.entries()) {
    await send('setLayout', win, layout);
    for (const space of ['default', 'Work', 'Play']) {
      await send('switchSpace', win, ids[space]);
      await sleep(1200);
      const { result: { bounds } } = await cdp.send('Browser.getWindowBounds', { windowId });
      const file = join(outDir, `${name}-${space.toLowerCase()}.png`);
      try {
        execFileSync('screencapture', ['-x', '-o', `-R${bounds.left},${bounds.top},${bounds.width},${bounds.height}`, file],
                     { stdio: 'pipe' });
        console.log(file);
      } catch {
        console.log(`${file}: screencapture failed; does this terminal have Screen Recording permission?`);
      }
    }
  }
  // Still alive after every layout and space? Print what each tab is doing.
  const final = await state();
  for (const tab of final.windows[0].tabs) {
    console.log(`${tab.index} ${tab.title.padEnd(28)} pinned=${tab.pinned} grouped=${tab.grouped} shown=${tab.in_active_space}`);
  }
  cdp.send('Browser.close');
} finally {
  await sleep(2000);
  browser.kill('SIGKILL');
  rmSync(profile, { recursive: true, force: true });
}
