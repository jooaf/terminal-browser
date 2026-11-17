const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { PageHost } = require("../../pixel/packages/pixel/dist/web/host.js");
const { ViewRegistry } = require("../../pixel/packages/pixel/dist/registry.js");
const { Hints } = require("../dist/hints/hints.js");
const { hintOptions } = require("./hint-fixtures.cjs");

module.exports = async function checkTerminalZoom({ root }) {
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><title>Terminal zoom</title><p>Terminal-sized page</p>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/`;
  const info = { ...root.info, width: 800, height: 600, basePx: 24, cellHeight: 30 };
  const registry = new ViewRegistry({ ...root, info }, 1, false, { quit() {} });
  const hosts = [];
  const states = new Map();
  const popupSurfaces = [];
  const layout = { x: 0, y: 0, width: 800, height: 600, scale: 1 };
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
  async function create(path, owner = registry) {
    const state = { scale: owner.displayScale };
    const popupSurface = root.createSurface();
    popupSurfaces.push(popupSurface);
    const host = new PageHost(root.createSurface(), popupSurface, { ...layout, scale: owner.displayScale }, {
      url: url + path, background: "#ffffff", baseZoom: owner.baseZoom,
      clipboardRead: false, proxy: null, browserWindowOptions: {},
    }, (value) => { state.value = value; });
    hosts.push(host);
    states.set(host, state);
    owner.register({ host });
    const loaded = once(host.webContents, "did-finish-load");
    await host.attachCdp();
    await loaded;
    return host;
  }
  async function expectZoom(host, base, factor, width = 800) {
    near(host.webContents.getZoomFactor(), base * factor);
    near(states.get(host).value.zoom, factor);
    await expectViewport(host.webContents, base * factor, width, states.get(host).scale);
  }
  async function expectViewport(contents, factor, width, scale = 1) {
    const deadline = Date.now() + 5000;
    while (true) {
      const viewport = await contents.executeJavaScript("({ width: innerWidth, scale: devicePixelRatio })");
      if (Math.abs(viewport.width - width / (scale * factor)) <= 1
        && Math.abs(viewport.scale - scale * factor) < 1e-6) return;
      assert.ok(Date.now() < deadline, `Viewport did not follow zoom: ${JSON.stringify(viewport)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  function resize(measurements) {
    Object.assign(info, measurements);
    registry.syncZoom();
  }
  try {
    const first = await create("first");
    await expectZoom(first, 1.5, 1);
    first.zoom(1);
    await expectZoom(first, 1.5, 1.1);
    first.zoom(0);
    await expectZoom(first, 1.5, 1);

    const second = await create("second");
    first.zoom(1);
    first.zoom(1);
    await expectZoom(second, 1.5, 1);
    second.zoom(-1);
    resize({ height: 800, cellHeight: 40, basePx: 32 });
    await expectZoom(first, 2, 1.25);
    await expectZoom(second, 2, 0.9);
    resize({ height: 400, width: 600 });
    first.resize({ ...layout, width: 600, height: 400 });
    await expectZoom(first, 2, 1.25, 600);
    first.resize(layout);

    for (const host of hosts) host.setVisible(false);
    resize({ width: 0, height: 0, cellHeight: 0, basePx: 6 });
    assert.equal(registry.baseZoom, 2);
    resize({ width: 800, height: 600, cellHeight: 30, basePx: 24 });
    for (const host of hosts) host.setVisible(true);
    await expectZoom(first, 1.5, 1.25);
    await expectZoom(second, 1.5, 0.9);

    const third = await create("third");
    await expectZoom(third, 1.5, 1);
    const otherRegistry = new ViewRegistry({ ...root, info: { ...info, basePx: 64 } }, 2, false, { quit() {} });
    const other = await create("other-terminal", otherRegistry);
    await expectZoom(other, 2, 1);
    await first.webContents.loadURL("data:text/html," + encodeURIComponent(`<button style="position:absolute;left:60px;top:80px;width:80px;height:30px" onclick="document.body.dataset.clicked='yes'">Target</button>`));
    await expectZoom(first, 1.5, 1.25);
    const hints = new Hints({
      webContents: first.webContents, focus: () => first.focusContent(),
      cdp: (method, params) => first.cdp(method, params),
    }, { closed() {}, notify() {} }, hintOptions());
    const press = (key) => ({ key, kind: "press", mods: { ctrl: false, alt: false, super: false, shift: false } });
    hints.start();
    hints.handleKey(press("a"));
    await hints.queue;
    hints.handleKey(press("enter"));
    await hints.queue;
    assert.equal(await first.webContents.executeJavaScript("document.body.dataset.clicked"), "yes");
    hints.cancel();
    first.zoom(1);
    first.onOpenWindow = "popup";
    const created = once(first.webContents, "did-create-window");
    await first.webContents.executeJavaScript("void window.open('about:blank')");
    const [popup] = await created;
    popup.webContents.stopPainting();
    await popup.loadURL(url + "popup");
    near(popup.webContents.getZoomFactor(), 1.5 * 1.5);
    await expectViewport(popup.webContents, 1.5 * 1.5, first.popup.state.width);
    resize({ basePx: 24.12 });
    near(popup.webContents.getZoomFactor(), 1.5075 * 1.5);
    await expectViewport(popup.webContents, 1.5075 * 1.5, first.popup.state.width);
    await expectZoom(second, 1.5075, 0.9);
    await expectZoom(third, 1.5075, 1);
    await expectZoom(other, 2, 1);
    await expectZoom(first, 1.5075, 1.5);
    first.zoom(0);
    await expectZoom(first, 1.5075, 1);
    for (let i = 0; i < 25; i++) first.zoom(1);
    await expectZoom(first, 1.5075, 5 / 1.5075);
    first.zoom(0);
    console.log("Terminal baseline, user zoom, shared-origin tabs, resize/restore and popup checks passed");
  } finally {
    for (const host of hosts) host.stop();
    for (const surface of popupSurfaces) surface.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};
