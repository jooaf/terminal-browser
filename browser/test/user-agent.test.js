const assert = require("node:assert/strict");
const { test } = require("node:test");
const { browserUserAgent } = require("../dist/user-agent.js");

test("browser user-agent removes application identifiers without inventing browser or OS versions", () => {
  for (const platform of ["Macintosh; Intel Mac OS X 10_15_7", "Windows NT 10.0; Win64; x64", "X11; Linux x86_64"]) {
    const prefix = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko)`;
    const original = `${prefix} terminal-browser/44.2.0 Chrome/152.0.7977.76 Electron/44.2.0 Safari/537.36`;
    const expected = `${prefix} Chrome/152.0.7977.76 Safari/537.36`;
    assert.equal(browserUserAgent(original), expected);
    assert.equal(browserUserAgent(expected), expected);
  }
});

test("user-agent cleanup only removes complete application product tokens", () => {
  assert.equal(browserUserAgent("Electron/1 terminal-browser/2 Chrome/3"), "Chrome/3");
  assert.equal(browserUserAgent("Chrome/3 OtherElectron/1 other-terminal-browser/2"), "Chrome/3 OtherElectron/1 other-terminal-browser/2");
});
