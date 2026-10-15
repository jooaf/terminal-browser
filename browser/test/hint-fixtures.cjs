const { defaultSettings, parseChord } = require("shared");
const { ChromeHints } = require("../dist/hints/chrome.js");

const alphabet = defaultSettings()["hints.alphabet"];

function hintOptions(overrides = {}) {
  return {
    alphabet,
    clickChords: [parseChord("enter")],
    clickLabel: "enter",
    chrome: new ChromeHints(),
    scope: "toolbar",
    viewport: { x: 0, y: 0, width: 800, height: 600 },
    ...overrides,
  };
}

function chromeTarget(id, overrides = {}) {
  return {
    id, scope: "toolbar",
    rect: () => ({ x: 10, y: 10, width: 25, height: 25 }),
    clip: () => null,
    click() {}, hover() {}, leave() {},
    ...overrides,
  };
}

module.exports = { alphabet, hintOptions, chromeTarget };
