const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const { terminalZoom } = require("../dist/terminal-zoom.js");
const { PageZoom } = require("../dist/web/zoom.js");

const metrics = { width: 800, height: 600, basePx: 16, cellHeight: 20 };
function contents() {
  let factor = 1;
  let mode = "default";
  return Object.assign(new EventEmitter(), {
    getZoomFactor: () => factor,
    setZoomFactor: (value) => { factor = value; },
    getZoomMode: () => mode,
    setZoomMode: (value) => { mode = value; },
  });
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("website baseline uses terminal font size and display density", () => {
  assert.equal(terminalZoom(metrics, 1), 1);
  assert.equal(terminalZoom({ ...metrics, basePx: 24 }, 1), 1.5);
  assert.equal(terminalZoom({ ...metrics, basePx: 48 }, 2), 1.5);
});

test("pane resizing does not change scale, but same-row font changes do", () => {
  assert.equal(terminalZoom({ ...metrics, width: 400, height: 200 }, 1), 1);
  assert.equal(terminalZoom({ ...metrics, height: 900, cellHeight: 30, basePx: 24 }, 1), 1.5);
  assert.equal(terminalZoom({ ...metrics, basePx: 16.008 }, 1), 1.0005);
});

test("invalid or minimized measurements do not provide a new baseline", () => {
  for (const key of Object.keys(metrics)) {
    for (const value of [0, -1, NaN, Infinity]) {
      assert.equal(terminalZoom({ ...metrics, [key]: value }, 1), null);
    }
  }
  for (const scale of [0, -1, NaN, Infinity]) assert.equal(terminalZoom(metrics, scale), null);
});

test("page zoom presets and reset are relative to the terminal baseline", () => {
  const page = contents();
  const zoom = new PageZoom(page, 1.5);
  near(page.getZoomFactor(), 1.5);
  assert.equal(zoom.step(1), 1.1);
  near(page.getZoomFactor(), 1.65);
  assert.equal(zoom.step(-1), 1);
  zoom.step(-1);
  near(page.getZoomFactor(), 1.35);
  assert.equal(zoom.step(0), 1);
  near(page.getZoomFactor(), 1.5);
});

test("terminal changes preserve additional page zoom without cumulative drift", () => {
  const page = contents();
  const zoom = new PageZoom(page, 1.234567, 1.25);
  for (let i = 0; i < 1000; i++) {
    zoom.setBaseZoom(1.235001);
    zoom.setBaseZoom(1.234567);
  }
  near(page.getZoomFactor(), 1.234567 * 1.25);
  assert.equal(zoom.factor, 1.25);
});

test("page zoom is isolated from other tabs and terminal windows", () => {
  const page = contents();
  new PageZoom(page, 1.5);
  assert.equal(page.getZoomMode(), "isolated");
});

test("zoom bounds reflect Chromium's actual rendered limits", () => {
  const page = contents();
  const zoom = new PageZoom(page, 1.5);
  for (let i = 0; i < 30; i++) zoom.step(1);
  near(zoom.factor, 5 / 1.5);
  near(page.getZoomFactor(), 5);
  for (let i = 0; i < 30; i++) zoom.step(-1);
  assert.equal(zoom.factor, 0.25);
  near(page.getZoomFactor(), 0.375);
});

test("font changes preserve requested zoom across Chromium's limits", () => {
  const page = contents();
  const zoom = new PageZoom(page, 1, 4);
  zoom.setBaseZoom(2);
  near(page.getZoomFactor(), 5);
  assert.equal(zoom.factor, 2.5);
  zoom.setBaseZoom(1);
  near(page.getZoomFactor(), 4);
  assert.equal(zoom.factor, 4);
  assert.equal(terminalZoom({ ...metrics, basePx: 512 }, 1), 5);
  assert.equal(terminalZoom({ ...metrics, basePx: 6 }, 2), 0.25);
});

test("navigation restores both terminal baseline and the tab's user zoom", () => {
  const page = contents();
  const zoom = new PageZoom(page, 1.5, 1.25);
  zoom.setBaseZoom(2);
  page.setZoomFactor(1);
  page.emit("did-navigate");
  near(page.getZoomFactor(), 2.5);
  assert.equal(zoom.factor, 1.25);
});

test("popup zoom inherits the opener's baseline and additional zoom", () => {
  const opener = new PageZoom(contents(), 1.5, 1.25);
  const page = contents();
  const popup = new PageZoom(page, opener.state.base, opener.state.factor);
  near(page.getZoomFactor(), 1.875);
  popup.step(0);
  near(page.getZoomFactor(), 1.5);
});
