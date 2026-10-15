const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { test } = require("node:test");
const { Hints } = require("../dist/hints/hints.js");
const { hintLabels } = require("../dist/hints/page.js");
const { parseChord } = require("shared");
const { alphabet, hintOptions, chromeTarget } = require("./hint-fixtures.cjs");

const press = (key, overrides = {}) => ({
  key, kind: "press", mods: { ctrl: false, alt: false, super: false, shift: false }, ...overrides,
});
const tick = () => new Promise(setImmediate);

function fixture(results = [], options = hintOptions()) {
  const contents = new EventEmitter();
  const scripts = [];
  const input = [];
  const notices = [];
  let closed = 0;
  let focused = 0;
  contents.isDestroyed = () => false;
  contents.executeJavaScriptInIsolatedWorld = async (world, [{ code }]) => {
    assert.equal(world, 1014);
    scripts.push(code);
    return typeof results[0] === "function" ? results.shift()() : results.shift() ?? { mode: "idle" };
  };
  const view = {
    webContents: contents,
    popupOpen: false,
    focus: () => focused++,
    cdp: async (method, params) => input.push({ method, ...params }),
  };
  const hints = new Hints(view, { closed: () => closed++, notify: (text) => notices.push(text) }, options);
  return { hints, view, contents, scripts, input, notices, options, closed: () => closed, focused: () => focused };
}

test("Settings hints never execute page scripts, and layer changes or scrolling cancel them", async () => {
  for (const invalidate of [
    (chrome) => chrome.enterScope("dropdown"),
    (chrome) => chrome.invalidate(),
  ]) {
    const options = hintOptions({ scope: "settings" });
    options.chrome.enterScope("settings");
    const f = fixture([], options);
    f.options.chrome.register(chromeTarget("setting", { scope: "settings" }));
    f.hints.start();
    await f.hints.queue;
    assert.equal(f.options.chrome.snapshot().labels.size, 1);
    invalidate(f.options.chrome);
    await f.hints.queue;
    assert.equal(f.closed(), 1);
    assert.deepEqual(f.scripts, []);
    assert.deepEqual(f.input, []);
    f.options.chrome.invalidate();
    assert.equal(f.closed(), 1);
  }
});

test("popup windows cannot leave hints targeting the covered page", async () => {
  const f = fixture();
  f.view.popupOpen = true;
  f.hints.start();
  await f.hints.queue;
  assert.equal(f.closed(), 1);
  assert.match(f.notices[0], /Close the popup window/);
  assert.deepEqual(f.scripts, []);
  const opened = fixture([{ mode: "hints", count: 1 }]);
  opened.hints.start();
  await opened.hints.queue;
  opened.contents.emit("did-create-window");
  assert.equal(opened.closed(), 1);
  assert.equal(opened.contents.listenerCount("did-create-window"), 0);
});

test("labels are unique, home-row-only and prefix-free across size boundaries", () => {
  for (const count of [0, 1, 9, 10, 81, 82, 729, 730]) {
    const labels = hintLabels(count, alphabet);
    assert.equal(labels.length, count);
    assert.equal(new Set(labels).size, count);
    assert.ok(labels.every((label) => [...label].every((key) => alphabet.includes(key))));
    assert.ok(labels.every((label) => label.length === labels[0].length));
  }
  assert.deepEqual(hintLabels(3, alphabet), ["a", "s", "d"]);
  assert.deepEqual(hintLabels(10, alphabet).slice(0, 3), ["aa", "as", "ad"]);
  assert.deepEqual(hintLabels(3, "jk"), ["jj", "jk", "kj"]);
  for (const invalid of ["", "a", "aa", "a1", "AS"]) assert.throws(() => hintLabels(3, invalid));
});

test("selecting a label only hovers; Enter sends a single click then closes", async () => {
  const point = { x: 42, y: 64 };
  const f = fixture([{ mode: "hints", count: 1 }, { mode: "hover", point }, { mode: "hover", point }]);
  f.hints.start();
  f.hints.handleKey(press("a"));
  await tick();
  assert.deepEqual(f.input, [{ method: "Input.dispatchMouseEvent", type: "mouseMoved", ...point }]);
  assert.equal(f.closed(), 0);
  f.hints.handleKey(press("enter"));
  f.hints.handleKey(press("enter", { kind: "repeat" }));
  f.hints.handleKey(press("enter", { kind: "release" }));
  await tick();
  assert.deepEqual(f.input.map((event) => event.type ?? event.method), [
    "mouseMoved", "Emulation.setFocusEmulationEnabled", "mousePressed", "mouseReleased",
  ]);
  assert.equal(f.focused(), 1);
  assert.equal(f.closed(), 1);
  assert.equal(f.contents.listenerCount("did-start-navigation"), 0);
});

test("Escape during discovery prevents a late result from moving or clicking", async () => {
  let resolve;
  const f = fixture([() => new Promise((done) => { resolve = done; })]);
  f.hints.start();
  await tick();
  f.hints.handleKey(press("a"));
  f.hints.handleKey(press("escape"));
  resolve({ mode: "hints", count: 1 });
  await tick();
  assert.equal(f.closed(), 1);
  assert.deepEqual(f.input, []);
  assert.equal(f.scripts.length, 2);
  assert.match(f.scripts[1], /"type":"stop"/);
});

test("Escape cancels in-flight selection and click validation", async () => {
  for (const pending of ["selection", "click"]) {
    let resolve;
    const point = { x: 1, y: 2 };
    const delayed = () => new Promise((done) => { resolve = done; });
    const results = [{ mode: "hints", count: 1 }];
    if (pending === "click") results.push({ mode: "hover", point });
    results.push(delayed);
    const f = fixture(results);
    f.hints.start();
    f.hints.handleKey(press("a"));
    if (pending === "click") f.hints.handleKey(press("enter"));
    await tick();
    f.hints.handleKey(press("escape"));
    resolve({ mode: "hover", point });
    await tick();
    assert.equal(f.closed(), 1);
    assert.equal(f.input.some((event) => event.type === "mousePressed"), false);
    if (pending === "selection") assert.deepEqual(f.input, []);
  }
});

test("empty pages and missing targets release hint mode without clicking", async () => {
  const empty = fixture([{ mode: "idle" }]);
  empty.hints.start();
  await tick();
  assert.equal(empty.closed(), 1);
  assert.match(empty.notices[0], /No visible targets/);

  const stale = fixture([{ mode: "hints", count: 1 }, { mode: "hover", point: { x: 1, y: 2 } }, { mode: "idle" }]);
  stale.hints.start();
  stale.hints.handleKey(press("a"));
  stale.hints.handleKey(press("enter"));
  await tick();
  assert.equal(stale.closed(), 1);
  assert.deepEqual(stale.input.map((event) => event.type ?? event.method), ["mouseMoved", "Emulation.setFocusEmulationEnabled"]);
  assert.match(stale.notices[0], /Target changed/);
});

test("navigation and renderer teardown cancel and detach listeners", async () => {
  for (const event of ["did-start-navigation", "destroyed", "render-process-gone"]) {
    const f = fixture([{ mode: "hints", count: 1 }]);
    f.hints.start();
    await tick();
    if (event === "did-start-navigation") {
      f.contents.emit(event, { isMainFrame: false });
      assert.equal(f.closed(), 0);
    }
    f.contents.emit(event, { isMainFrame: true });
    await tick();
    assert.equal(f.closed(), 1);
    assert.equal(f.contents.listenerCount(event), 0);
  }
});

test("in-page navigation cancels only for the main frame", async () => {
  const f = fixture([{ mode: "hints", count: 1 }]);
  f.hints.start();
  await tick();
  f.contents.emit("did-navigate-in-page", {}, "https://example.com/#child", false);
  assert.equal(f.closed(), 0);
  f.contents.emit("did-navigate-in-page", {}, "https://example.com/#main", true);
  await tick();
  assert.equal(f.closed(), 1);
  assert.equal(f.contents.listenerCount("did-navigate-in-page"), 0);
});

test("script failures restore normal input and report the error", async () => {
  const f = fixture([() => Promise.reject(new Error("renderer unavailable"))]);
  f.hints.start();
  await tick();
  assert.equal(f.closed(), 1);
  assert.match(f.notices[0], /renderer unavailable/);
});

test("typing is serialized, while modifiers and unrelated keys are ignored", async () => {
  const f = fixture(Array.from({ length: 4 }, () => ({ mode: "hints", count: 10 })));
  f.hints.start();
  f.hints.handleKey(press("enter"));
  f.hints.handleKey(press("a", { mods: { ctrl: true } }));
  f.hints.handleKey(press("z"));
  f.hints.handleKey(press("a"));
  f.hints.handleKey(press("backspace"));
  f.hints.handleKey(press("s"));
  await tick();
  assert.equal(f.scripts.length, 4);
  for (const [index, key] of ["a", "backspace", "s"].entries()) {
    assert.ok(f.scripts[index + 1].includes(`"key":"${key}"`));
  }
  assert.deepEqual(f.input, []);
  f.hints.cancel();
});

test("custom click chord wins in hint mode and the old click key does nothing", async () => {
  const point = { x: 42, y: 64 };
  const options = hintOptions({ alphabet: "jk", clickChords: [parseChord("ctrl+j")], clickLabel: "ctrl+j" });
  const f = fixture([{ mode: "hints", count: 1 }, { mode: "hover", point }, { mode: "hover", point }], options);
  f.hints.start();
  f.hints.handleKey(press("j"));
  await tick();
  f.hints.handleKey(press("enter"));
  await tick();
  assert.equal(f.closed(), 0);
  assert.equal(f.hints.accepts(press("j", { mods: parseChord("ctrl+j") })), true);
  assert.equal(options.chrome.snapshot().clickLabel, "ctrl+j");
  f.hints.handleKey(press("j", { mods: parseChord("ctrl+j") }));
  await tick();
  assert.equal(f.closed(), 1);
  assert.equal(f.input.filter((event) => event.type === "mousePressed").length, 1);
});

test("a label letter can also be the click key after hovering", async () => {
  const options = hintOptions({ clickChords: [parseChord("a")] });
  const point = { x: 1, y: 2 };
  const f = fixture([{ mode: "hints", count: 1 }, { mode: "hover", point }, { mode: "hover", point }], options);
  f.hints.start();
  f.hints.handleKey(press("a"));
  await tick();
  assert.equal(f.closed(), 0);
  f.hints.handleKey(press("a"));
  await tick();
  assert.equal(f.closed(), 1);
});

test("chrome labels share page labels and hover before invoking the action", async () => {
  const events = [];
  const options = hintOptions();
  options.chrome.register(chromeTarget("tab.new", {
    hover: () => events.push("hover"), leave: () => events.push("leave"),
    click: () => { assert.equal(options.chrome.snapshot().active, false); events.push("click"); },
  }));
  const f = fixture([{ mode: "hints", count: 3 }, { mode: "hints", count: 3 }], options);
  f.hints.start();
  await tick();
  assert.deepEqual([...options.chrome.snapshot().labels], [["tab.new", "a"]]);
  assert.match(f.scripts[0], /"chromeCount":1/);
  f.hints.handleKey(press("a"));
  await tick();
  assert.deepEqual(events, ["hover"]);
  assert.equal(options.chrome.snapshot().selected, "tab.new");
  f.hints.handleKey(press("enter"));
  await tick();
  assert.deepEqual(events, ["hover", "leave", "click"]);
  assert.deepEqual(f.input, []);
  assert.equal(f.closed(), 1);
});

test("removed chrome targets cannot be activated", async () => {
  const options = hintOptions({ scope: "menu" });
  let clicked = false;
  const unregister = options.chrome.register(chromeTarget("menu.settings", { scope: "menu", click: () => { clicked = true; } }));
  const f = fixture([], options);
  f.hints.start();
  f.hints.handleKey(press("a"));
  await tick();
  unregister();
  f.hints.handleKey(press("enter"));
  await tick();
  assert.equal(clicked, false);
  assert.match(f.notices[0], /Target changed/);
  assert.equal(f.closed(), 1);
  assert.deepEqual(f.scripts, []);
});

test("browser controls remain usable when page discovery fails", async () => {
  const options = hintOptions();
  let clicked = false;
  options.chrome.register(chromeTarget("tab.new", { click: () => { clicked = true; } }));
  const f = fixture([() => Promise.reject(new Error("page unavailable"))], options);
  f.hints.start();
  await tick();
  assert.equal(options.chrome.snapshot().labels.get("tab.new"), "a");
  assert.match(f.notices[0], /browser controls are still available/);
  f.hints.handleKey(press("a"));
  f.hints.handleKey(press("enter"));
  await tick();
  assert.equal(clicked, true);
  assert.equal(f.closed(), 1);
});

test("menu hints exclude covered toolbar and page targets", async () => {
  const options = hintOptions({ scope: "menu" });
  options.chrome.register(chromeTarget("tab.new"));
  options.chrome.register(chromeTarget("menu.settings", { scope: "menu" }));
  const f = fixture([], options);
  f.hints.start();
  await tick();
  assert.deepEqual([...options.chrome.snapshot().labels], [["menu.settings", "a"]]);
  f.hints.cancel();
  await tick();
  assert.deepEqual(f.scripts, []);
  assert.deepEqual(f.input, []);
});

const electronRoot = path.resolve(__dirname, "../../pixel/packages/pixel/electron/dist");
const electron = process.env.ELECTRON_PATH ?? (process.platform === "darwin"
  ? path.join(electronRoot, "Electron.app/Contents/MacOS/pixel")
  : path.join(electronRoot, "electron"));

test("keyboard hints in real Chromium", { skip: !fs.existsSync(electron), timeout: 60000 }, async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const { stdout, stderr } = await promisify(execFile)(electron, [path.join(__dirname, "hints.electron.cjs")], {
    env, timeout: 55000,
  });
  assert.match(stdout, /Keyboard hint browser checks passed/, stderr);
});
