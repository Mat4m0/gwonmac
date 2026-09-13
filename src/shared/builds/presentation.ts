/**
 * Compact build metadata shared by Hub results and the library.
 * Full names remain available alongside the abbreviated visual labels.
 */
import { ATTRIBUTES, PROFESSIONS } from './heroes.js';
import type { Attribute, Build, Profession } from './library.js';
import { professionPresentation } from '../profession-assets.js';

const ATTRIBUTE_LABELS = {
  FastCasting: 'FC', IllusionMagic: 'IM', DominationMagic: 'DM', InspirationMagic: 'InM',
  BloodMagic: 'BM', DeathMagic: 'Death', SoulReaping: 'SR', Curses: 'Curses',
  AirMagic: 'Air', EarthMagic: 'Earth', FireMagic: 'Fire', WaterMagic: 'Water', EnergyStorage: 'ES',
  HealingPrayers: 'HP', SmitingPrayers: 'SmP', ProtectionPrayers: 'PP', DivineFavor: 'DF',
  Strength: 'Str', AxeMastery: 'Axe', HammerMastery: 'Hammer', Swordsmanship: 'Sword', Tactics: 'Tac',
  BeastMastery: 'Beast', Expertise: 'Exp', WildernessSurvival: 'WS', Marksmanship: 'Marks',
  DaggerMastery: 'Dagger', DeadlyArts: 'DA', ShadowArts: 'SA', CriticalStrikes: 'CS',
  Communing: 'Comm', RestorationMagic: 'RM', ChannelingMagic: 'ChM', SpawningPower: 'SP',
  SpearMastery: 'Spear', Command: 'Cmd', Motivation: 'Mot', Leadership: 'Lead',
  ScytheMastery: 'Scythe', WindPrayers: 'WP', EarthPrayers: 'EP', Mysticism: 'Myst',
} satisfies Record<Attribute, string>;

export function buildProfessions(professions: readonly (Profession | null)[]) {
  return professions.flatMap(code => {
    if (!code) return [];
    const presentation = professionPresentation(PROFESSIONS[code].id);
    return presentation ? [{ ...presentation, code }] : [];
  });
}

export function buildAttributes(attributes: Build['attributes']) {
  return Object.entries(PROFESSIONS).flatMap(([profession, facts]) => {
    const ranks = Object.entries(ATTRIBUTE_LABELS).flatMap(([key, label]) => {
      const attribute = key as Attribute;
      const rank = attributes[attribute];
      return rank && ATTRIBUTES[attribute].profession === profession
        ? [{ label, rank: Number(rank), name: attribute.replace(/([a-z])([A-Z])/gu, '$1 $2') }] : [];
    });
    const presentation = professionPresentation(facts.id);
    return ranks.length && presentation ? [{ ...presentation, attributes: ranks }] : [];
  });
}
