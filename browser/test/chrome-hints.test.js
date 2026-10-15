const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ChromeHints } = require("../dist/hints/chrome.js");
const { chromeTarget } = require("./hint-fixtures.cjs");

const viewport = { x: 0, y: 0, width: 800, height: 600 };

test("only measured, visible controls in the current scope receive labels", () => {
  const hints = new ChromeHints();
  hints.register(chromeTarget("new"));
  hints.register(chromeTarget("unmeasured", { rect: () => null }));
  hints.register(chromeTarget("zero", { rect: () => ({ x: 0, y: 0, width: 0, height: 10 }) }));
  hints.register(chromeTarget("outside", { rect: () => ({ x: 900, y: 0, width: 20, height: 20 }) }));
  hints.register(chromeTarget("clipped", { clip: () => ({ x: 100, y: 0, width: 100, height: 50 }) }));
  hints.register(chromeTarget("partly-clipped", { clip: () => ({ x: 15, y: 15, width: 100, height: 50 }) }));
  hints.register(chromeTarget("settings", { scope: "menu" }));
  assert.deepEqual(hints.targets("toolbar", viewport).map((target) => target.id), ["new"]);
  assert.deepEqual(hints.targets("menu", viewport).map((target) => target.id), ["settings"]);
});

test("topmost layers isolate menus and dialogs, and dismiss without closing Settings", () => {
  const hints = new ChromeHints();
  const dismissals = [];
  let changes = 0;
  const unsubscribe = hints.onInvalidated(() => changes++);
  const settings = hints.enterScope("settings", () => dismissals.push("settings"));
  const dropdown = hints.enterScope("dropdown", () => dismissals.push("dropdown"));
  const menu = hints.enterScope("menu", () => dismissals.push("menu"));
  assert.equal(changes, 2);
  assert.equal(hints.scope, "dropdown");
  assert.equal(hints.dismissTop(), true);
  assert.deepEqual(dismissals, ["dropdown"]);
  const shortcut = hints.enterScope("shortcut");
  assert.equal(hints.scope, "shortcut");
  assert.equal(hints.dismissTop(), false);
  shortcut();
  dropdown();
  assert.equal(hints.scope, "settings");
  settings();
  assert.equal(hints.scope, "menu");
  menu();
  assert.equal(hints.scope, "toolbar");
  assert.equal(hints.dismissTop(), false);
  unsubscribe();
  const before = changes;
  hints.invalidate();
  assert.equal(changes, before);
});

test("tab select and close actions are independent targets", () => {
  const hints = new ChromeHints();
  const actions = [];
  hints.register(chromeTarget("tab.1.select", { click: () => actions.push("select") }));
  hints.register(chromeTarget("tab.1.close", { click: () => actions.push("close") }));
  const targets = hints.targets("toolbar", viewport);
  hints.show(new Map(targets.map((target, index) => [target.id, ["a", "s"][index]])), "space");
  assert.equal(hints.snapshot().active, true);
  assert.equal(hints.snapshot().labels.size, 2);
  targets[1].click();
  assert.deepEqual(actions, ["close"]);
});

test("hover updates subscribers and clearing leaves the highlighted target", () => {
  const hints = new ChromeHints();
  const events = [];
  hints.register(chromeTarget("new", { hover: () => events.push("hover"), leave: () => events.push("leave") }));
  let updates = 0;
  const unsubscribe = hints.subscribe(() => updates++);
  hints.show(new Map([["new", "aa"]]), "ctrl+j");
  hints.filter("a");
  assert.equal(hints.snapshot().prefix, "a");
  hints.hover("new");
  assert.equal(hints.snapshot().hovering, true);
  hints.clear();
  assert.deepEqual(events, ["hover", "leave"]);
  assert.equal(updates, 4);
  assert.equal(hints.snapshot().active, false);
  unsubscribe();
});

test("old registration cleanup cannot remove a replacement control", () => {
  const hints = new ChromeHints();
  const dispose = hints.register(chromeTarget("new"));
  const replacement = chromeTarget("new");
  hints.register(replacement);
  dispose();
  assert.deepEqual(hints.targets("toolbar", viewport), [replacement]);
});
