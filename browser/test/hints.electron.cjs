const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");
const { Hints } = require("../dist/hints/hints.js");
const { hintScript } = require("../dist/hints/page.js");
const { alphabet, hintOptions, chromeTarget } = require("./hint-fixtures.cjs");

let window;
let sequence = 0;
const press = (key) => ({ key, kind: "press", mods: { ctrl: false, alt: false, super: false, shift: false } });

async function run() {
  await app.whenReady();
  window = new BrowserWindow({
    show: false, width: 800, height: 600, paintWhenInitiallyHidden: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  const contents = window.webContents;
  contents.debugger.attach("1.3");
  const cdp = (method, params) => contents.debugger.sendCommand(method, params);
  const js = (source) => contents.executeJavaScript(source);
  const page = (action) => contents.executeJavaScriptInIsolatedWorld(1014, [{ code: hintScript(action) }]);
  const load = async (body) => {
    await contents.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html>
      <style>body { margin: 30px; } [hidden] { display: none !important; } button, input, [role=button] { display: block; width: 160px; height: 36px; margin: 12px; }</style>
      ${body}`));
    await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  };
  const badges = async () => {
    const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
    function find(node) {
      if (node.attributes?.includes("popover") && node.shadowRoots?.length) return node.shadowRoots[0];
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
        const found = find(child);
        if (found) return found;
      }
    }
    const shadow = find(root);
    assert.ok(shadow);
    const { object } = await cdp("DOM.resolveNode", { backendNodeId: shadow.backendNodeId });
    try {
      const { result } = await cdp("Runtime.callFunctionOn", { objectId: object.objectId, returnByValue: true,
        functionDeclaration: `function() { return [...this.querySelectorAll('span')].map(e => ({
          label: e.textContent, visible: !!e.getClientRects().length, background: getComputedStyle(e).backgroundColor
        })); }`,
      });
      return result.value;
    } finally {
      await cdp("Runtime.releaseObject", { objectId: object.objectId });
    }
  };
  const start = async (options = {}) => {
    const id = String(++sequence);
    const result = await page({ type: "start", id, alphabet, chromeCount: 0, ...options });
    return { id, result, key: (key) => page({ type: "key", id, key }), stop: () => page({ type: "stop", id }) };
  };

  await load(`<button id=visible>Visible</button><button hidden>Hidden</button>
    <button disabled>Disabled</button><button style="opacity:0">Transparent</button>
    <div style="opacity:0"><button>Transparent parent</button></div>
    <button style="position:absolute;top:2000px">Off screen</button>
    <button id=covered style="position:absolute;left:300px;top:30px">Covered</button>
    <div style="position:absolute;left:300px;top:30px;width:200px;height:80px;background:black;z-index:10"></div>
    <div id=shadow></div><script>
      shadow.attachShadow({mode:'open'}).innerHTML = '<button style="width:100px;height:30px">Shadow</button>';
    </script>`);
  let session = await start();
  assert.deepEqual(session.result, { mode: "hints", count: 2 });
  assert.deepEqual((await badges()).map(({ label, visible }) => ({ label, visible })), [
    { label: "A", visible: true }, { label: "S", visible: true },
  ]);
  let selected = await session.key("a");
  assert.equal(selected.mode, "hover");
  assert.ok((await badges()).every((badge) => !badge.visible));
  assert.equal(await js(`document.elementFromPoint(${selected.point.x}, ${selected.point.y}).id`), "visible");
  await session.stop();
  session = await start();
  selected = await session.key("s");
  assert.equal(selected.mode, "hover");
  assert.equal(await js(`document.elementFromPoint(${selected.point.x}, ${selected.point.y}).id`), "shadow");
  const replacement = await start();
  await session.stop();
  assert.equal((await replacement.key("a")).mode, "hover");
  await replacement.stop();

  await load(Array.from({ length: 10 }, (_, n) => `<button style="display:inline-block;width:100px">${n}</button>`).join(""));
  session = await start();
  assert.equal(session.result.count, 10);
  assert.equal((await session.key("s")).mode, "hints");
  await session.key("backspace");
  assert.equal((await session.key("a")).mode, "hints");
  assert.equal((await session.key("s")).mode, "hover");
  await session.stop();

  await load(`<button id=target>Target</button>`);
  session = await start();
  await session.key("a");
  await js("target.remove()");
  assert.deepEqual(await page({ type: "point", id: session.id }), { mode: "idle" });

  await load(`<button id=target>Target</button>`);
  session = await start();
  await session.key("a");
  await js("target.style.transform = 'translateX(300px)'");
  assert.deepEqual(await page({ type: "point", id: session.id }), { mode: "idle" });

  await load(`<button id=target>Target</button>`);
  session = await start();
  await session.key("a");
  await js(`const cover = document.createElement('div');
    cover.style = 'position:fixed;inset:0;background:black;z-index:999'; document.body.append(cover);`);
  assert.deepEqual(await page({ type: "point", id: session.id }), { mode: "idle" });

  await load(`<button id=menu>Menu</button><button id=item hidden>Item</button><script>
    window.clicks = 0; window.hovers = 0;
    menu.addEventListener('mouseenter', () => { window.hovers++; item.hidden = false; });
    menu.addEventListener('click', () => window.clicks++);
  </script>`);
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  let closed = 0;
  const notices = [];
  const hints = new Hints({ webContents: contents, focus: () => contents.focus(), cdp }, {
    closed: () => closed++, notify: (message) => notices.push(message),
  }, hintOptions());
  hints.start();
  hints.handleKey(press("a"));
  await hints.queue;
  assert.equal(await js("window.hovers"), 1);
  assert.equal(await js("window.clicks"), 0);
  assert.equal(closed, 0);
  hints.handleKey(press("enter"));
  await hints.queue;
  assert.equal(await js("window.clicks"), 1);
  assert.equal(closed, 1);
  assert.deepEqual(notices, []);
  session = await start();
  assert.equal(session.result.count, 2);
  await session.stop();

  await load(`<button popovertarget=choices>Open</button>
    <div id=choices popover style="position:fixed;inset:40px auto auto 0;margin:0">
      <button role=menuitem>First</button><button id=second role=menuitem>Second</button>
    </div><script>
      window.choice = null; choices.showPopover();
      second.addEventListener('click', () => window.choice = 'second');
    </script>`);
  const popupMenu = new Hints({ webContents: contents, focus: () => contents.focus(), cdp }, {
    closed() {}, notify(message) { throw new Error(message); },
  }, hintOptions());
  popupMenu.start();
  popupMenu.handleKey(press("d"));
  await popupMenu.queue;
  assert.equal(await js("window.choice"), null);
  assert.equal(await js("choices.matches(':popover-open')"), true);
  popupMenu.handleKey(press("enter"));
  await popupMenu.queue;
  assert.equal(await js("window.choice"), "second");

  await load(`<input id=field><script>window.keys = []; document.addEventListener('keydown', e => keys.push(e.key));</script>`);
  const typing = new Hints({ webContents: contents, focus: () => contents.focus(), cdp }, {
    closed() {}, notify(message) { throw new Error(message); },
  }, hintOptions());
  typing.start();
  typing.handleKey(press("a"));
  typing.handleKey(press("enter"));
  await typing.queue;
  assert.equal(await js("document.activeElement.id"), "field");
  assert.deepEqual(await js("window.keys"), []);
  await cdp("Input.insertText", { text: "keyboard only" });
  assert.equal(await js("field.value"), "keyboard only");

  await load(`<button id=outside>Outside</button><dialog id=dialog><button id=inside>Inside</button></dialog>
    <script>dialog.showModal()</script>`);
  session = await start();
  assert.equal(session.result.count, 1);
  selected = await session.key("a");
  assert.equal(await js(`document.elementFromPoint(${selected.point.x}, ${selected.point.y}).id`), "inside");
  await session.stop();

  await load(`<button id=target>Target</button><script>
    window.clicks = 0;
    target.addEventListener('click', () => clicks++);
  </script>`);
  const focusChange = new Hints({ webContents: contents, focus: () => { void js("target.remove()"); }, cdp }, {
    closed() {}, notify() {},
  }, hintOptions());
  focusChange.start();
  focusChange.handleKey(press("a"));
  await focusChange.queue;
  focusChange.handleKey(press("enter"));
  await focusChange.queue;
  assert.equal(await js("window.clicks"), 0);
  assert.equal(await js("document.getElementById('target')"), null);

  await load(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'">
    <button>Restricted page</button>`);
  session = await start();
  assert.equal(session.result.count, 1);
  assert.equal((await badges())[0].background, "rgb(255, 225, 107)");
  await session.stop();

  await load(`<label for=check>Custom checkbox</label><input id=check type=checkbox style="display:none">
    <div role=menuitemcheckbox>Check menu item</div><div role=treeitem>Tree item</div>
    <div aria-haspopup=menu>Hover menu</div>
    <div style="cursor:pointer"><span>First cell</span><span>Second cell</span></div>
    <button style="cursor:pointer"><span>Nested text</span><svg width=10 height=10><path d="M0 0L10 10" /></svg></button>
    <div aria-disabled=true><button>Disabled group</button></div>`);
  session = await start();
  assert.equal(session.result.count, 7);
  selected = await session.key("a");
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...selected.point });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...selected.point, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...selected.point, button: "left", clickCount: 1 });
  assert.equal(await js("check.checked"), true);
  await session.stop();

  await load("<button id=first>First</button><button>Second</button>");
  session = await start({ alphabet: "jk", chromeCount: 2 });
  assert.equal(session.result.count, 4);
  assert.deepEqual((await badges()).map((badge) => badge.label), ["KJ", "KK"]);
  assert.equal((await session.key("k")).mode, "hints");
  selected = await session.key("j");
  assert.equal(selected.mode, "hover");
  assert.equal(await js(`document.elementFromPoint(${selected.point.x}, ${selected.point.y}).id`), "first");
  await session.stop();

  let navigationClosed = 0;
  const navigating = new Hints({ webContents: contents, focus: () => contents.focus(), cdp }, {
    closed: () => navigationClosed++, notify() {},
  }, hintOptions());
  navigating.start();
  await navigating.queue;
  await load("<button>After navigation</button>");
  await navigating.queue;
  assert.equal(navigationClosed, 1);

  await load("<p>No controls</p>");
  assert.deepEqual((await start()).result, { mode: "idle" });
  await require("./chrome-hints.electron.cjs")(contents);
  console.log("Keyboard hint browser checks passed");
}

run().then(() => app.exit(0)).catch((error) => {
  console.error(error);
  app.exit(1);
});
