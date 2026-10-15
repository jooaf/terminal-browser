import { useRef } from "react";
import { Box, Image, Text, useRect } from "@zenbu-labs/pixel";
import type { NodeHandle, Rect } from "@zenbu-labs/pixel";
import { Icon } from "../icons";
import { HintBox, HintLayer } from "../hints";
import { ScrollPane } from "./scroll-pane";
import { mix, withAlpha } from "../theme";
import type { Theme } from "../theme";
import type { SettingChoiceView } from "../types";

const ITEM_HEIGHT_REMS = 2.1;
const MENU_ITEM_HEIGHT_REMS = 1.9;
const MENU_PADDING_REMS = 0.2;

export const CUSTOM = "custom";

export function withCustom(choices: SettingChoiceView[]): SettingChoiceView[] {
  return [...choices, { value: CUSTOM, name: "Custom", logo: null }];
}

export interface OpenDropdown {
  key: string;
  rect: Rect;
}

export function Dropdown({
  hintId,
  choices,
  value,
  open,
  width,
  rem,
  theme,
  onOpen,
}: {
  choices: SettingChoiceView[];
  value: string;
  open: boolean;
  hintId: string;
  width: number;
  rem: number;
  theme: Theme;
  onOpen(rect: Rect): void;
}) {
  const box = useRef<NodeHandle | null>(null);
  const rect = useRect(box);
  const height = rem * ITEM_HEIGHT_REMS;
  const current = choices.find((choice) => choice.value === value);
  return (
    <HintBox hintId={hintId}
      ref={box}
      style={{
        width,
        height,
        flexShrink: 0,
        alignItems: "center",
        gap: rem * 0.5,
        padding: { left: rem * 0.7, right: rem * 0.6 },
        cornerRadius: rem * 0.35,
        background: open ? theme.hoverStrong : theme.field,
        hoverBackground: theme.hoverStrong,
        border: { width: 1, color: theme.fieldBorder },
      }}
      onClick={(event) => onOpen(rect ?? { x: event.x, y: event.y - height / 2, width, height })}
    >
      {current?.logo && <ChoiceLogo src={current.logo} size={rem * 1.15} />}
      <Text
        style={{
          flexGrow: 1,
          flexBasis: 0,
          fontSize: rem * 0.88,
          color: current ? theme.fg : theme.muted,
          wrap: false,
          ellipsis: true,
          selectable: false,
        }}
      >
        {current?.name ?? value}
      </Text>
      <Icon icon="down" size={rem * 0.75} color={theme.muted} />
    </HintBox>
  );
}

// Drawn by the settings card after every row, so it paints above them and is not
// clipped by the scrolling pane. `rect` is the trigger in the card's coordinates.
export function DropdownMenu({
  choices,
  value,
  rect,
  bounds,
  rem,
  theme,
  onPick,
  onDismiss,
}: {
  choices: SettingChoiceView[];
  value: string;
  rect: Rect;
  bounds: { width: number; height: number };
  rem: number;
  theme: Theme;
  onPick(value: string): void;
  onDismiss(): void;
}) {
  const itemHeight = rem * MENU_ITEM_HEIGHT_REMS;
  const padding = rem * MENU_PADDING_REMS;
  const height = Math.min(choices.length * itemHeight + padding * 2 + 2 + rem * 1.7, Math.max(rem * 4, bounds.height - rem));
  const gap = rem * 0.25;
  const below = rect.y + rect.height + gap;
  const top = Math.round(below + height <= bounds.height ? below : Math.max(0, rect.y - gap - height));
  return (
    <HintLayer scope="dropdown" onDismiss={onDismiss}>
      <Box
        style={{
          position: "absolute",
          inset: { top, left: Math.round(Math.min(rect.x, bounds.width - rect.width)) },
          width: rect.width,
          height,
          flexDirection: "column",
          padding,
          background: withAlpha(mix(theme.overlay, theme.fg, 0.08), 255),
          cornerRadius: rem * 0.3,
          border: { width: 1, color: theme.fieldBorder },
        }}
        onClickOutside={onDismiss}
        onWheel={() => {}}
      >
        <ScrollPane hintId="settings.dropdown.scroll" rem={rem} resetKey={choices.length} style={{ flexGrow: 1, flexBasis: 0 }}>
          {choices.map((choice) => {
            const active = choice.value === value;
            return (
              <HintBox hintId={`settings.dropdown.choice.${choice.value}`}
                key={choice.value}
                style={{
                  height: itemHeight,
                  flexShrink: 0,
                  alignItems: "center",
                  gap: rem * 0.5,
                  padding: { left: rem * 0.6, right: rem * 0.5 },
                  cornerRadius: rem * 0.25,
                  background: active ? theme.hover : undefined,
                  hoverBackground: theme.hoverStrong,
                }}
                onClick={() => onPick(choice.value)}
              >
                {choice.logo && <ChoiceLogo src={choice.logo} size={rem * 1.15} />}
                <Text
                  style={{
                    flexGrow: 1,
                    flexBasis: 0,
                    fontSize: rem * 0.88,
                    color: theme.fg,
                    wrap: false,
                    ellipsis: true,
                    selectable: false,
                  }}
                >
                  {choice.name}
                </Text>
                {active && <Icon icon="check" size={rem * 0.75} color={theme.fg} />}
              </HintBox>
            );
          })}
        </ScrollPane>
      </Box>
    </HintLayer>
  );
}

function ChoiceLogo({ src, size }: { src: string; size: number }) {
  return (
    <Image
      src={src}
      error={<Box style={{ width: size, height: size }} />}
      style={{ width: size, height: size, cornerRadius: size * 0.2, flexShrink: 0 }}
    />
  );
}
