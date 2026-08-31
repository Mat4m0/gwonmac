import type { TraderItem, TraderProfession } from "./trader-catalog";
import { professionPresentation } from "../../../src/shared/profession-assets";

const ASSETS = import.meta.glob<string>("./assets/trader/**/*.png", {
  eager: true,
  import: "default",
  query: "?url",
});

const PROFESSION_IDS: Readonly<Partial<Record<TraderProfession, number>>> = Object.freeze({
  warrior: 1,
  ranger: 2,
  monk: 3,
  necromancer: 4,
  mesmer: 5,
  elementalist: 6,
  assassin: 7,
  ritualist: 8,
  paragon: 9,
  dervish: 10,
});

export function traderItemIcon(item: TraderItem): string {
  if (item.category === "dyes") {
    const color = item.name.match(/\[([^\]]+)\]/u)?.[1]?.toLocaleLowerCase();
    return requiredAsset(`dyes/${color}.png`);
  }
  if (item.category === "runes") {
    const modelId = Number.parseInt(item.modelId.slice(2, 6), 16);
    return requiredAsset(`runes/${modelId}.png`);
  }
  return requiredAsset(`materials/${item.modelId}.png`);
}

export function traderProfessionIcon(profession: TraderProfession): string {
  const icon = professionPresentation(PROFESSION_IDS[profession] ?? 0)?.icon;
  if (!icon) throw new Error(`missing trader profession asset: ${profession}`);
  return icon;
}

function requiredAsset(path: string): string {
  const asset = ASSETS[`./assets/trader/${path}`];
  if (!asset) throw new Error(`missing trader asset: ${path}`);
  return asset;
}
