import type { WebContents } from "electron";

const ZOOM_PRESETS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
];

const MIN_ZOOM = ZOOM_PRESETS[0];
const MAX_ZOOM = ZOOM_PRESETS.at(-1)!;

export function clampZoom(factor: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor));
}

export type ZoomDirection = 1 | -1 | 0;

export class PageZoom {
  constructor(
    private readonly contents: WebContents,
    private base: number,
    private userFactor = 1,
  ) {
    contents.setZoomMode("isolated");
    contents.on("did-navigate", () => this.apply());
    this.apply();
  }

  get factor(): number {
    return this.boundedFactor(this.userFactor);
  }

  get state(): { base: number; factor: number } {
    return { base: this.base, factor: this.userFactor };
  }

  step(direction: ZoomDirection): number {
    const current = this.factor;
    const factor = direction === 0 ? 1 : direction === 1
      ? (ZOOM_PRESETS.find((preset) => preset > current * 1.001) ?? MAX_ZOOM)
      : ([...ZOOM_PRESETS].reverse().find((preset) => preset < current * 0.999) ?? MIN_ZOOM);
    this.userFactor = this.boundedFactor(factor);
    this.apply();
    return this.factor;
  }

  setBaseZoom(base: number): void {
    this.base = base;
    this.apply();
  }

  private boundedFactor(factor: number): number {
    return Math.min(MAX_ZOOM / this.base, Math.max(MIN_ZOOM / this.base, factor));
  }

  private apply(): void {
    this.contents.setZoomFactor(clampZoom(this.base * this.factor));
  }
}

export function zoomDirection(key: string): ZoomDirection | null {
  if (key === "=" || key === "+") return 1;
  if (key === "-" || key === "_") return -1;
  if (key === "0") return 0;
  return null;
}
