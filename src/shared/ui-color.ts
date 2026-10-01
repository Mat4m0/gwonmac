/** Color contrast and readable foregrounds shared by game panels and their
 * launcher preview. These projections never change the saved palette. */
import type { UiThemeColor } from "./ui-theme.js";

export const parseRgb = (color: UiThemeColor): readonly [number, number, number] => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
];

const toLinear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = (color: UiThemeColor): number => {
  const channels = parseRgb(color).map(toLinear);
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
 * reaches WCAG AA when possible. Opposing surfaces use the best shared
 * neutral fallback, which can remain below AA. This includes the bright-game
 * worst case behind window opacity, which opaque-palette checks miss. */
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

type Oklch = readonly [lightness: number, chroma: number, hue: number];

function toOklch(color: UiThemeColor): Oklch {
  const [r, g, b] = parseRgb(color).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, bAxis), Math.atan2(bAxis, a)];
}

/** The sRGB colour for an OKLCH value, or null when sRGB cannot show it. */
function fromOklch([lightness, chroma, hue]: Oklch): UiThemeColor | null {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (linear.some((channel) => channel < -1e-4 || channel > 1 + 1e-4)) return null;
  return `#${linear.map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255).toString(16).padStart(2, "0");
  }).join("").toUpperCase()}` as UiThemeColor;
}

/** Like accessibleForeground, for a colour whose hue carries meaning, such as
 * an accent used as text. Only its OKLCH lightness moves, by the smallest
 * step that reaches the minimum; chroma falls only where sRGB cannot show it
 * at that lightness. The accent therefore stays recognisably the same colour. */
export function accessibleTint(
  preferred: UiThemeColor,
  backgrounds: readonly UiThemeColor[],
  minimum = 4.5,
): UiThemeColor {
  const reads = (candidate: UiThemeColor) =>
    backgrounds.every((background) => contrastRatio(background, candidate) >= minimum);
  if (reads(preferred)) return preferred;
  const [lightness, chroma, hue] = toOklch(preferred);
  for (let step = 1; step <= 200; step += 1) {
    for (const candidateLightness of [lightness + step / 200, lightness - step / 200]) {
      if (candidateLightness < 0 || candidateLightness > 1) continue;
      let candidateChroma = chroma;
      let candidate = fromOklch([candidateLightness, candidateChroma, hue]);
      while (!candidate && candidateChroma > 0) {
        candidateChroma = Math.max(0, candidateChroma - 0.002);
        candidate = fromOklch([candidateLightness, candidateChroma, hue]);
      }
      if (candidate && reads(candidate)) return candidate;
    }
  }
  return accessibleForeground(preferred, backgrounds, minimum);
}
