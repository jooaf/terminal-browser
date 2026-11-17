import { screen } from "electron";

import type { Terminal } from "./terminal";

export function hostDisplayScale(terminal: Terminal | null, env: NodeJS.ProcessEnv): number {
  const explicit = Number(env.PIXEL_DISPLAY_SCALE);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (terminal?.reportsCssPixels) return 1;
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).scaleFactor;
}
