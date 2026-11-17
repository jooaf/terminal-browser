import type { EngineInfo } from "./react";
import { clampZoom } from "./web/zoom";

const DEFAULT_WEB_FONT_SIZE = 16;

type TerminalMetrics = Pick<EngineInfo, "width" | "height" | "basePx" | "cellHeight">;

export function terminalZoom(info: TerminalMetrics, displayScale: number): number | null {
  const measurements = [info.width, info.height, info.basePx, info.cellHeight, displayScale];
  if (measurements.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return clampZoom(info.basePx / (DEFAULT_WEB_FONT_SIZE * displayScale));
}
