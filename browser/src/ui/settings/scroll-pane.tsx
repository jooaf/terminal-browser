import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Box, Text, useRect } from "@zenbu-labs/pixel";
import type { NodeHandle, Style } from "@zenbu-labs/pixel";
import { HintBox, HintClipBox, useHintRegistry } from "../hints";

const WHEEL_TICK_REMS = 2.5;

export function ScrollPane({
  hintId, style, rem, resetKey, children,
}: {
  hintId: string;
  style: Style;
  rem: number;
  resetKey: number;
  children: ReactNode;
}) {
  const hints = useHintRegistry();
  const box = useRef<NodeHandle>(null);
  const rect = useRect(box);
  const target = useRef(0);
  const [scroll, setScroll] = useState({ offset: 0, max: Infinity });
  const current = useRef(scroll);
  current.current = scroll;
  useEffect(() => {
    target.current = 0;
    box.current?.scrollTo(0);
  }, [resetKey]);
  const move = (delta: number, smooth: boolean) => {
    target.current = Math.min(Math.max(0, target.current + delta), current.current.max);
    box.current?.scrollTo(target.current, smooth);
  };
  return (
    <Box style={{ ...style, padding: 0, flexDirection: "column", overflow: "hidden" }}>
      <HintClipBox
        ref={box}
        style={{ ...style, height: undefined, flexDirection: "column", flexGrow: 1, flexBasis: 0, overflow: "scroll" }}
        onScroll={(event) => {
          if (event.offset !== current.current.offset) hints.invalidate();
          current.current = event;
          target.current = Math.min(target.current, event.max);
          setScroll(event);
        }}
        onWheel={(event) => {
          if (event.mods.ctrl) return;
          move(event.precise ? event.deltaY : Math.sign(event.deltaY) * rem * WHEEL_TICK_REMS, !event.precise);
        }}
      >
        {children}
      </HintClipBox>
      <Box style={{ height: rem * 1.7, flexShrink: 0, justifyContent: "end", gap: rem * 0.5, padding: { right: rem * 0.5 } }}>
        {([-1, 1] as const).map((direction) => {
          const enabled = direction < 0 ? scroll.offset > 0 : scroll.offset < scroll.max;
          return (
            <HintBox key={direction} hintId={`${hintId}.${direction < 0 ? "up" : "down"}`}
              style={{ padding: rem * 0.2 }}
              onClick={enabled ? () => move(direction * Math.max(rem, (rect?.height ?? rem * 10) * 0.8), false) : undefined}>
              <Text style={{ fontSize: rem * 0.75, selectable: false }}>{direction < 0 ? "↑ Scroll up" : "↓ Scroll down"}</Text>
            </HintBox>
          );
        })}
      </Box>
    </Box>
  );
}
