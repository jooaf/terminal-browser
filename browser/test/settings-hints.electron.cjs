const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { SettingsManager } = require("../dist/session/settings.js");
const { SettingsCard } = require("../dist/ui/settings/index.js");
const { DropdownMenu } = require("../dist/ui/settings/dropdown.js");

module.exports = async function checkSettings({
  chrome, viewport, theme, dir, render, activate, start, until, key,
  keyEvents, pastes, send, setKeyHandler,
}) {
  const clipboard = [];
  const settings = new SettingsManager({
    requestRender() {
      const view = settings.view();
      render(view && React.createElement(SettingsCard, {
        view, actions: settings.actions, theme,
        layout: { width: 800, height: 600, toolbarHeight: 40, rem: 16 },
      }));
    },
    settingsChanged() {}, overlayOpened() {}, overlayClosed() {},
    toast(text, state) { assert.notEqual(state, "failed", text); },
    setClipboard: (text) => clipboard.push(text),
    release: () => ({ version: "test", latest: null, upgrade: "" }),
  }, { settings: path.join(dir, "settings.json"), shortcuts: path.join(dir, "shortcuts.json") });
  const targets = () => chrome.targets(chrome.scope, viewport);
  const has = (id) => targets().some((target) => target.id === id);
  const sendKey = (name, mods = {}, text) => send({ type: "key", ...key(name), mods, text });
  const cancel = async (hints) => { hints.cancel(); await hints.queue; };
  async function scrollUntil(visible) {
    for (let steps = 0; !visible(); steps++) {
      assert.ok(steps < 10, "Control must be reachable by hint scrolling");
      const before = JSON.stringify(targets().map((target) => [target.id, target.rect()]));
      await activate(`settings.${settings.view().section}.scroll.down`);
      await until(() => JSON.stringify(targets().map((target) => [target.id, target.rect()])) !== before);
    }
  }
  setKeyHandler((event) => { if (settings.recording) settings.recordKey(event); });
  try {
    settings.open();
    await until(() => chrome.scope === "settings" && has("setting.search.engine.dropdown"));
    let hints = await start();
    assert.ok([...chrome.snapshot().labels.keys()].every((id) => !id.startsWith("tab.")));
    await cancel(hints);

    await activate("setting.search.engine.dropdown");
    await until(() => chrome.scope === "dropdown" && targets().length > 1);
    hints = await start();
    assert.ok([...chrome.snapshot().labels.keys()].every((id) => id.startsWith("settings.dropdown.")));
    assert.equal(chrome.dismissTop(), true);
    await until(() => chrome.scope === "settings" && !chrome.snapshot().active);
    assert.equal(settings.isOpen, true);
    await hints.queue;
    await activate("setting.search.engine.dropdown");
    await until(() => chrome.scope === "dropdown" && targets().length > 1);
    const choice = settings.view().settings.find((row) => row.key === "search.engine").choices[1];
    await activate(`settings.dropdown.choice.${choice.value}`);
    await until(() => chrome.scope === "settings");
    assert.equal(settings.get("search.engine"), choice.value);

    await scrollUntil(() => has("setting.hints.alphabet.input"));
    await activate("setting.hints.alphabet.input");
    sendKey("a", { super: true });
    send({ type: "paste", text: "jkl" });
    await until(() => settings.modal.drafts["hints.alphabet"] === "jkl");
    sendKey("enter");
    await until(() => settings.get("hints.alphabet") === "jkl" && has("setting.hints.alphabet.reset"));
    await activate("setting.hints.alphabet.reset");
    assert.equal(settings.get("hints.alphabet"), "asdfghjkl");

    await scrollUntil(() => targets().some((target) => target.id.endsWith(".toggle")));
    const toggle = targets().find((target) => target.id.endsWith(".toggle"));
    const toggleKey = toggle.id.slice("setting.".length, -".toggle".length);
    const oldValue = settings.get(toggleKey);
    await activate(toggle.id);
    assert.notEqual(settings.get(toggleKey), oldValue);
    await until(() => has(`setting.${toggleKey}.reset`));
    await activate(`setting.${toggleKey}.reset`);
    assert.equal(settings.get(toggleKey), oldValue);

    await scrollUntil(() => has("settings.reload"));
    await activate("settings.copy-settings-path");
    assert.equal(clipboard.at(-1), path.join(dir, "settings.json"));
    await activate("settings.copy-shortcuts-path");
    assert.equal(clipboard.at(-1), path.join(dir, "shortcuts.json"));
    await activate("settings.reload");
    await activate("settings.copy-agent-brief");
    assert.ok(clipboard.at(-1).includes("terminal-browser config files:"));

    await activate("settings.section.shortcuts");
    await until(() => has("settings.shortcuts.search"));
    await activate("settings.shortcuts.search");
    send({ type: "paste", text: "nav" });
    await until(() => settings.view().query === "nav");
    hints = await start();
    const beforeKeys = keyEvents.length;
    sendKey("z", { shift: true }, "Z");
    send({ type: "paste", text: "must-not-enter-the-field" });
    await until(() => keyEvents.length > beforeKeys && pastes.includes("must-not-enter-the-field"));
    assert.equal(settings.view().query, "nav", "Hint mode must capture keys and paste before native inputs");
    sendKey("escape");
    await until(() => !chrome.snapshot().active);
    sendKey("x", {}, "x");
    await until(() => settings.view().query === "navx");
    hints = await start();
    for (const letter of chrome.snapshot().labels.get("settings.shortcuts.search")) sendKey(letter, {}, letter);
    await until(() => chrome.snapshot().selected === "settings.shortcuts.search");
    assert.equal(settings.view().query, "navx", "Typing an actual label must not edit the focused field");
    sendKey("enter");
    await until(() => !chrome.snapshot().active);
    sendKey("a", { super: true });
    sendKey("backspace");
    await until(() => settings.view().query === "" && targets().some((target) => target.id.includes(".bind.")));

    const binding = targets().find((target) => target.id.includes(".bind."));
    const command = settings.view().shortcuts.find((row) => binding.id.startsWith(`shortcut.${row.id}.bind.`));
    await activate(binding.id);
    await until(() => chrome.scope === "shortcut" && has("shortcut.cancel"));
    hints = await start();
    assert.deepEqual([...chrome.snapshot().labels.keys()], ["shortcut.cancel"]);
    await cancel(hints);
    sendKey("j", { ctrl: true });
    await until(() => has("shortcut.save"));
    await activate("shortcut.save");
    await until(() => chrome.scope === "settings");
    assert.deepEqual(settings.keymap.labels(command.id), ["ctrl+j"]);
    await activate(`shortcut.${command.id}.unbind`);
    assert.deepEqual(settings.keymap.labels(command.id), []);
    await until(() => has(`shortcut.${command.id}.bind`));
    await activate(`shortcut.${command.id}.bind`);
    await until(() => chrome.scope === "shortcut" && has("shortcut.cancel"));
    await activate("shortcut.cancel");
    await until(() => chrome.scope === "settings" && has(`shortcut.${command.id}.reset`));
    await activate(`shortcut.${command.id}.reset`);
    assert.ok(settings.keymap.labels(command.id).length);

    await activate("settings.section.advanced");
    await until(() => has("setting.render.fps.dropdown"));
    await activate("settings.close");
    await until(() => chrome.scope === "toolbar");
    assert.equal(settings.isOpen, false);

    const choices = Array.from({ length: 24 }, (_, index) => ({ value: `${index}`, name: `Choice ${index}`, logo: null }));
    let picked;
    render(React.createElement(DropdownMenu, {
      choices, value: "0", rect: { x: 400, y: 100, width: 240, height: 34 },
      bounds: { width: 800, height: 600 }, rem: 16, theme,
      onPick(value) { picked = value; render(); }, onDismiss() { render(); },
    }));
    await until(() => chrome.scope === "dropdown" && has("settings.dropdown.scroll.down"));
    assert.equal(has("settings.dropdown.choice.23"), false);
    await activate("settings.dropdown.scroll.down");
    assert.equal(has("settings.dropdown.choice.0"), false);
    assert.equal(has("settings.dropdown.choice.23"), true);
    await activate("settings.dropdown.scroll.up");
    assert.equal(has("settings.dropdown.choice.0"), true);
    await activate("settings.dropdown.scroll.down");
    await activate("settings.dropdown.choice.23");
    assert.equal(picked, "23");
    assert.equal(chrome.scope, "toolbar");
  } finally {
    setKeyHandler(null);
    settings.dispose();
  }
};
