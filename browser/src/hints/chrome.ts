import type { Rect } from "@zenbu-labs/pixel";

const SCOPE_PRIORITY = { toolbar: 0, menu: 1, settings: 2, dropdown: 3, shortcut: 4 } as const;
export type HintScope = keyof typeof SCOPE_PRIORITY;

export interface ChromeHintTarget {
  id: string;
  scope: HintScope;
  rect(): Rect | null;
  clip(): Rect | null;
  click(): void;
  hover(): void;
  leave(): void;
}

export interface ChromeHintState {
  active: boolean;
  labels: ReadonlyMap<string, string>;
  prefix: string;
  selected: string | null;
  hovering: boolean;
  clickLabel: string;
}

export class ChromeHints {
  private readonly entries = new Map<string, ChromeHintTarget>();
  private readonly listeners = new Set<() => void>();
  private readonly layers = new Map<symbol, { scope: HintScope; dismiss?: () => void }>();
  private readonly invalidationListeners = new Set<() => void>();
  private state: ChromeHintState = {
    active: false, labels: new Map(), prefix: "", selected: null, hovering: false, clickLabel: "",
  };

  readonly snapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get scope(): HintScope {
    return [...this.layers.values()].reduce<HintScope>((top, { scope }) =>
      SCOPE_PRIORITY[scope] >= SCOPE_PRIORITY[top] ? scope : top, "toolbar");
  }

  dismissTop(): boolean {
    const layer = [...this.layers.values()].reverse().find((layer) => layer.scope === this.scope);
    if (!layer?.dismiss) return false;
    layer.dismiss();
    return true;
  }

  enterScope(scope: HintScope, dismiss?: () => void): () => void {
    const key = Symbol(scope);
    const previous = this.scope;
    this.layers.set(key, { scope, dismiss });
    if (this.scope !== previous) this.invalidate();
    return () => {
      const previous = this.scope;
      this.layers.delete(key);
      if (this.scope !== previous) this.invalidate();
    };
  }

  invalidate() {
    for (const listener of this.invalidationListeners) listener();
  }

  onInvalidated(listener: () => void): () => void {
    this.invalidationListeners.add(listener);
    return () => { this.invalidationListeners.delete(listener); };
  }

  register(target: ChromeHintTarget): () => void {
    this.entries.set(target.id, target);
    return () => {
      if (this.entries.get(target.id) === target) this.entries.delete(target.id);
    };
  }

  targets(scope: HintScope, viewport: Rect): ChromeHintTarget[] {
    return [...this.entries.values()].filter((target) => {
      if (target.scope !== scope) return false;
      const rect = target.rect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      return [viewport, target.clip()].every((clip) => !clip || (
        Math.round(rect.x) >= Math.round(clip.x) && Math.round(rect.y) >= Math.round(clip.y)
        && Math.round(rect.x + rect.width) <= Math.round(clip.x + clip.width)
        && Math.round(rect.y + rect.height) <= Math.round(clip.y + clip.height)
      ));
    });
  }

  show(labels: ReadonlyMap<string, string>, clickLabel: string) {
    this.update({ active: true, labels, prefix: "", selected: null, hovering: false, clickLabel });
  }

  filter(prefix: string) {
    this.update({ ...this.state, prefix });
  }

  hover(id: string | null) {
    if (this.state.selected) this.entries.get(this.state.selected)?.leave();
    this.update({ ...this.state, selected: id, hovering: true });
    if (id) this.entries.get(id)?.hover();
  }

  clear() {
    if (this.state.selected) this.entries.get(this.state.selected)?.leave();
    this.update({ active: false, labels: new Map(), prefix: "", selected: null, hovering: false, clickLabel: "" });
  }

  private update(state: ChromeHintState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
