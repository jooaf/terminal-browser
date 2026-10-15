import { randomUUID } from "node:crypto";
import type { EngineKeyEvent, Rect, WebViewHandle } from "@zenbu-labs/pixel";
import { chordFromEvent, sameChord } from "shared";
import type { Chord } from "shared";
import type { ChromeHints, ChromeHintTarget, HintScope } from "./chrome";
import { hintLabels, hintScript } from "./page";
import type { HintAction, HintResult } from "./page";

const HINT_WORLD = 1014;

export interface HintHooks {
  closed(): void;
  notify(message: string): void;
}

export interface HintOptions {
  alphabet: string;
  clickChords: Chord[];
  clickLabel: string;
  chrome: ChromeHints;
  scope: HintScope;
  viewport: Rect;
}

type HintMode = { kind: "loading" | "labels" | "page" } | { kind: "chrome"; target: ChromeHintTarget };

export class Hints {
  private readonly id = randomUUID();
  private active = true;
  private mode: HintMode = { kind: "loading" };
  private prefix = "";
  private chromeLabels = new Map<string, ChromeHintTarget>();
  private pageEnabled = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly contents;
  private readonly stopInvalidation: () => void;
  private readonly navigated = (details: Electron.WebContentsDidStartNavigationEventParams) => {
    if (details.isMainFrame) this.cancel();
  };
  private readonly navigatedInPage = (_event: unknown, _url: string, mainFrame: boolean) => {
    if (mainFrame) this.cancel();
  };
  private readonly destroyed = () => this.cancel();

  constructor(private readonly view: WebViewHandle, private readonly hooks: HintHooks, private readonly options: HintOptions) {
    this.contents = view.webContents;
    this.stopInvalidation = options.chrome.onInvalidated(() => this.cancel());
    this.contents.on("did-start-navigation", this.navigated);
    this.contents.on("did-navigate-in-page", this.navigatedInPage);
    this.contents.on("destroyed", this.destroyed);
    this.contents.on("render-process-gone", this.destroyed);
    this.contents.on("did-create-window", this.destroyed);
  }

  start(): void {
    this.enqueue(async () => {
      if (this.options.scope === "toolbar" && this.view.popupOpen) {
        this.hooks.notify("Close the popup window before showing page hints");
        this.cancel();
        return;
      }
      const targets = this.options.chrome.targets(this.options.scope, this.options.viewport);
      let result: HintResult = { mode: "hints", count: targets.length };
      if (this.options.scope === "toolbar") {
        try {
          result = await this.run({ type: "start", id: this.id, alphabet: this.options.alphabet, chromeCount: targets.length });
          this.pageEnabled = true;
        } catch (error) {
          if (!targets.length) throw error;
          if (this.active) this.hooks.notify("Page hints unavailable; browser controls are still available");
        }
      }
      if (!this.active) return;
      if (result.mode !== "hints" || !result.count) {
        this.hooks.notify("No visible targets");
        this.cancel();
        return;
      }
      const labels = hintLabels(result.count, this.options.alphabet);
      this.chromeLabels = new Map(targets.map((target, index) => [labels[index], target]));
      this.options.chrome.show(new Map(targets.map((target, index) => [target.id, labels[index]])), this.options.clickLabel);
      this.mode = { kind: "labels" };
    });
  }

  accepts(event: EngineKeyEvent): boolean {
    const key = event.key.toLowerCase();
    const plain = !event.mods.ctrl && !event.mods.alt && !event.mods.super;
    return (plain && key === "escape") || this.isClick(event)
      || (plain && (this.mode.kind === "labels" || this.mode.kind === "loading")
        && (key === "backspace" || (key.length === 1 && this.options.alphabet.includes(key))));
  }

  handleKey(event: EngineKeyEvent): void {
    if (!this.active || event.kind !== "press") return;
    const plain = !event.mods.ctrl && !event.mods.alt && !event.mods.super;
    if (event.key === "escape" && plain) {
      this.cancel();
      return;
    }
    const key = event.key.toLowerCase();
    this.enqueue(async () => {
      if (this.isClick(event) && (this.mode.kind === "page" || this.mode.kind === "chrome")) {
        await this.click();
        return;
      }
      const labelKey = key.length === 1 && this.options.alphabet.includes(key);
      if (!plain || this.mode.kind !== "labels" || (key !== "backspace" && !labelKey)) return;
      this.prefix = key === "backspace" ? this.prefix.slice(0, -1) : this.prefix + key;
      this.options.chrome.filter(this.prefix);
      const chromeTarget = this.chromeLabels.get(this.prefix);
      if (chromeTarget) {
        if (this.pageEnabled) await this.run({ type: "stop", id: this.id });
        if (!this.active) return;
        this.mode = { kind: "chrome", target: chromeTarget };
        this.options.chrome.hover(chromeTarget.id);
        return;
      }
      if (!this.pageEnabled) return;
      const result = await this.run({ type: "key", id: this.id, key });
      if (!this.active) return;
      if (result.mode === "idle") this.targetChanged();
      else if (result.mode === "hover") {
        this.mode = { kind: "page" };
        this.options.chrome.hover(null);
        await this.view.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...result.point });
      }
    });
  }

  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.stopInvalidation();
    this.contents.removeListener("did-start-navigation", this.navigated);
    this.contents.removeListener("did-navigate-in-page", this.navigatedInPage);
    this.contents.removeListener("destroyed", this.destroyed);
    this.contents.removeListener("render-process-gone", this.destroyed);
    this.contents.removeListener("did-create-window", this.destroyed);
    this.queue = this.queue.then(async () => {
      if (this.pageEnabled && !this.contents.isDestroyed()) await this.run({ type: "stop", id: this.id });
    }).catch(() => {});
    this.options.chrome.clear();
    this.hooks.closed();
  }

  private isClick(event: EngineKeyEvent): boolean {
    const chord = chordFromEvent(event);
    return !!chord && this.options.clickChords.some((binding) => sameChord(binding, chord));
  }

  private targetChanged() {
    this.hooks.notify("Target changed; show hints again");
    this.cancel();
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(async () => {
      if (this.active) await work();
    }).catch((error: unknown) => {
      if (!this.active) return;
      this.hooks.notify(`Keyboard hints failed: ${error instanceof Error ? error.message : String(error)}`);
      this.cancel();
    });
  }

  private run(action: HintAction): Promise<HintResult> {
    return this.contents.executeJavaScriptInIsolatedWorld(HINT_WORLD, [{ code: hintScript(action) }]);
  }

  private async click(): Promise<void> {
    if (this.mode.kind === "chrome") {
      const target = this.mode.target;
      if (!this.options.chrome.targets(this.options.scope, this.options.viewport).includes(target)) {
        this.targetChanged();
        return;
      }
      this.cancel();
      target.click();
      return;
    }
    this.view.focus();
    await this.view.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
    if (!this.active) return;
    const result = await this.run({ type: "point", id: this.id });
    if (!this.active) return;
    if (result.mode !== "hover") {
      this.targetChanged();
      return;
    }
    const mouse = { ...result.point, button: "left", clickCount: 1 };
    try {
      await this.view.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...mouse });
    } finally {
      if (!this.contents.isDestroyed()) {
        await this.view.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse });
      }
    }
    this.cancel();
  }
}
