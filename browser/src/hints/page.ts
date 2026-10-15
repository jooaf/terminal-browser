export function hintLabels(count: number, alphabet: string): string[] {
  if (!/^[a-z]{2,26}$/.test(alphabet) || new Set(alphabet).size !== alphabet.length) {
    throw new Error("Hint letters must be 2–26 different lowercase letters");
  }
  const width = Math.max(1, Math.ceil(Math.log(Math.max(1, count)) / Math.log(alphabet.length)));
  return Array.from({ length: count }, (_, index) => {
    let label = "";
    for (let digit = 0; digit < width; digit++) {
      label = alphabet[index % alphabet.length] + label;
      index = Math.floor(index / alphabet.length);
    }
    return label;
  });
}

export type HintAction =
  | { type: "start"; id: string; alphabet: string; chromeCount: number }
  | { type: "key"; id: string; key: string }
  | { type: "point" | "stop"; id: string };

export interface HintPoint {
  x: number;
  y: number;
}

export type HintResult =
  | { mode: "idle" }
  | { mode: "hints"; count: number }
  | { mode: "hover"; point: HintPoint };

function hintPage(action: HintAction, labels: (count: number, alphabet: string) => string[]): HintResult {
  type Target = { element: Element; label: string; badge: HTMLSpanElement };
  type PageState = { id: string; run(action: HintAction): HintResult; dispose(): void };
  const world = window as Window & { terminalBrowserHints?: PageState };
  const idle: HintResult = { mode: "idle" };
  if (action.type !== "start") {
    return world.terminalBrowserHints?.id === action.id ? world.terminalBrowserHints.run(action) : idle;
  }
  world.terminalBrowserHints?.dispose();

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("popover", "manual");
  for (const [key, value] of Object.entries({
    all: "initial", position: "fixed", inset: "0", width: "100vw", height: "100vh",
    margin: "0", padding: "0", border: "0", background: "transparent",
    "pointer-events": "none", "z-index": "2147483647", overflow: "visible",
  })) host.style.setProperty(key, value, "important");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = new CSSStyleSheet();
  style.replaceSync(`
    [hidden] { display: none !important; }
    span { all: initial; position: fixed; pointer-events: none; box-sizing: border-box;
      font: bold 14px/20px monospace; color: #171717; background: #ffe16b;
      border: 1px solid #171717; border-radius: 3px; padding: 0 4px; }
    div { position: fixed; pointer-events: none; width: 18px; height: 18px;
      border: 2px solid #ffe16b; border-radius: 50%; box-shadow: 0 0 0 1px #171717;
      transform: translate(-50%, -50%); box-sizing: border-box; }
  `);
  shadow.adoptedStyleSheets = [style];
  const marker = document.createElement("div");
  marker.hidden = true;
  shadow.append(marker);

  function contains(element: Element, hit: Element | null): boolean {
    while (hit) {
      if (element === hit || element.contains(hit)) return true;
      const root = hit.getRootNode();
      hit = root instanceof ShadowRoot ? root.host : null;
    }
    return false;
  }

  function hitAt(point: HintPoint): Element | null {
    let hit = document.elementFromPoint(point.x, point.y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(point.x, point.y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  }

  function available(element: Element): boolean {
    for (let ancestor: Element | null = element; ancestor; ancestor = parent(ancestor)) {
      if (ancestor.matches(":disabled, [aria-disabled='true'], [inert]")) return false;
    }
    return element.isConnected && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }

  function pointFor(element: Element): HintPoint | null {
    if (!available(element)) return null;
    for (const rect of element.getClientRects()) {
      const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      const right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      if (right - left < 2 || bottom - top < 2) continue;
      for (const [dx, dy] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
        const point = { x: left + (right - left) * dx, y: top + (bottom - top) * dy };
        if (contains(element, hitAt(point))) return point;
      }
    }
    return null;
  }

  const elements: Element[] = [];
  const selector = "a[href], area[href], button, input:not([type='hidden']), textarea, select, summary, "
    + "label, audio[controls], video[controls], [contenteditable]:not([contenteditable='false']), "
    + "[onclick], [onmousedown], [onpointerdown], [tabindex], [aria-haspopup], [aria-expanded], "
    + "[role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='switch'], "
    + "[role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], "
    + "[role='combobox'], [role='option'], [role='slider'], [role='spinbutton'], [role='searchbox'], [role='textbox'], "
    + "[role='listbox'], [role='tree'], [role='treeitem']";
  function parent(element: Element): Element | null {
    const root = element.getRootNode();
    return element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  function insideControl(element: Element): boolean {
    for (let ancestor = parent(element); ancestor; ancestor = parent(ancestor)) {
      if (ancestor.matches(selector)) return true;
    }
    return false;
  }
  function collect(root: Document | ShadowRoot) {
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) collect(element.shadowRoot);
      const explicit = element.matches(selector);
      const pointer = !explicit && !insideControl(element) && getComputedStyle(element).cursor === "pointer"
        && (element.children.length === 0 || [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()));
      const label = element instanceof HTMLLabelElement ? element.control : null;
      if (element instanceof HTMLLabelElement && (!label || label.matches(":disabled, [aria-disabled='true']"))) continue;
      if ((explicit || pointer) && pointFor(element)) elements.push(element);
    }
  }
  collect(document);
  const count = elements.length + action.chromeCount;
  if (!count) return idle;
  const names = labels(count, action.alphabet).slice(action.chromeCount);
  const targets: Target[] = elements.map((element, index) => {
    const badge = document.createElement("span");
    shadow.append(badge);
    return { element, label: names[index], badge };
  });
  let prefix = "";
  let selected: { target: Target; point: HintPoint } | null = null;
  let frame = 0;

  function render() {
    frame = 0;
    for (const target of targets) {
      const point = !selected && target.label.startsWith(prefix) ? pointFor(target.element) : null;
      target.badge.hidden = !point;
      if (!point) continue;
      target.badge.textContent = target.label.toUpperCase();
      const rect = target.element.getBoundingClientRect();
      target.badge.style.left = `${Math.max(0, Math.min(innerWidth - target.label.length * 9 - 10, rect.left))}px`;
      target.badge.style.top = `${Math.max(0, Math.min(innerHeight - 22, rect.top))}px`;
    }
    marker.hidden = !selected;
    if (selected) {
      marker.style.left = `${selected.point.x}px`;
      marker.style.top = `${selected.point.y}px`;
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }
  const observer = new MutationObserver((changes) => {
    if (changes.some((change) => change.target !== host)) schedule();
  });
  function dispose() {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    host.remove();
    if (world.terminalBrowserHints?.id === action.id) delete world.terminalBrowserHints;
  }
  world.terminalBrowserHints = {
    id: action.id,
    dispose,
    run(next) {
      if (next.type === "stop") {
        dispose();
        return idle;
      }
      if (next.type === "point") {
        if (selected && available(selected.target.element) && contains(selected.target.element, hitAt(selected.point))) {
          return { mode: "hover", point: selected.point };
        }
        dispose();
        return idle;
      }
      if (next.type === "key" && !selected) {
        prefix = next.key === "backspace" ? prefix.slice(0, -1) : prefix + next.key;
        const target = targets.find((candidate) => candidate.label === prefix);
        if (target) {
          const point = pointFor(target.element);
          if (!point) {
            dispose();
            return idle;
          }
          selected = { target, point };
        }
        render();
      }
      return selected ? { mode: "hover", point: selected.point } : { mode: "hints", count };
    },
  };
  document.documentElement.append(host);
  host.showPopover();
  render();
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  observer.observe(document, { subtree: true, childList: true, attributes: true,
    attributeFilter: ["style", "class", "hidden", "disabled", "aria-disabled", "open"] });
  return { mode: "hints", count };
}

export function hintScript(action: HintAction): string {
  return `(${hintPage.toString()})(${JSON.stringify(action)}, (${hintLabels.toString()}))`;
}
