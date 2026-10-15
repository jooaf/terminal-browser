const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { once } = require("node:events");
const { hintOptions } = require("./hint-fixtures.cjs");

module.exports = async function checkChrome(contents) {
  const native = path.resolve(__dirname, `../../pixel/packages/native/${process.platform}-${process.arch}/pixel.node`);
  if (!fs.existsSync(native)) {
    console.log("Native chrome checks skipped: build pixel's native module to enable them");
    return;
  }
  const React = require("react");
  const { createRoot, Box } = require("../../pixel/packages/pixel/dist/react/index.js");
  const { RootContext, ViewRegistry } = require("../../pixel/packages/pixel/dist/registry.js");
  const { ChromeHintsContext } = require("../dist/ui/hints.js");
  const { ChromeHints } = require("../dist/hints/chrome.js");
  const { Hints } = require("../dist/hints/hints.js");
  const { TabStrip } = require("../dist/ui/tab-strip.js");
  const { PageContextMenu } = require("../dist/ui/context-menu.js");
  const { makeTheme } = require("../dist/ui/theme.js");
  const h = React.createElement;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hint-ui-"));
  const socket = path.join(dir, "host.sock");
  const worker = new Worker(`
    const net = require('node:net');
    const { parentPort, workerData } = require('node:worker_threads');
    let control;
    parentPort.on('message', (message) => control?.write(JSON.stringify(message) + '\\n'));
    net.createServer((connection) => {
      let buffer = '', streamId;
      const send = (message) => connection.write(JSON.stringify(message) + '\\n');
      connection.on('error', () => {});
      connection.on('data', (data) => {
        buffer += data;
        while (buffer.includes('\\n')) {
          const end = buffer.indexOf('\\n');
          const message = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (message.type === 'join') {
            control = connection;
            send({ type: 'init', cols: 80, rows: 30, width: 800, height: 600,
              cell: [10, 20], imageId: 77, focused: true });
          } else if (message.method === 'pane.graphics.info') {
            send({ id: message.id, result: { cell_width_px: 10, cell_height_px: 20, pane_visible: true,
              file_frame_directory: workerData.dir, file_frame_formats: ['bgra'], file_frame_transport: 'direct-kitty' } });
          } else if (message.method === 'pane.graphics.stream') {
            streamId = message.id;
            send({ id: streamId, result: { type: 'ok' } });
          } else if (streamId) send({ id: streamId, result: { type: 'pane_graphics_frame_ack' } });
        }
      });
    }).listen(workerData.socket, () => parentPort.postMessage('ready'));
  `, { eval: true, workerData: { socket, dir } });
  let root;
  let registry;
  let activeHints;
  let keyHandler;
  const keyEvents = [];
  const pastes = [];
  const until = async (condition) => {
    const end = Date.now() + 5000;
    while (!condition()) {
      assert.ok(Date.now() < end, "Native controls did not finish layout");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    await once(worker, "message");
    root = createRoot({
      host: { socket, pane: "hints-test", name: "hints-test" }, devtools: false,
      onLayout: (snapshot) => registry?.layout.set(snapshot), onEngineExit() {},
      onKey(event) {
        keyEvents.push(event);
        if (activeHints) activeHints.handleKey(event);
        else keyHandler?.(event);
      },
      onPaste: (text) => pastes.push(text),
    });
    registry = new ViewRegistry(root, 1, false, { quit() {} });
    const fontReady = root.registerFont(path.resolve(__dirname, "../../assets/fonts/JetBrainsMono-Regular.ttf"));
    worker.postMessage({ type: "focus", focused: true });
    const font = await fontReady;
    const chrome = new ChromeHints();
    const theme = makeTheme(root.info.colors);
    const events = [];
    const actions = {
      urlEdit: () => events.push("url"), tabSwitch: (id) => events.push(`switch:${id}`),
      tabClose: (id) => events.push(`close:${id}`), tabNew: () => events.push("new"),
      pageMenuClose() {}, pageMenuAction: (id) => events.push(`menu:${id}`),
    };
    const viewport = { x: 0, y: 0, width: 800, height: 600 };
    const tabs = [1, 2].map((id) => ({ id, title: `Tab ${id}`, favicon: null, active: id === 1, agentControlled: false }));
    function render(menu = false) {
      root.render(h(RootContext.Provider, { value: registry },
        h(ChromeHintsContext.Provider, { value: chrome },
          h(Box, { style: { width: 800, height: 600, font } },
            h(Box, { style: { width: 800, height: 40 } },
              h(TabStrip, { tabs, actions, rem: 16, width: 800, url: "https://example.com", theme })),
            menu === true ? h(PageContextMenu, {
              view: { x: 500, y: 40, items: [
                { id: "settings", label: "Settings", enabled: true, shortcut: "" },
                { id: "disabled", label: "Disabled", enabled: false, shortcut: "" },
              ] }, actions, layout: { width: 800, height: 600, rem: 16 }, theme,
            }) : menu || null))));
    }
    render();
    await until(() => chrome.targets("toolbar", viewport).length === 5);
    assert.deepEqual(chrome.targets("toolbar", viewport).map((target) => target.id).sort(), [
      "tab.1.close", "tab.1.select", "tab.2.close", "tab.2.select", "tab.new",
    ]);
    const view = { webContents: contents, focus: () => contents.focus(), cdp: (method, params) => contents.debugger.sendCommand(method, params) };
    const key = (name) => ({ key: name, kind: "press", mods: { ctrl: false, alt: false, super: false, shift: false } });
    async function settle() {
      let previous, stable = 0;
      await until(() => {
        const current = JSON.stringify(chrome.targets(chrome.scope, viewport).map((target) => [target.id, target.rect()]));
        stable = current === previous ? stable + 1 : 0;
        previous = current;
        return stable >= 5;
      });
    }
    async function start(scope = chrome.scope) {
      root.setInputCapture(true);
      const hints = new Hints(view, {
        closed() { activeHints = null; root.setInputCapture(false); },
        notify(message) { throw new Error(message); },
      }, hintOptions({ chrome, viewport, scope }));
      activeHints = hints;
      hints.start();
      await hints.queue;
      return hints;
    }
    async function activate(id, scope = chrome.scope) {
      const hints = await start(scope);
      const label = chrome.snapshot().labels.get(id);
      assert.ok(label, `${id} must have a label`);
      const before = events.length;
      for (const letter of label) hints.handleKey(key(letter));
      await hints.queue;
      assert.equal(chrome.snapshot().selected, id);
      assert.equal(await contents.executeJavaScript("document.querySelectorAll('[popover=manual]').length"), 0);
      assert.equal(events.length, before);
      hints.handleKey(key("enter"));
      await hints.queue;
      assert.equal(chrome.snapshot().active, false);
      await settle();
    }
    await activate("tab.2.select");
    await activate("tab.2.close");
    await activate("tab.new");
    assert.deepEqual(events, ["switch:2", "close:2", "new"]);
    render(true);
    await until(() => chrome.targets("menu", viewport).length === 1);
    await activate("menu.settings", "menu");
    assert.equal(events.at(-1), "menu:settings");
    await require("./settings-hints.electron.cjs")({
      root, chrome, viewport, theme, dir, render, activate, start, until, key,
      keyEvents, pastes, send: (message) => worker.postMessage(message),
      setKeyHandler: (handler) => { keyHandler = handler; },
    });
    console.log("Native chrome and Settings hint checks passed");
  } finally {
    root?.stop();
    await worker.terminate();
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
