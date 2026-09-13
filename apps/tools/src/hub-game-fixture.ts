import { parseBuildLibrary } from "../../../src/shared/builds/parse-library";
/** Synthetic game command boundary for Hub. Runs the production apply runners offline. */
import { ref } from 'vue';
import { createDemoHost, type ToolsHost } from './host';
import { demoLibrary } from './fixtures';
import { liveParty, type LiveParty } from '../../../src/shared/builds/live-party';
import { buildId, teamId, mapTeamSlots, type BuildLibrary, skillBarOf, skillId, type Build, type HeroId, type ProfessionPair } from '../../../src/shared/builds/library';
import { ATTRIBUTES, PROFESSIONS } from '../../../src/shared/builds/heroes';
import { runBuildApply, runTeamApply, type TeamApplyCommands, type TeamApplyEnvironment } from '../../../src/shared/builds/team-apply-runner';
import { encodeSkillTemplate } from '../../../src/shared/builds/skill-template';

export function createHubGameFixture(record: (action: string) => void) {
  const base = createDemoHost();
  const first = demoLibrary.builds.find(build => build.professions[0] === 'Mo')!;
  const smiter: Build = { ...first, id: buildId('hub-smiter'), name: 'Smiter', origin: 'Templates/Skills/Smiter.txt' };
  const original = demoLibrary.teams[0]!;
  let library: BuildLibrary = { ...demoLibrary, builds: [...demoLibrary.builds, smiter], teams: [
    { ...original, id: teamId('hub-gom-afk'), name: 'GOM AFK', slots: mapTeamSlots(original.slots, slot => ({ ...slot, build: smiter.id })) }, ...demoLibrary.teams,
  ] };
  try { const saved = localStorage.getItem("hub-fixture-library"); if (saved) library = parseBuildLibrary(JSON.parse(saved)); } catch { /* Disposable fixture only. */ }
  let partial = false;
  let duplicate = false;
  let sent = 0;
  let clock = 0;
  const party = ref<LiveParty>(liveParty({ status: 'ready', partyObserved: true, party: {
    status: 'ready', rosterObserved: true, inOutpost: true, playRegion: 'pve', hardMode: false,
    unlockObserved: true, unlocked: Array.from({ length: 39 }, (_, i) => i + 1),
    slots: [{ index: 0, occupied: true, hero: null, agentId: 1, level: 20, professions: [3, 0], behaviour: null, skills: Array(8).fill(0), attributes: [], disabled: 0 }, ...original.slots.flatMap((slot, index) => slot.hero === null ? [] : [{ index, occupied: true, hero: Number(slot.hero), agentId: Number(slot.hero) + 100, level: 20, professions: [3, 0], behaviour: 1, skills: Array(8).fill(0), attributes: [], disabled: 0 }])],
  } }));
  // Distinct equipped bars make incoming/current comparisons visible in the workbench.
  party.value = { ...party.value,
    player: party.value.player ? { ...party.value.player, skills: skillBarOf(index => first.skills[(index + 1) % 8]!), attributes: first.attributes } : null,
    heroes: party.value.heroes.map((member, offset) => ({ ...member, skills: skillBarOf(index => first.skills[(index + offset + 2) % 8]!), attributes: first.attributes })),
  };
  const change = () => { sent++; record(`command:${sent}`); if (partial && sent > 1) throw new Error('Synthetic interruption. 1 change was confirmed before Apply stopped.'); };
  const professions = (previous: ProfessionPair | null, secondary: number): ProfessionPair => [previous?.[0] ?? 'Mo', Object.entries(PROFESSIONS).find(([, value]) => value.id === secondary)?.[0] as ProfessionPair[1] ?? null];
  const attributes = (ranks: readonly (readonly [number, number])[]) => Object.fromEntries(ranks.map(([id, rank]) => [Object.entries(ATTRIBUTES).find(([, value]) => value.id === id)?.[0] ?? '', rank]));
  const player = (patch: Partial<NonNullable<LiveParty['player']>>) => { change(); party.value = { ...party.value, player: party.value.player ? { ...party.value.player, ...patch } : null }; };
  const hero = (id: HeroId, patch: Partial<LiveParty['heroes'][number]>) => { change(); party.value = { ...party.value, heroes: party.value.heroes.map(member => member.hero === id ? { ...member, ...patch } : member) }; };
  const commands: TeamApplyCommands = {
    cancelPending() {},
    setHardMode(value) { change(); party.value = { ...party.value, hardMode: value }; },
    setPlayerSecondary(value) { player({ professions: professions(party.value.player?.professions ?? null, value) }); },
    setPlayerSkills(value) { player({ skills: skillBarOf(index => value[index] ? skillId(value[index]!) : null) }); },
    setPlayerAttributes(value) { player({ attributes: attributes(value) }); },
    addHero(id) {
      change(); const slot = library.teams[0]!.slots.find(slot => slot.hero === id);
      const build = library.builds.find(build => build.id === slot?.build);
      party.value = { ...party.value, heroes: [...party.value.heroes, { hero: id, agentId: Number(id) + 100,
        slot: null, professions: build?.professions ?? ['Mo', null], skills: skillBarOf(() => null), attributes: {}, behaviour: 'guard', level: 20 }] };
    },
    kickHero(id) { change(); party.value = { ...party.value, heroes: party.value.heroes.filter(member => member.hero !== id) }; },
    setHeroSecondary(id, value) { hero(id, { professions: professions(party.value.heroes.find(member => member.hero === id)?.professions ?? null, value) }); },
    setHeroSkills(id, value) { hero(id, { skills: skillBarOf(index => value[index] ? skillId(value[index]!) : null) }); },
    setHeroAttributes(id, value) { hero(id, { attributes: attributes(value) }); },
    setHeroBehaviour(id, value) { hero(id, { behaviour: value === 0 ? 'fight' : value === 1 ? 'guard' : 'avoid' }); },
  };
  const environment = (): TeamApplyEnvironment => ({ commands, party: () => party.value,
    confirmationTime: { now: () => clock, sleep: async milliseconds => { clock += milliseconds; } } });
  const host: ToolsHost = { ...base, party,
    async loadLibrary() { return { library, recovered: false }; },
    async saveLibrary(value) { library = value; localStorage.setItem("hub-fixture-library", JSON.stringify(value)); return value; },
    async loadTemplates() { return [
      { path: 'Skills/Monk/Protection.txt', contents: encodeSkillTemplate(first) ?? '' },
      { path: 'Skills/Mesmer/Panic.txt', contents: encodeSkillTemplate(demoLibrary.builds.find(build => build.professions[0] === 'Me')!) ?? '' },
      ...(duplicate ? [{ path: 'Other/Smiter.txt', contents: encodeSkillTemplate(smiter) ?? '' }] : []),
    ]; },
    async applyTeam(plan, onEvent) { record('apply-team'); return runTeamApply(plan, { ...environment(), ...(onEvent ? { onEvent } : {}) }, 1); },
    async applyBuild(build, id, onEvent) { record('apply-build'); return runBuildApply(build, id, { ...environment(), ...(onEvent ? { onEvent } : {}) }, 2); },
    async openStorage() { throw new Error('Synthetic storage refusal'); },
  };
  return { host, setScenario(value: string) {
    partial = value === 'partial'; duplicate = value === 'duplicate'; sent = 0;
    party.value = { ...party.value, status: value === 'unobserved-builds' ? 'unavailable' : 'ready', inOutpost: value !== 'explorable' };
  } };
}
