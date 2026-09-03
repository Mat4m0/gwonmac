/** Color contrast and readable foregrounds shared by game panels and their
 * launcher preview. These projections never change the saved palette. */
import type { UiThemeColor } from "./ui-theme.js";

export const parseRgb = (color: UiThemeColor): readonly [number, number, number] => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
];

const luminance = (color: UiThemeColor): number => {
  const channels = parseRgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
};

export function contrastRatio(a: UiThemeColor, b: UiThemeColor): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

export function readableForeground(background: UiThemeColor): UiThemeColor {
  const dark = "#171613" as UiThemeColor;
  const light = "#F7F3E8" as UiThemeColor;
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

/** Find one neutral foreground that remains as readable as possible across
 * structural and recessed surfaces, including deliberately opposing colors. */
export function readableSharedForeground(
  backgrounds: readonly UiThemeColor[],
): UiThemeColor {
  let best = "#F7F3E8" as UiThemeColor;
  let bestMinimum = 0;
  for (let channel = 0; channel <= 255; channel += 1) {
    const hex = channel.toString(16).padStart(2, "0").toUpperCase();
    const candidate = `#${hex}${hex}${hex}` as UiThemeColor;
    const minimum = Math.min(...backgrounds.map((background) =>
      contrastRatio(background, candidate)));
    if (minimum > bestMinimum) {
      best = candidate;
      bestMinimum = minimum;
    }
  }
  return best;
}

function blendColor(
  from: UiThemeColor,
  to: UiThemeColor,
  amount: number,
): UiThemeColor {
  const fromRgb = parseRgb(from);
  const toRgb = parseRgb(to);
  const channels = fromRgb.map((channel, index) =>
    Math.round(channel + (toRgb[index]! - channel) * amount));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0"))
    .join("").toUpperCase()}` as UiThemeColor;
}

export function compositeColor(
  foreground: UiThemeColor,
  background: UiThemeColor,
  opacity: number,
): UiThemeColor {
  return blendColor(background, foreground, opacity);
}

/** Keep a player's chosen ink when it is readable. Otherwise move it by the
 * smallest possible amount toward light or dark until every rendered surface
 * reaches WCAG AA. This includes the bright-game worst case behind the window
 * opacity, which opaque-palette checks miss. */
export function accessibleForeground(
  preferred: UiThemeColor,
  backgrounds: readonly UiThemeColor[],
  minimum = 4.5,
): UiThemeColor {
  if (backgrounds.every((background) => contrastRatio(background, preferred) >= minimum)) {
    return preferred;
  }
  for (let step = 1; step <= 255; step += 1) {
    const amount = step / 255;
    for (const target of ["#F7F3E8", "#171613"] as const) {
      const candidate = blendColor(preferred, target, amount);
      if (backgrounds.every((background) => contrastRatio(background, candidate) >= minimum)) {
        return candidate;
      }
    }
  }
  return readableSharedForeground(backgrounds);
}
