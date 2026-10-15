import { createContext, forwardRef, useContext, useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Box, Text, useRect } from "@zenbu-labs/pixel";
import type { NodeHandle, Rect } from "@zenbu-labs/pixel";
import type { ChromeHints, HintScope } from "../hints/chrome";

export const ChromeHintsContext = createContext<ChromeHints | null>(null);
const HintClipContext = createContext<Rect | null>(null);
const HintScopeContext = createContext<HintScope>("toolbar");

export function useHintRegistry() {
  const hints = useContext(ChromeHintsContext);
  if (!hints) throw new Error("Browser controls need a ChromeHintsContext");
  return hints;
}

export function useChromeHints() {
  const hints = useHintRegistry();
  return useSyncExternalStore(hints.subscribe, hints.snapshot);
}

export function HintLayer({ scope, onDismiss, children }: { scope: HintScope; onDismiss?: () => void; children: ReactNode }) {
  const hints = useHintRegistry();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const canDismiss = !!onDismiss;
  useLayoutEffect(() => hints.enterScope(scope, canDismiss ? () => dismiss.current?.() : undefined), [hints, scope, canDismiss]);
  return <HintScopeContext.Provider value={scope}>{children}</HintScopeContext.Provider>;
}

export function HintStatus() {
  const state = useChromeHints();
  if (!state.active) return null;
  const instruction = state.hovering
    ? `${state.clickLabel ? state.clickLabel + " to click" : "Click key is unbound"} · Esc to cancel · Shortcut for new hints`
    : `${state.prefix ? state.prefix.toUpperCase() + " · " : ""}Type a label to hover · Backspace to edit · Esc to cancel`;
  return (
    <Box style={{ position: "absolute", inset: { bottom: 8, left: 8 }, padding: 4, background: "#ffe16b", cornerRadius: 3 }}>
      <Text style={{ color: "#171717", fontSize: 14, wrap: false, selectable: false }}>{instruction}</Text>
    </Box>
  );
}

type BoxProps = ComponentPropsWithoutRef<typeof Box>;

export const HintClipBox = forwardRef<NodeHandle, BoxProps>(function HintClipBox({ children, ...props }, forwarded) {
  const ref = useRef<NodeHandle>(null);
  useImperativeHandle(forwarded, () => ref.current!);
  const rect = useRect(ref);
  const parent = useContext(HintClipContext);
  const clip = rect && parent ? {
    x: Math.max(rect.x, parent.x), y: Math.max(rect.y, parent.y),
    width: Math.max(0, Math.min(rect.x + rect.width, parent.x + parent.width) - Math.max(rect.x, parent.x)),
    height: Math.max(0, Math.min(rect.y + rect.height, parent.y + parent.height) - Math.max(rect.y, parent.y)),
  } : rect ?? parent;
  return (
    <Box {...props} ref={ref}>
      <HintClipContext.Provider value={clip}>{children}</HintClipContext.Provider>
    </Box>
  );
});

type HintBoxProps = BoxProps & {
  hintId: string;
  hintScope?: HintScope;
  hintAlign?: "start" | "end";
  onHintClick?: () => void;
};

export const HintBox = forwardRef<NodeHandle, HintBoxProps>(function HintBox({
  hintId, hintScope, hintAlign = "start", onClick, onHintClick, onMouseEnter, onMouseLeave, style, children, ...props
}, forwarded) {
  const hints = useHintRegistry();
  const state = useChromeHints();
  const scope = useContext(HintScopeContext);
  const targetScope = hintScope ?? scope;
  const ref = useRef<NodeHandle>(null);
  useImperativeHandle(forwarded, () => ref.current!);
  const rect = useRect(ref);
  const clip = useContext(HintClipContext);
  const current = useRef({ rect, clip, onClick, onHintClick, onMouseEnter, onMouseLeave });
  current.current = { rect, clip, onClick, onHintClick, onMouseEnter, onMouseLeave };
  const enabled = !!(onHintClick ?? onClick) && !props.hidden;
  useLayoutEffect(() => {
    if (!enabled) return;
    return hints.register({
      id: hintId, scope: targetScope,
      rect: () => current.current.rect,
      clip: () => current.current.clip,
      click: () => {
        const { rect, onClick, onHintClick } = current.current;
        if (onHintClick) onHintClick();
        else if (rect) onClick?.({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      },
      hover: () => current.current.onMouseEnter?.(),
      leave: () => current.current.onMouseLeave?.(),
    });
  }, [hints, hintId, targetScope, enabled]);
  const label = state.labels.get(hintId);
  const selected = enabled && state.selected === hintId;
  return (
    <Box {...props} ref={ref} style={{ ...style, ...(selected ? { background: "#66551e" } : {}) }}
      onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {children}
      {enabled && state.active && !state.hovering && label?.startsWith(state.prefix) && (
        <Box style={{
          position: "absolute", inset: { top: 0, [hintAlign === "end" ? "right" : "left"]: 0 },
          padding: { left: 2, right: 2 }, background: "#ffe16b", cornerRadius: 2,
        }}>
          <Text style={{ fontSize: 12, color: "#171717", wrap: false, selectable: false }}>{label.toUpperCase()}</Text>
        </Box>
      )}
    </Box>
  );
});
