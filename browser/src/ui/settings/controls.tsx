import { Box, Text } from "@zenbu-labs/pixel";
import { Icon } from "../icons";
import type { IconName } from "../icons";
import type { Theme } from "../theme";
import { HintBox, useChromeHints } from "../hints";

export function IconButton({
  hintId,
  visible = true,
  icon,
  rem,
  theme,
  onClick,
}: {
  hintId: string;
  visible?: boolean;
  icon: IconName;
  rem: number;
  theme: Theme;
  onClick(): void;
}) {
  const hinting = useChromeHints().active;
  return (
    <HintBox hintId={hintId}
      style={{
        width: rem * 1.6,
        height: rem * 1.6,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        cornerRadius: rem * 0.3,
        hoverBackground: theme.hoverStrong,
      }}
      onHintClick={onClick}
      onClick={visible || hinting ? onClick : undefined}
    >
      {(visible || hinting) && <Icon icon={icon} size={rem * 1} color={theme.muted} />}
    </HintBox>
  );
}

export function TextButton({
  hintId,
  label,
  rem,
  theme,
  onClick,
}: {
  hintId: string;
  label: string;
  rem: number;
  theme: Theme;
  onClick(): void;
}) {
  return (
    <HintBox hintId={hintId}
      style={{
        height: rem * 1.55,
        alignItems: "center",
        padding: { left: rem * 0.7, right: rem * 0.7 },
        cornerRadius: rem * 0.3,
        background: theme.field,
        hoverBackground: theme.hoverStrong,
        border: { width: 1, color: theme.fieldBorder },
      }}
      onClick={onClick}
    >
      <Text style={{ fontSize: rem * 0.85, wrap: false, selectable: false }}>{label}</Text>
    </HintBox>
  );
}

export function Toggle({
  hintId,
  on,
  rem,
  theme,
  onChange,
}: {
  hintId: string;
  on: boolean;
  rem: number;
  theme: Theme;
  onChange(on: boolean): void;
}) {
  const height = Math.round(rem * 1.2);
  const knob = height - 6;
  return (
    <HintBox hintId={hintId}
      style={{
        width: Math.round(rem * 2.2),
        height,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: on ? "end" : "start",
        padding: 2,
        cornerRadius: height / 2,
        background: on ? theme.hoverStrong : theme.field,
        hoverBackground: theme.hoverStrong,
        border: { width: 1, color: theme.fieldBorder },
      }}
      onClick={() => onChange(!on)}
    >
      <Box
        style={{
          width: knob,
          height: knob,
          cornerRadius: knob / 2,
          background: on ? theme.fg : theme.muted,
        }}
      />
    </HintBox>
  );
}
