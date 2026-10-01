/** Hub presentation over the existing library controller and bounded apply owners. */
import { watch } from 'vue';
import { diffBuilds, diffSummary } from '../../../src/shared/builds/diff';
import { buildAttributes, buildProfessions } from '../../../src/shared/builds/presentation';
import { hubMatch, parseHubQuery, type HubPresenter, type HubRow, type HubSource, type HubTask } from '../../../src/shared/hub';
import { buildId, skillId, type Build, type Team, type HeroId } from '../../../src/shared/builds/library';
import { heroLabel, PROFESSIONS } from '../../../src/shared/builds/heroes';
import { decodeSkillTemplate } from '../../../src/shared/builds/skill-template';
import { preflightTeamApply, resolveTeamApplyPlan, type TeamApplyPlan } from '../../../src/shared/builds/team-apply';
import type { TeamApplyEvent } from '../../../src/shared/builds/team-apply-runner';
import { teamApplyStoredProblemMessage, teamApplyRuntimeProblemMessage } from './team-apply-presentation';
import type { LibraryController } from './use-library';
import type { ToolsHost } from './host';

type Item = { kind: 'team'; value: Team } | { kind: 'build'; value: Build };
// Only native template records have a current folder; import provenance is not a folder.
function templateFolder(build: Build): string | null {
  if (!String(build.id).startsWith('template:')) return null;
  const parts = (build.origin ?? '').replaceAll('\\', '/').split('/'); parts.pop();
  const skills = parts.findIndex(part => part.toLowerCase() === 'skills');
  return (skills < 0 ? parts : parts.slice(skills + 1)).join('/');
}
function folderMatches(folder: string | null, query: string): boolean {
  if (folder === null || !query) return false;
  if (query === '/') return folder === '';
  const parts = folder.toLowerCase().split('/');
  const wanted = query.split('/').filter(Boolean);
  if (!wanted.length) return false;
  return parts.some((_, start) => (!query.startsWith('/') || start === 0)
    && wanted.every((part, index) => {
      const actual = parts[start + index];
      return actual !== undefined && (index < wanted.length - 1 || query.endsWith('/') ? actual === part : actual.startsWith(part));
    }));
}
function matchesBuild(build: Build, query: string): boolean {
  const parsed = parseHubQuery(query);
  if (parsed.scope === 'build') query = parsed.term;
  if (['build', 'builds'].includes(query)) query = '';
  const folder = templateFolder(build);
  const aliases = [build.professions[0], PROFESSIONS[build.professions[0]].name, ...build.tags, ...(folder?.split('/') ?? [])];
  // Quotes group names with spaces; an unfinished quote remains useful while typing.
  const tokens = query.toLowerCase().replaceAll('\\', '/').match(/(?:[^\s"]+|"[^"]*"?)+/gu) ?? [];
  return tokens.every(raw => {
    const token = raw.replaceAll('"', '');
    if (token.startsWith('folder:')) return folderMatches(folder, token.slice(7));
    if (token.includes('/')) {
      const pair = token.split('/');
      const professionPair = pair.length === 2 && pair.every(code => Object.keys(PROFESSIONS).some(profession => profession.toLowerCase() === code));
      return professionPair ? token === build.professions.filter(Boolean).join('/').toLowerCase() : folderMatches(folder, token);
    }
    const profession = Object.entries(PROFESSIONS).find(([code, facts]) => code.toLowerCase() === token || facts.name.toLowerCase() === token);
    // A full profession name filters; a short code is also the start of a word while typing,
    // so `air p` still finds "Air pressure" (D-17, HUB-059). Monk builds rank first by their code.
    if (profession && !raw.startsWith('"')) return build.professions[0] === profession[0]
      || (profession[1].name.toLowerCase() !== token && hubMatch(build.name, token, aliases) !== null);
    return hubMatch(build.name, token, aliases) !== null;
  });
}

export function createHubLibrary(controller: LibraryController, host: ToolsHost, hub: HubPresenter<HTMLElement>, openWorkspace?: (item: Build | Team) => void) {
  let templates: readonly Build[] = [];
  let templateProblem = '';
  let unreadable: string[] = [];
  let reading = false;
  let templateRead = 0;
  let visible = false;
  let disposed = false;
  let applying = false;
  /** The running apply's named, counted progress: "Applying GOM AFK… 5/16". */
  let progress = '';
  /** The last failed apply per team or build target; it outlives the Hub and its review (HUB-016). */
  const outcomes = new Map<string, Readonly<{ partial: boolean; message: string; completed: readonly string[] }>>();
  const outcomeKey = (item: Item, hero: HeroId | null) => item.kind === 'team' ? `team:${item.value.id}` : `build:${item.value.id}:${hero ?? 'me'}`;
  const teamDetail = (item: Item & { kind: 'team' }) => {
    const outcome = outcomes.get(outcomeKey(item, null));
    if (outcome) return `${outcome.partial ? 'Partly applied' : 'Not applied'} · Review`;
    const heroes = item.value.slots.slice(1).filter(slot => slot.hero !== null).length;
    return `Saved team · ${item.value.mode === 'none' ? 'Keep difficulty' : `${item.value.mode === 'hard' ? 'Hard' : 'Normal'} Mode`} · ${heroes} ${heroes === 1 ? 'hero' : 'heroes'}`;
  };
  /** While an apply runs, its footer and a repeated Enter name it (HUB-083). */
  const applyPending = (name: string) => ({ label: `Applying ${name}…`, again: `${name} is still being applied.` });
  /** The outcome key of the running apply, so only its own rows and review show its progress. */
  let runningKey = '';
  const listeners = new Set<() => void>();
  const refresh = () => { for (const listener of listeners) listener(); };
  const stop = watch([controller.library, controller.loading, host.party, controller.applying, controller.applyStatus, controller.recentBuilds], refresh, { flush: 'sync' });
  const all = (): Item[] => [...(controller.library.value?.teams ?? []).map(value => ({ kind: 'team' as const, value })),
    ...[...(controller.library.value?.builds ?? []), ...templates].map(value => ({ kind: 'build' as const, value }))];
  const current = (item: Item) => disposed ? undefined : all().find(candidate => candidate.kind === item.kind && candidate.value.id === item.value.id);
  const revision = (item: Item) => JSON.stringify(item.kind === 'team' ? [item.value, controller.library.value?.builds] : item.value);
  const playerName = () => { const source = window.gwCharacterSwitch; const state = source?.characters; return source && ['outpost', 'pve-explorable', 'pvp-explorable'].includes(source.context) && state?.status === 'ready' && state.selectedIndex !== null ? state.characters[state.selectedIndex]?.name ?? 'Your character' : 'Your character'; };
  const targetName = (hero: HeroId | null) => hero === null ? playerName() : heroLabel(hero);
  /** The footer names the build and its target before Enter: "Apply Smiter to Fixture Monk". */
  const applyAction = (build: Build, hero: HeroId | null) => { const target = targetName(hero); return `Apply ${build.name} to ${target === 'Your character' ? 'your character' : target}`; };
  const skillPreview = (build: Pick<Build, 'skills'>) => build.skills.map(id => {
    const skill = id === null ? null : host.skills.get(id);
    return { name: skill?.name ?? (id === null ? 'Empty slot' : `Unknown skill ${id}`), iconUrl: skill?.iconUrl ?? null, elite: skill?.elite ?? false, description: skill?.description ?? null };
  });
  const attributesPreview = (attributes: Build['attributes'] | null) => attributes === null ? 'Attributes not available'
    : Object.entries(attributes).map(([name, rank]) => `${name.replace(/([a-z])([A-Z])/gu, '$1 $2')} ${rank}`).join(' · ') || 'No attribute points assigned';
  const buildPreview = (build: Pick<Build, 'professions' | 'attributes'>) => `${build.professions.filter(Boolean).join('/')}\n${attributesPreview(build.attributes)}`;
  const equipped = (hero: HeroId | null, incoming?: Build) => {
    const party = host.party.value;
    const member = party.status === 'ready' ? hero === null ? party.player : party.heroes.find(member => member.hero === hero) : null;
    const comparison = incoming && member?.skills && member.attributes && member.professions
      ? diffBuilds({ skills: member.skills, attributes: member.attributes, professions: member.professions }, incoming) : null;
    const attributes = buildAttributes(member?.attributes ?? {});
    if (incoming && member?.attributes) {
      for (const group of buildAttributes(incoming.attributes)) {
        let existing = attributes.find(candidate => candidate.name === group.name);
        if (!existing) { existing = { ...group, attributes: [] }; attributes.push(existing); }
        for (const attribute of group.attributes) if (!existing.attributes.some(candidate => candidate.name === attribute.name)) existing.attributes.push({ ...attribute, rank: 0 });
      }
    }
    const nextRanks = new Map(incoming ? buildAttributes(incoming.attributes).flatMap(group => group.attributes.map(attribute => [attribute.name, attribute.rank] as const)) : []);
    const secondary = incoming && member?.professions && member.professions[1] !== incoming.professions[1]
      ? `Secondary profession: ${member.professions[1] === null ? 'None' : PROFESSIONS[member.professions[1]].name} → ${incoming.professions[1] === null ? 'None' : PROFESSIONS[incoming.professions[1]].name}` : '';
    return {
      detail: [(applying && incoming && runningKey === outcomeKey({ kind: 'build', value: incoming }, hero) ? progress : '') || (!member?.skills ? 'Current build not available' : comparison?.total === 0 ? 'Already equipped' : comparison ? `Current build · ${diffSummary(comparison)}` : 'Current build'), secondary].filter(Boolean).join(' · '),
      professions: buildProfessions(member?.professions ?? []),
      ...(member?.skills ? { skills: skillPreview({ skills: member.skills }).map((skill, index) => ({ ...skill, changed: !!incoming && member.skills?.[index] !== incoming.skills[index] })),
        attributes: attributes.map(group => ({ ...group, attributes: group.attributes.map(attribute => ({ ...attribute, ...(incoming && member.attributes ? { nextRank: nextRanks.get(attribute.name) ?? 0 } : {}) })) })),
        ...(member.attributes === null ? { attributeStatus: 'Invested attributes not available' } : {}) } : {}),
    };
  };
  /** Describes the current canonical plan, including removals absent from the saved roster. */
  const teamChanges = (team: Team): string[] => {
    const library = controller.library.value;
    if (!library) return [];
    const resolved = resolveTeamApplyPlan(team, library, controller.validate);
    if (!resolved.valid) return [];
    const checked = preflightTeamApply(resolved.plan, host.party.value);
    if (!checked.ready) return [];
    if (!checked.changes.length) return ['Already matches'];
    const removed = checked.changes.filter(change => change.kind === 'remove-hero').flatMap(change => change.hero === undefined ? [] : [heroLabel(change.hero)]);
    const heroBuilds = checked.changes.filter(change => change.kind === 'hero-build').length;
    const behaviours = checked.changes.filter(change => change.kind === 'behaviour').length;
    return [
      ...(removed.length ? [`Removes ${removed.join(', ')}`] : []),
      ...checked.changes.flatMap(change => {
        switch (change.kind) {
          case 'remove-hero': return [];
          case 'mode': return [`Switches to ${team.mode === 'hard' ? 'Hard' : 'Normal'} Mode`];
          case 'rebuild-roster': return ['Rebuilds hero order'];
          case 'player-build': return ['Update your build'];
          case 'add-hero': return [`Add ${heroLabel(change.hero!)}`];
          case 'hero-build':
          case 'behaviour': return [];
        }
      }),
      ...(heroBuilds ? [`Update ${heroBuilds} hero ${heroBuilds === 1 ? 'build' : 'builds'}`] : []),
      ...(behaviours ? [`Update ${behaviours} hero ${behaviours === 1 ? 'behaviour' : 'behaviours'}`] : []),
    ];
  };
  const preview = (item: Item) => item.kind === 'build' ? buildPreview(item.value)
    : `${teamChanges(item.value).join('\n')}\n${item.value.mode === 'none' ? 'Keep difficulty' : `${item.value.mode === 'hard' ? 'Hard' : 'Normal'} Mode`}\n` + item.value.slots.flatMap((slot, index) => {
      if (index > 0 && slot.hero === null && slot.build === null) return [];
      const build = controller.library.value?.builds.find(build => build.id === slot.build);
      return [`${index + 1}. ${index === 0 ? playerName() : slot.hero === null ? 'Unassigned hero' : heroLabel(slot.hero)} · ${build?.name ?? 'Keep build'}${slot.behaviour ? ` · ${slot.behaviour}` : ''}`];
    }).join('\n');
  function assess(item: Item, hero: HeroId | null): string | null {
    if (disposed) return 'Build Library is unavailable.';
    if (host.applyUnavailable) return host.applyUnavailable;
    // The running item names its own progress; every other item waits for it.
    if (applying || controller.applying.value) return applying && runningKey === outcomeKey(item, hero) && progress ? progress : 'An application is in progress.';
    let plan: TeamApplyPlan;
    if (item.kind === 'team') {
      const library = controller.library.value;
      if (!library) return 'Library is loading.';
      const result = resolveTeamApplyPlan(item.value, library, controller.validate);
      if (!result.valid) return result.problems.map(problem => {
        const message = teamApplyStoredProblemMessage(problem);
        return 'slot' in problem && ['duplicate-hero', 'party-gap'].includes(problem.rule) ? `Slot ${problem.slot + 1}: ${message}` : message;
      }).join('\n');
      plan = result.plan;
    } else {
      if (!controller.validate(item.value, hero === null ? 'player' : 'hero').valid) return 'This build has invalid skills or attributes.';
      if (hero !== null && !host.party.value.heroes.some(member => member.hero === hero)) return 'This hero is no longer in your party.';
      const member = { hero, build: item.value, behaviour: null };
      plan = { mode: 'none', members: hero === null ? [member] : [{ hero: null, build: null, behaviour: null }, member] };
    }
    const checked = preflightTeamApply(plan, host.party.value);
    return checked.ready ? null : checked.blockers.map(problem => teamApplyRuntimeProblemMessage(problem, id => host.skills.get(id).name, item.kind)).join('\n');
  }
  async function readTemplates() {
    const read = ++templateRead;
    reading = true; refresh();
    let entries: Awaited<ReturnType<ToolsHost['loadTemplates']>>;
    try { entries = await host.loadTemplates(); }
    catch (error) { if (read === templateRead) { templateProblem = 'Could not read templates.'; reading = false; refresh(); } throw error; }
    if (disposed || read !== templateRead) return;
    templateProblem = ''; reading = false; unreadable = [];
    templates = entries.flatMap(entry => {
      if (/(^|\/)Equipment\//iu.test(entry.path)) return [];
      const decoded = decodeSkillTemplate(entry.contents.trim());
      if (!decoded) { unreadable.push(entry.path.split('/').pop() ?? 'Unnamed template'); return []; }
      return [{ ...decoded, id: buildId(`template:${entry.path}`), name: entry.path.split('/').pop()?.replace(/\.txt$/iu, '') ?? entry.path,
        origin: entry.path, tags: [], notes: '', favourite: false, lastUsed: null, parent: null }];
    });
  }
  /**
   * Applies once and names the outcome. The Hub page that started it closes with the receipt;
   * after the player moved on, a success is a receipt and a failure names the item (HUB-004, HUB-016).
   */
  async function apply(item: Item, expected: string, hero: HeroId | null, task: HubTask) {
    if (item.kind === 'build' && String(item.value.id).startsWith('template:')) await readTemplates();
    const next = current(item);
    if (!next || revision(next) !== expected) throw new Error('This saved configuration changed. Review it again.');
    const refusal = assess(next, hero);
    if (refusal) throw new Error(refusal);
    const name = next.value.name;
    if (next.kind === 'team' && controller.library.value) {
      const resolved = resolveTeamApplyPlan(next.value, controller.library.value, controller.validate);
      if (resolved.valid) {
        const checked = preflightTeamApply(resolved.plan, host.party.value);
        if (checked.ready && !checked.changes.length) { outcomes.delete(outcomeKey(next, hero)); refresh(); task.done(`${name} already matches.`); return; }
      }
    }
    const key = outcomeKey(next, hero);
    let landed = 0;
    const completed: string[] = [];
    const step = (event?: TeamApplyEvent) => {
      const changes = event?.changes;
      if (changes && changes.done > landed && (event.state === 'confirmed' || event.state === 'stable')) completed.push(event.message[0]!.toUpperCase() + event.message.slice(1));
      if (changes) landed = changes.done;
      // The change being worked on, out of those the party needed; it reaches N/N as the last one lands.
      const current = changes && Math.min(changes.planned, changes.done + (event?.state === 'confirmed' || event?.state === 'stable' ? 0 : 1));
      progress = `Applying ${name}…${changes ? ` ${current}/${changes.planned}` : ''}`;
      task.progress(progress); refresh();
    };
    runningKey = key; applying = true; outcomes.delete(key); step();
    try {
      const result = next.kind === 'team' ? await controller.applyTeam(next.value, step) : await host.applyBuild(next.value, hero, step);
      if (!result) throw new Error(controller.applyStatus.value?.message ?? 'Application stopped.');
      landed = result.completedChanges;
      if (result.skippedSkills.length) throw new Error(`Partly applied. Not equipped: ${result.skippedSkills.map(id => host.skills.get(skillId(id)).name).join(', ')}. Review before retrying.`);
      const saved = next.kind === 'build' ? await controller.recordBuildUse(next.value.id, hero) : true;
      if (next.kind === 'team' && result.completedChanges === 0) { task.done(`${name} already matches.`); return; }
      task.done(`${name} applied${next.kind === 'build' ? ` to ${targetName(hero)}` : ''}.${saved ? '' : ' Recent use could not be saved.'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Application stopped.';
      const partial = landed > 0;
      outcomes.set(key, { partial, message: partial && next.kind === 'team' ? `Team partly applied. ${message[0]?.toUpperCase() ?? ''}${message.slice(1)}` : message, completed });
      if (task.live()) throw error;
      throw new Error(partial ? `${name} partly applied. Open Hub to review.` : `${name} was not applied. ${message}`, { cause: error });
    } finally { applying = false; progress = ''; refresh(); }
  }
  const workspace = (build: Build) => templateFolder(build) === null && openWorkspace ? { workspace: () => openWorkspace(build) } : {};
  function chooseBuild(item: Item & { kind: 'build' }, recentHero?: HeroId | null) {
    const expected = revision(item);
    const summary = { ...workspace(item.value), label: 'Build to apply', title: item.value.name, detail: '', folder: templateFolder(item.value), skills: skillPreview(item.value), attributes: buildAttributes(item.value.attributes), professions: buildProfessions(item.value.professions) };
    const unavailable = (hero: HeroId | null) => {
      const latest = current(item);
      return !latest || revision(latest) !== expected ? 'This saved build changed. Go back and select it again.' : assess(item, hero);
    };
    const applyRow = (hero: HeroId | null, title: string): HubRow => {
      const refusal = unavailable(hero);
      return { id: `apply:${hero ?? 'me'}`, title, ...equipped(hero, item.value), group: 'Current build',
        action: applyAction(item.value, hero), consequential: true, pending: applyPending(item.value.name),
        ...(refusal ? { unavailable: refusal } : {}), run: task => apply(item, expected, hero, task) };
    };
    function compareTarget(hero: HeroId | null) {
      hub.showRows(targetName(hero), () => [applyRow(hero, hero === null ? 'Apply to me' : `Apply to ${targetName(hero)}`)], summary, undefined, source);
    }
    function chooseHero() {
      hub.showRows('Heroes', () => {
        const party = host.party.value;
        const heroes = new Set([...party.heroes.map(member => member.hero),
          ...[...(party.accountHeroes ?? [])].filter(([, facts]) => facts.availability === 'unlocked').map(([id]) => id)]);
        const rows = [...heroes].map((id): HubRow => {
          const member = party.heroes.find(member => member.hero === id);
          const professions = member?.professions ?? party.accountHeroes?.get(id)?.professions;
          const refusal = member ? unavailable(id) : `Add ${heroLabel(id)} to your party first.`;
          const currentBuild = equipped(id, item.value);
          const detail = refusal ?? currentBuild.detail;
          return { id: `hero:${id}`, title: heroLabel(id), ...currentBuild, detail: member?.slot !== null && member?.slot !== undefined ? `Slot ${member.slot + 1} · ${detail}` : detail, group: member ? 'In your party' : 'Unlocked heroes',
            keywords: professions?.flatMap(value => value ? [PROFESSIONS[value].name] : []).join(' ') ?? '',
            preferred: !refusal, consequential: !refusal, action: refusal ? 'Review availability' : applyAction(item.value, id), ...(refusal ? { readOnly: true } : { pending: applyPending(item.value.name) }),
            navigate: () => compareTarget(id), run: (task: HubTask) => refusal ? compareTarget(id) : apply(item, expected, id, task) };
        }).sort((a, b) => Number(a.group !== 'In your party') - Number(b.group !== 'In your party') || (a.group === 'In your party' ? 0 : a.title.localeCompare(b.title)));
        return rows.length ? rows : [{ id: 'heroes-unavailable', title: 'No heroes observed', detail: 'Enter a PvE outpost to read your heroes.', group: 'Heroes', action: 'Choose hero', unavailable: 'Hero information is not available yet.', run() {} }];
      }, summary, undefined, source);
    }
    if (recentHero !== undefined) { compareTarget(recentHero); return; }
    hub.showRows(item.value.name, () => [
      { ...applyRow(null, 'Apply to me'), detail: `${playerName()} · ${equipped(null, item.value).detail}`, group: 'Targets' },
      { id: 'choose-hero', title: 'Apply to hero', detail: 'Compare your heroes’ current builds', group: 'Targets', action: 'Choose hero', navigate: chooseHero, run: chooseHero },
    ], summary, undefined, source);
  }
  const buildRow = (item: Item & { kind: 'build' }, duplicate = all().some(other => other.kind === 'build' && other.value.id !== item.value.id && other.value.name === item.value.name)): HubRow => ({
    ...workspace(item.value), id: `build:${item.value.id}`, title: item.value.name, detail: duplicate ? (templateFolder(item.value) === null ? 'Saved library' : 'Guild Wars templates') : '', matches: query => matchesBuild(item.value, query), folder: templateFolder(item.value), professions: buildProfessions(item.value.professions),
    keywords: [item.value.professions[0], PROFESSIONS[item.value.professions[0]].name, ...item.value.tags, templateFolder(item.value)?.replaceAll('/', ' ') ?? '', templateFolder(item.value) ?? ''].join(' '),
    group: 'Builds', attributes: buildAttributes(item.value.attributes), skills: skillPreview(item.value), action: 'Choose target', navigate: () => chooseBuild(item), run: () => chooseBuild(item), actions: () => chooseBuild(item),
  });
  const templateStates = (): HubRow[] => [
    ...(reading ? [{ id: 'templates-reading', title: 'Reading Guild Wars templates…', detail: 'Saved library results remain available.', group: 'Sources', action: 'Reading', unavailable: 'Reading templates…', run() {} }] : []),
    ...(templateProblem ? [{ id: 'templates-retry', title: 'Could not read templates', detail: 'Showing previously read templates. Retry to refresh.', group: 'Sources', action: 'Retry', run: async () => { await readTemplates(); refresh(); } }] : []),
    ...(unreadable.length ? [{ id: 'templates-unreadable', title: `${unreadable.length} unreadable template${unreadable.length === 1 ? '' : 's'}`, detail: 'Valid builds are still shown. Open for file names.', group: 'Sources', action: 'Show files', run: () => hub.showRows('Unreadable templates', () => unreadable.map((name, index) => ({ id: `unreadable:${index}`, title: name, detail: 'Save a valid skill template in Guild Wars, then retry.', group: 'Sources', action: 'Retry', run: async () => { await readTemplates(); refresh(); } })), undefined, undefined, source) }] : []),
  ];
  function browseTemplates(folder = '') {
    hub.showRows(folder.split('/').pop() || 'Guild Wars templates', () => {
      const prefix = folder ? `${folder}/` : '';
      const children = [...new Set(templates.flatMap(build => {
        const path = templateFolder(build);
        return path && path.startsWith(prefix) && path !== folder ? [path.slice(prefix.length).split('/')[0]!] : [];
      }))].sort();
      const folderRows: HubRow[] = children.map(name => ({
        id: `folder:${prefix}${name}`, title: name, detail: 'Template folder', group: 'Folders', icon: 'folder', action: 'Open folder', navigate: () => browseTemplates(prefix + name), run: () => browseTemplates(prefix + name),
      }));
      const files = templates.filter(build => templateFolder(build) === folder).map(value => buildRow({ kind: 'build', value }));
      return [...folderRows, ...files, ...templateStates(), ...(!folderRows.length && !files.length && !reading && !templateProblem ? [{ id: 'templates-empty', title: 'No skill templates here', detail: 'Save a skill template in Guild Wars, then retry.', group: 'Sources', action: 'Refresh templates', run: async () => { await readTemplates(); refresh(); } }] : [])];
    }, undefined, undefined, source);
  }
  /** Reads the template files, then opens them, unless the player moved on or closed the Hub meanwhile (HUB-004). */
  async function openTemplates(task: HubTask) { try { await readTemplates(); } catch { templateProblem = 'Could not read templates.'; } if (task.live()) browseTemplates(); }
  const libraryRow = (): HubRow => ({ id: 'builds', title: 'Build Library', detail: 'Browse saved builds and teams', aliases: ['library', 'lib', 'bu', 'build', 'builds', 'team', 'teams', 'skills', 'templates'], keywords: 'templates skills folders builds teams', group: 'Tools', action: 'Browse builds', navigate() { browseLibrary(); }, run: () => browseLibrary() });
  function browseLibrary(query = '') {
    hub.showRows('Build Library', () => {
      const items = all();
      const names = new Map<string, number>();
      for (const item of items) if (item.kind === 'build') names.set(item.value.name, (names.get(item.value.name) ?? 0) + 1);
      return [
        ...items.filter((item): item is Item & { kind: 'team' } => item.kind === 'team').map(item => teamRow(item)),
        { id: 'game-templates', title: 'Guild Wars templates', detail: 'Your existing skill template files and folders', group: 'Builds', action: 'Browse templates', navigate: openTemplates, run: openTemplates },
        ...items.filter((item): item is Item & { kind: 'build' } => item.kind === 'build' && !String(item.value.id).startsWith('template:')).map(item => buildRow(item, (names.get(item.value.name) ?? 0) > 1)),
        ...templateStates(),
      ];
    }, undefined, 'builds', source, query);
  }
  function review(item: Item) {
    if (item.kind === 'build') { chooseBuild(item); return; }
    const expected = revision(item);
    hub.showView(item.value.name, (target, _back, footer) => {
      const doc = target.ownerDocument;
      // The review opens at its top and takes focus itself: its title, mode line and first
      // member stay in view, and Enter runs the footer's named Apply (HUB-084).
      const view = doc.createElement('section'); view.className = 'hub-detail hub-build-review'; view.tabIndex = 0;
      view.setAttribute('aria-label', `Review ${item.value.name}`);
      const title = doc.createElement('h2'); title.textContent = item.value.name;
      const description = doc.createElement('div'); description.className = 'hub-review-roster';
      const showBuild = (build: Build, label: string) => {
        const slot = doc.createElement('section'); const heading = doc.createElement('h3'); heading.textContent = label;
        const bar = doc.createElement('div'); bar.className = 'hub-skill-bar';
        skillPreview(build).forEach((skill, index) => { const cell = doc.createElement('span'); cell.className = 'hub-skill'; cell.dataset.elite = String(skill.elite); cell.title = `${index + 1}. ${skill.name}`; cell.setAttribute('role', 'img'); cell.setAttribute('aria-label', cell.title); cell.textContent = String(index + 1); if (skill.iconUrl) { const image = doc.createElement('img'); image.src = skill.iconUrl; image.alt = ''; image.onerror = () => image.remove(); cell.append(image); } bar.append(cell); });
        const details = doc.createElement('details'); const summary = doc.createElement('summary'); summary.textContent = 'Attributes'; const text = doc.createElement('p'); text.textContent = buildPreview(build); details.append(summary, text); slot.append(heading, bar, details); description.append(slot);
      };

        const mode = doc.createElement('p'); mode.textContent = `${item.value.mode === 'none' ? 'Keep difficulty' : item.value.mode === 'hard' ? 'Hard Mode' : 'Normal Mode'} · Target: current character and hero party`; description.append(mode);
        item.value.slots.forEach((slot, index) => {
          if (index > 0 && slot.hero === null && slot.build === null) return;
          const build = controller.library.value?.builds.find(build => build.id === slot.build);
          const label = `${index === 0 ? playerName() : slot.hero === null ? 'Unassigned hero' : heroLabel(slot.hero)} · ${build?.name ?? 'Keep build'}${slot.behaviour ? ` · ${slot.behaviour}` : ''}`;
          if (build) showBuild(build, label); else { const text = doc.createElement('p'); text.textContent = label; description.append(text); }
        });
      // A refusal or the stored outcome shows under the title, before the roster, never below the fold.
      // The running apply's progress has one owner, the Hub status line (HUB-083).
      const status = doc.createElement('p'); status.setAttribute('role', 'status');
      const changes = doc.createElement('section');
      const update = () => {
        const latest = current(item);
        const changed = !latest || revision(latest) !== expected;
        const mine = applying && runningKey === outcomeKey(item, null);
        const refusal = changed ? 'This configuration changed. Go back and review it again.' : mine ? null : assess(item, null);
        footer.primary({ label: mine ? `Applying ${item.value.name}…` : `Apply team ${item.value.name}`, disabled: !!refusal || applying,
          // A failure on this page shows under the title, and the task clears its progress; after the player left, the Hub reports it.
          run: task => apply(item, expected, null, task).catch(error => { if (!task.live()) throw error; update(); }) });
        status.textContent = outcomes.get(outcomeKey(item, null))?.message || refusal || '';
        status.hidden = !status.textContent;
        changes.replaceChildren();
        const outcome = outcomes.get(outcomeKey(item, null));
        const list = (label: string, entries: readonly string[]) => {
          const heading = doc.createElement('h3'); heading.textContent = label;
          const ul = doc.createElement('ul');
          for (const entry of entries) { const li = doc.createElement('li'); li.textContent = entry; ul.append(li); }
          changes.append(heading, ul);
        };
        if (outcome?.partial) list('Completed', outcome.completed);
        const remaining = changed ? [] : teamChanges(item.value);
        if (remaining.length) list(outcome?.partial ? 'Remaining' : 'Changes', remaining);

      };
      view.append(title, status, changes, description); target.append(view);
      if (openWorkspace) footer.secondary({ label: 'Open in Build Library', run: () => openWorkspace(item.value) });
      listeners.add(update); update();
      return () => { listeners.delete(update); view.remove(); };
    }, undefined, undefined, source);
  }
  function teamRow(item: Item & { kind: 'team' }, direct = false): HubRow {
    direct = direct && !outcomes.get(outcomeKey(item, null))?.partial;
    // Browsing never needs an apply snapshot; only an explicit unique team action does.
    const expected = direct ? revision(item) : '';
    const refusal = direct ? assess(item, null) : null;
    return { ...(openWorkspace ? { workspace: () => openWorkspace(item.value) } : {}), id: `team:${item.value.id}`, title: item.value.name, detail: teamDetail(item),
      group: 'Teams', preview: preview(item), action: direct ? `Apply team ${item.value.name}` : `Review ${item.value.name}`, consequential: direct, navigate: () => review(item),
      ...(refusal ? { unavailable: refusal } : {}), ...(direct ? { pending: applyPending(item.value.name) } : {}), actions: () => review(item),
      run: task => direct ? apply(item, expected, null, task) : review(item) };
  }
  const source: HubSource = {
    feature: 'buildLibrary',
    shortcuts: { get: () => controller.library.value?.hubShortcuts ?? [], save: controller.saveHubShortcuts },
    lookup(id) {
      if (id === 'builds') return libraryRow();
      const item = all().find(item => `${item.kind}:${item.value.id}` === id);
      if (!item) return undefined;
      if (item.kind === 'build') return { ...buildRow(item), group: 'Pinned' };
      return { ...teamRow(item), group: 'Pinned' };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible(next) {
      if (next && !visible) void readTemplates().then(refresh).catch(() => refresh());
      visible = next;
    },
    search(query) {
      const parsed = parseHubQuery(query);
      if (parsed.scope && parsed.scope !== 'team' && parsed.scope !== 'build') return [];
      if (parsed.scope === 'team' && controller.loading.value) return [{ id: 'teams-loading', title: 'Loading teams…', detail: '', group: 'Teams', action: 'Loading teams', unavailable: 'Build Library is loading.', run() {} }];
      // `team ` lists every team; the build scope and library words open the library instead.
      if ((!parsed.term && parsed.scope !== 'team') || ['build', 'builds', 'build library', 'templates', 'library', 'lib', 'bu', 'team', 'teams', 'skills'].includes(query.trim().toLowerCase()) && parsed.scope !== 'team') return [libraryRow(), ...(!query.trim() ? controller.recentBuilds.value.flatMap(recent => { const item = all().find((item): item is Item & { kind: 'build' } => item.kind === 'build' && item.value.id === recent.id); return item ? [{ ...buildRow(item), id: `recent:${recent.id}:${recent.hero ?? 'me'}`, detail: `Recently applied to ${targetName(recent.hero)}`, group: 'Continue', run: () => chooseBuild(item, recent.hero), navigate: () => chooseBuild(item, recent.hero) }] : []; }) : templateStates())];
      const items = all();
      const names = new Map<string, number>();
      for (const item of items) if (item.kind === 'build') names.set(item.value.name, (names.get(item.value.name) ?? 0) + 1);
      const matches = items.filter(item => (!parsed.scope || item.kind === parsed.scope)
        && (item.kind === 'build' ? matchesBuild(item.value, query) : hubMatch(item.value.name, parsed.term, item.value.tags) !== null));
      const exacts = matches.filter(item => hubMatch(item.value.name, parsed.term) === 'exact');
      // A short profession query remains additive, but actual primary-profession matches lead it (HUB-059).
      const profession = Object.keys(PROFESSIONS).find(code => code.toLowerCase() === parsed.term);
      const ordered = matches.sort((a, b) => Number(hubMatch(b.value.name, parsed.term) === 'exact') - Number(hubMatch(a.value.name, parsed.term) === 'exact')
        || (profession ? Number(b.kind === 'build' && b.value.professions[0] === profession) - Number(a.kind === 'build' && a.value.professions[0] === profession) : 0)
        || a.value.name.localeCompare(b.value.name) || a.value.id.localeCompare(b.value.id));
      const seen = { build: 0, team: 0 };
      const shown = parsed.scope ? ordered : ordered.filter(item => ++seen[item.kind] <= 8);
      const more: HubRow[] = parsed.scope ? [] : (['team', 'build'] as const).flatMap(kind => {
        const total = ordered.filter(item => item.kind === kind).length;
        return total > 8 ? [{ id: `${kind}s:more`, title: `${total - 8} more — open in Build Library`, detail: '', group: kind === 'build' ? 'Builds' : 'Teams', action: 'Open in Build Library', navigate: () => browseLibrary(parsed.term), run: () => browseLibrary(parsed.term) }] : [];
      });
      return [...shown.map(item => {
        if (item.kind === 'build') return buildRow(item, (names.get(item.value.name) ?? 0) > 1);
        return teamRow(item, parsed.scope === 'team' && exacts.length === 1 && exacts[0] === item);
      }), ...more, ...(parsed.scope === 'build' ? templateStates() : [])];
    },
  };
  const detach = hub.attach(source);
  return { dispose() { disposed = true; detach(); stop(); listeners.clear(); } };
}
