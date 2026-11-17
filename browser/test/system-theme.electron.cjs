const assert = require("node:assert/strict");
const { once } = require("node:events");
const { nativeTheme } = require("electron");
const { PageHost } = require("../../pixel/packages/pixel/dist/web/host.js");

module.exports = async function checkSystemTheme({ root }) {
  const previous = nativeTheme.themeSource;
  const hosts = [];
  const popupSurfaces = [];
  const page = `<!doctype html><style>
    :root { color-scheme: light dark; }
    body { background: white; color: black; }
    @media (prefers-color-scheme: dark) { body { background: black; color: white; } }
  </style><script>
    window.themeChanges = [];
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => themeChanges.push(event.matches));
  </script><p>System theme test</p>`;
  const url = "data:text/html;charset=utf-8," + encodeURIComponent(page);
  async function create(background) {
    const popupSurface = root.createSurface();
    popupSurfaces.push(popupSurface);
    const host = new PageHost(root.createSurface(), popupSurface,
      { x: 0, y: 0, width: 400, height: 300, scale: 1 },
      { url: "about:blank", background, baseZoom: 1, clipboardRead: false, proxy: null, browserWindowOptions: {} },
      () => {});
    hosts.push(host);
    await host.attachCdp();
    await host.webContents.loadURL(url);
    return host;
  }
  async function expectTheme(contents, dark, changes) {
    const deadline = Date.now() + 5000;
    while (true) {
      const state = await contents.executeJavaScript(`({
        dark: matchMedia('(prefers-color-scheme: dark)').matches,
        background: getComputedStyle(document.body).backgroundColor,
        changes: themeChanges
      })`);
      if (state.dark === dark
        && state.background === (dark ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)")
        && (changes === undefined || JSON.stringify(state.changes) === JSON.stringify(changes))) return;
      assert.ok(Date.now() < deadline, `Expected system ${dark ? "dark" : "light"}, got ${JSON.stringify(state)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    nativeTheme.themeSource = "dark";
    const main = await create("#ffffff");
    await expectTheme(main.webContents, true);
    await main.webContents.executeJavaScript(`new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.onload = () => resolve();
      frame.srcdoc = ${JSON.stringify(page)};
      document.body.append(frame);
    })`);
    assert.equal(await main.webContents.executeJavaScript("document.querySelector('iframe').contentWindow.matchMedia('(prefers-color-scheme: dark)').matches"), true);

    main.onOpenWindow = "popup";
    const created = once(main.webContents, "did-create-window");
    await main.webContents.executeJavaScript("void window.open('about:blank')");
    const [popup] = await created;
    popup.webContents.stopPainting();
    await popup.loadURL(url);
    await expectTheme(popup.webContents, true);

    nativeTheme.themeSource = "light";
    await expectTheme(main.webContents, false);
    await expectTheme(popup.webContents, false);
    main.setBackground("#000000");
    await expectTheme(main.webContents, false);
    assert.equal(await main.webContents.executeJavaScript("document.querySelector('iframe').contentWindow.matchMedia('(prefers-color-scheme: dark)').matches"), false);
    const second = await create("#000000");
    await expectTheme(second.webContents, false);

    nativeTheme.themeSource = "dark";
    for (const host of hosts) await expectTheme(host.webContents, true);
    await expectTheme(popup.webContents, true);
    main.setBackground("#ffffff");
    await expectTheme(main.webContents, true, [false, true]);

    nativeTheme.themeSource = "system";
    for (const host of hosts) await expectTheme(host.webContents, nativeTheme.shouldUseDarkColors);
    await expectTheme(popup.webContents, nativeTheme.shouldUseDarkColors);
    console.log("System appearance, live changes, new tabs, iframes and popups checks passed");
  } finally {
    for (const host of hosts) host.stop();
    for (const surface of popupSurfaces) surface.close();
    nativeTheme.themeSource = previous;
  }
};
