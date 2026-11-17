const assert = require("node:assert/strict");
const React = require("react");
const { Box } = require("../../pixel/packages/pixel/dist/react/index.js");
const { Keymap } = require("shared");
const { FindBar } = require("../dist/ui/overlays.js");

module.exports = async function checkFindFocus({ root, registry, theme, render, until, settle, key, send, setKeyHandler }) {
  const page = React.createRef();
  const keymap = new Keymap({}, { noSuper: false });
  const chord = keymap.binding("find").chords[0];
  const shortcut = { type: "key", ...key(chord.key), mods: { ctrl: chord.ctrl, super: chord.super, alt: chord.alt, shift: chord.shift } };
  let open = false;
  let focusRequest = 0;
  let query = "";
  let clicks = 0;
  let pageFocused = true;
  const pageKeys = [];
  const matches = [];
  const actions = {
    findChange(value) { query = value; draw(); },
    findNext(forward) { matches.push(forward); },
    findClose() { open = false; pageFocused = true; root.setKeyCapture([]); draw(); },
  };
  function draw() {
    render(React.createElement(React.Fragment, null,
      React.createElement(Box, {
        ref: page,
        style: { position: "absolute", inset: { top: 40, left: 0 }, width: 800, height: 560 },
        onPointer(event) { if (event.kind === "down") { clicks++; pageFocused = true; } },
      }),
      open && React.createElement(FindBar, {
        focusRequest, actions, theme,
        state: { findMatches: { active: 1, total: 2 } },
        layout: { width: 800, height: 600, toolbarHeight: 40, rem: 16 },
      })));
  }
  setKeyHandler((event) => {
    if (event.kind !== "press") return;
    if (keymap.match(event) === "find") {
      open = true;
      focusRequest++;
      pageFocused = false;
      root.setKeyCapture(["enter", "shift+enter"]);
      draw();
    } else if (open && event.key === "escape") actions.findClose();
    else if (open && event.key === "enter") actions.findNext(!event.mods.shift);
    else if (pageFocused) pageKeys.push(event.key);
  });
  async function clickPage() {
    const before = clicks;
    send({ type: "mouse", kind: "down", button: "left", x: 100, y: 200 });
    send({ type: "mouse", kind: "up", button: "left", x: 100, y: 200 });
    await until(() => clicks > before);
  }
  async function openFind() {
    const before = focusRequest;
    send(shortcut);
    await until(() => focusRequest > before);
    await settle();
  }
  async function type(text) {
    for (const letter of text) send({ type: "key", ...key(letter), text: letter });
    await until(() => query === text);
  }
  try {
    draw();
    await until(() => page.current && registry.layout.get().rects.has(page.current.id));
    await clickPage();
    await openFind();
    await type("alpha");
    assert.deepEqual(pageKeys, []);

    await clickPage();
    await openFind();
    assert.equal(query, "alpha", "Refocusing Find must preserve the existing query until replacement typing");
    await type("beta");
    await openFind();
    await type("gamma");
    assert.deepEqual(pageKeys, []);

    send({ type: "key", ...key("enter") });
    send({ type: "key", ...key("enter"), mods: { shift: true } });
    await until(() => matches.length === 2);
    assert.deepEqual(matches, [true, false]);
    send({ type: "key", ...key("escape") });
    await until(() => !open);
    send({ type: "key", ...key("x"), text: "x" });
    await until(() => pageKeys.includes("x"));
    await clickPage();
    await openFind();
    await type("delta");
    console.log("Native Find first-open, refocus, query selection and keyboard checks passed");
  } finally {
    setKeyHandler(null);
    root.setKeyCapture([]);
    render();
  }
};
