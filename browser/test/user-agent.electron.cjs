const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { app, BrowserWindow } = require("electron");
const { browserUserAgent } = require("../dist/user-agent.js");

module.exports = async function checkUserAgent() {
  const original = app.userAgentFallback;
  const windows = [];
  const requests = new Map();
  const server = http.createServer((request, response) => {
    requests.set(request.url, request.headers);
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><title>User-agent compatibility test</title>");
  });
  const createWindow = () => {
    const window = new BrowserWindow({ show: false, webPreferences: {
      offscreen: true, sandbox: true, contextIsolation: true, partition: `ua-test-${randomUUID()}`,
    } });
    windows.push(window);
    return window;
  };
  const inspect = (window) => window.webContents.executeJavaScript(`(async () => ({
    userAgent: navigator.userAgent,
    metadata: await navigator.userAgentData.getHighEntropyValues([
      "architecture", "bitness", "model", "platformVersion", "fullVersionList", "uaFullVersion", "wow64", "formFactors"
    ]),
    webdriver: navigator.webdriver,
    language: navigator.language,
    platform: navigator.platform
  }))()`);
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const baseline = createWindow();
    await baseline.loadURL(`${origin}/baseline`);
    const before = await inspect(baseline);
    app.userAgentFallback = browserUserAgent(original);
    const main = createWindow();
    await main.loadURL(`${origin}/main`);
    const expected = { ...before, userAgent: browserUserAgent(before.userAgent) };
    assert.deepEqual(await inspect(main), expected);
    assert.equal(requests.get("/main")["user-agent"], expected.userAgent);
    assert.equal(requests.get("/main")["sec-ch-ua"], requests.get("/baseline")["sec-ch-ua"]);
    assert.doesNotMatch(expected.userAgent, /\b(?:terminal-browser|Electron)\//);
    assert.match(expected.userAgent, /Chrome\/\d/);

    main.webContents.setWindowOpenHandler(() => ({ action: "allow", overrideBrowserWindowOptions: { show: false } }));
    const created = once(main.webContents, "did-create-window");
    await main.webContents.executeJavaScript("void window.open('about:blank')");
    const [popup] = await created;
    windows.push(popup);
    await popup.loadURL(`${origin}/popup`);
    assert.deepEqual(await inspect(popup), expected);
    assert.equal(requests.get("/popup")["user-agent"], expected.userAgent);
    console.log("User-agent HTTP, navigator, client hints and popup checks passed");
  } finally {
    for (const window of windows.reverse()) if (!window.isDestroyed()) window.destroy();
    app.userAgentFallback = original;
    await new Promise((resolve) => server.close(resolve));
  }
};
