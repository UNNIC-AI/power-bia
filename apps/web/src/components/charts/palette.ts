import type { Theme } from '../../lib/theme.ts';

/**
 * Eight categorical hues, each mode stepped for its own surface rather than
 * flipped. Validated with the data-viz six checks against the daisyUI surfaces:
 * lightness band, chroma floor, adjacent-pair CVD separation, normal-vision
 * floor, contrast. The dark column was measured on daisyUI `dark` (base-100
 * oklch 25%) and the app now paints `black` (oklch 0%), which only widens the
 * gap between every hue and its surface - the checks hold a fortiori.
 *
 * Slots are assigned in fixed order and never cycled - the API folds anything
 * past the eighth series into "Otros", so a ninth hue is never needed.
 *
 * Light mode carries a contrast warning on aqua, yellow and magenta (below 3:1
 * on white), which obliges the relief rule: a legend is always present for two
 * or more series and every mark has a hover tooltip.
 */
const CATEGORICAL: Record<Theme, readonly string[]> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

export function palette(theme: Theme): readonly string[] {
  return CATEGORICAL[theme];
}

export function seriesColor(theme: Theme, index: number): string {
  const colors = CATEGORICAL[theme];

  return colors[index % colors.length] ?? colors[0] ?? '#2a78d6';
}

/** Recessive grid and axis ink, taken from the theme rather than hardcoded. */
export const AXIS_INK = 'color-mix(in oklab, currentColor 55%, transparent)';
export const GRID_INK = 'color-mix(in oklab, currentColor 12%, transparent)';
export const SURFACE = 'var(--color-base-100)';
