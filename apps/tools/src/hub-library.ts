/** Hub presentation over the existing library controller and bounded apply owners. */
import { watch } from 'vue';
import { buildAttributes, buildProfessions } from '../../../src/shared/builds/presentation';
import { hubMatch, parseHubQuery, type HubPresenter, type HubRow, type HubSource } from '../../../src/shared/hub';
import { buildId, type Build, type Team, type HeroId } from '../../../src/shared/builds/library';
import { heroLabel, PROFESSIONS } from '../../../src/shared/builds/heroes';
import { decodeSkillTemplate } from '../../../src/shared/builds/skill-template';
import { preflightTeamApply, resolveTeamApplyPlan, type TeamApplyPlan } from '../../../src/shared/builds/team-apply';
import { teamApplyRuntimeProblemMessage } from './team-apply-presentation';
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
  const folder = templateFolder(build);
  const aliases = [build.professions[0], PROFESSIONS[build.professions[0]].name, ...build.tags, ...(folder?.split('/') ?? [])];
  // Quotes group names with spaces; an unfinished quote remains useful while typing.
  const tokens = query.toLowerCase().replaceAll('\\', '/').match(/(?:[^\s"]+|"[^"]*"?)+/gu) ?? [];
  return tokens.every(raw => {
    const token = raw.replaceAll('"', '');
    if (token.startsWith('folder:')) return folderMatches(folder, token.slice(7));
    if (token.includes('/')) return token === build.professions.filter(Boolean).join('/').toLowerCase() || folderMatches(folder, token);
    const profession = Object.entries(PROFESSIONS).find(([code, facts]) => code.toLowerCase() === token || facts.name.toLowerCase() === token);
    if (profession && !raw.startsWith('"')) return build.professions[0] === profession[0];
    return hubMatch(build.name, token, aliases) !== null;
  });
}

export function createHubLibrary(controller: LibraryController, host: ToolsHost, hub: HubPresenter<HTMLElement>) {
  let templates: readonly Build[] = [];
  let templateProblem = '';
  let templateRead = 0;
  let visible = false;
  let disposed = false;
  let applying = false;
  let operation = '';
  const listeners = new Set<() => void>();
  const refresh = () => { for (const listener of listeners) listener(); };
  const stop = watch([controller.library, host.party, controller.applying, controller.applyStatus], refresh, { flush: 'sync' });
  const all = (): Item[] => [...(controller.library.value?.teams ?? []).map(value => ({ kind: 'team' as const, value })),
    ...[...(controller.library.value?.builds ?? []), ...templates].map(value => ({ kind: 'build' as const, value }))];
  const current = (item: Item) => all().find(candidate => candidate.kind === item.kind && candidate.value.id === item.value.id);
  const revision = (item: Item) => JSON.stringify(item.kind === 'team' ? [item.value, controller.library.value?.builds] : item.value);
  const playerName = () => { const source = window.gwCharacterSwitch; const state = source?.characters; return source && ['outpost', 'pve-explorable', 'pvp-explorable'].includes(source.context) && state?.status === 'ready' && state.selectedIndex !== null ? state.characters[state.selectedIndex]?.name ?? 'Your character' : 'Your character'; };
  const targetName = (hero: HeroId | null) => hero === null ? playerName() : heroLabel(hero);
  const skillPreview = (build: Pick<Build, 'skills'>) => build.skills.map(id => {
    const skill = id === null ? null : host.skills.get(id);
    return { name: skill?.name ?? (id === null ? 'Empty slot' : `Unknown skill ${id}`), iconUrl: skill?.iconUrl ?? null, elite: skill?.elite ?? false };
  });
  const attributesPreview = (attributes: Build['attributes'] | null) => attributes === null ? 'Attributes not available'
    : Object.entries(attributes).map(([name, rank]) => `${name.replace(/([a-z])([A-Z])/gu, '$1 $2')} ${rank}`).join(' · ') || 'No attribute points assigned';
  const buildPreview = (build: Pick<Build, 'professions' | 'attributes'>) => `${build.professions.filter(Boolean).join('/')}\n${attributesPreview(build.attributes)}`;
  const equipped = (hero: HeroId | null) => {
    const party = host.party.value;
    const member = party.status === 'ready' ? hero === null ? party.player : party.heroes.find(member => member.hero === hero) : null;
    return {
      detail: member?.skills ? 'Current build' : 'Current build not available',
      professions: buildProfessions(member?.professions ?? []),
      ...(member?.skills ? { skills: skillPreview({ skills: member.skills }), attributes: buildAttributes(member.attributes ?? {}), ...(member.attributes === null ? { attributeStatus: 'Attributes not available' } : {}) } : {}),
    };
  };
  const preview = (item: Item) => item.kind === 'build' ? buildPreview(item.value)
    : `${item.value.mode === 'none' ? 'Keep difficulty' : `${item.value.mode === 'hard' ? 'Hard' : 'Normal'} Mode`}\n` + item.value.slots.flatMap((slot, index) => {
      if (index > 0 && slot.hero === null && slot.build === null) return [];
      const build = controller.library.value?.builds.find(build => build.id === slot.build);
      return [`${index + 1}. ${index === 0 ? playerName() : slot.hero === null ? 'Unassigned hero' : heroLabel(slot.hero)} · ${build?.name ?? 'Keep build'}${slot.behaviour ? ` · ${slot.behaviour}` : ''}`];
    }).join('\n');
  function assess(item: Item, hero: HeroId | null): string | null {
    if (host.applyUnavailable) return host.applyUnavailable;
    if (applying || controller.applying.value) return 'An application is in progress.';
    let plan: TeamApplyPlan;
    if (item.kind === 'team') {
      const library = controller.library.value;
      if (!library) return 'Library is loading.';
      const result = resolveTeamApplyPlan(item.value, library, controller.validate);
      if (!result.valid) return 'This team has incomplete or invalid assignments. Review it in Builds.';
      plan = result.plan;
    } else {
      if (!controller.validate(item.value, hero === null ? 'player' : 'hero').valid) return 'This build has invalid skills or attributes.';
      if (hero !== null && !host.party.value.heroes.some(member => member.hero === hero)) return 'This hero is no longer in your party.';
      const member = { hero, build: item.value, behaviour: null };
      plan = { mode: 'none', members: hero === null ? [member] : [{ hero: null, build: null, behaviour: null }, member] };
    }
    const checked = preflightTeamApply(plan, host.party.value);
    return checked.ready ? null : checked.blockers.map(teamApplyRuntimeProblemMessage).join('\n');
  }
  async function readTemplates() {
    const read = ++templateRead;
    const entries = await host.loadTemplates();
    if (disposed || read !== templateRead) return;
    templateProblem = '';
    templates = entries.flatMap(entry => {
      if (/(^|\/)Equipment\//iu.test(entry.path)) return [];
      const decoded = decodeSkillTemplate(entry.contents.trim());
      if (!decoded) return [];
      return [{ ...decoded, id: buildId(`template:${entry.path}`), name: entry.path.split('/').pop()?.replace(/\.txt$/iu, '') ?? entry.path,
        origin: entry.path, tags: [], notes: '', favourite: false, lastUsed: null, parent: null }];
    });
  }
  async function apply(item: Item, expected: string, hero: HeroId | null) {
    if (item.kind === 'build' && String(item.value.id).startsWith('template:')) await readTemplates();
    const next = current(item);
    if (!next || revision(next) !== expected) throw new Error('This saved configuration changed. Review it again.');
    const refusal = assess(next, hero);
    if (refusal) throw new Error(refusal);
    applying = true; operation = 'Applying…'; refresh();
    try {
      const result = next.kind === 'team' ? await controller.applyTeam(next.value)
        : await host.applyBuild(next.value, hero, event => { operation = event.message; refresh(); });
      if (!result) throw new Error(controller.applyStatus.value?.message ?? 'Application stopped.');
      if (result.skippedSkills.length) throw new Error('Partly applied. Some skills were not equipped. Review before retrying.');
      operation = ''; hub.close();
    } catch (error) {
      operation = error instanceof Error ? error.message : 'Application stopped.';
      throw error;
    } finally { applying = false; refresh(); }
  }
  function chooseBuild(item: Item & { kind: 'build' }) {
    const expected = revision(item);
    const summary = { label: 'Build to apply', title: item.value.name, detail: '', folder: templateFolder(item.value), skills: skillPreview(item.value), attributes: buildAttributes(item.value.attributes), professions: buildProfessions(item.value.professions) };
    const unavailable = (hero: HeroId | null) => {
      const latest = current(item);
      return !latest || revision(latest) !== expected ? 'This saved build changed. Go back and select it again.' : assess(item, hero);
    };
    const applyRow = (hero: HeroId | null, title: string): HubRow => {
      const refusal = unavailable(hero);
      return { id: `apply:${hero ?? 'me'}`, title, ...equipped(hero), group: 'Current build',
        action: hero === null ? 'Apply to me' : `Apply to ${targetName(hero)}`,
        ...(refusal ? { unavailable: refusal } : {}), run: () => apply(item, expected, hero) };
    };
    function compareTarget(hero: HeroId | null) {
      hub.showRows(targetName(hero), () => [applyRow(hero, hero === null ? 'Apply to me' : `Apply to ${targetName(hero)}`)], summary);
    }
    function chooseHero() {
      hub.showRows('Heroes', () => {
        const party = host.party.value;
        const heroes = new Set([...party.heroes.map(member => member.hero),
          ...[...(party.accountHeroes ?? [])].filter(([, facts]) => facts.availability === 'unlocked').map(([id]) => id)]);
        const rows = [...heroes].map(id => {
          const member = party.heroes.find(member => member.hero === id);
          const professions = member?.professions ?? party.accountHeroes?.get(id)?.professions;
          const refusal = member ? unavailable(id) : 'Add this hero to your party first.';
          return { id: `hero:${id}`, title: heroLabel(id), ...equipped(id), group: 'Heroes',
            keywords: professions?.flatMap(value => value ? [PROFESSIONS[value].name] : []).join(' ') ?? '',
            action: 'Review current build', ...(refusal ? { unavailable: refusal } : {}),
            navigate: () => compareTarget(id), run: () => compareTarget(id) };
        }).sort((a, b) => Number(!!a.unavailable) - Number(!!b.unavailable) || a.title.localeCompare(b.title));
        return rows.length ? rows : [{ id: 'heroes-unavailable', title: 'No heroes observed', detail: 'Enter a PvE outpost to read your heroes.', group: 'Heroes', action: 'Choose hero', unavailable: 'Hero information is not available yet.', run() {} }];
      }, summary);
    }
    hub.showRows(item.value.name, () => [
      { ...applyRow(null, 'Apply to me'), navigate: () => compareTarget(null), detail: `${playerName()} · ${equipped(null).detail}`, group: 'Targets' },
      { id: 'choose-hero', title: 'Apply to hero', detail: 'Compare your heroes’ current builds', group: 'Targets', action: 'Choose hero', navigate: chooseHero, run: chooseHero },
    ], summary);
  }
  const buildRow = (item: Item & { kind: 'build' }): HubRow => ({
    id: `build:${item.value.id}`, title: item.value.name, detail: '', folder: templateFolder(item.value), professions: buildProfessions(item.value.professions),
    keywords: [item.value.professions[0], PROFESSIONS[item.value.professions[0]].name, ...item.value.tags, templateFolder(item.value)?.replaceAll('/', ' ') ?? '', templateFolder(item.value) ?? ''].join(' '),
    group: 'Builds', attributes: buildAttributes(item.value.attributes), skills: skillPreview(item.value), action: 'Choose target', navigate: () => chooseBuild(item), run: () => chooseBuild(item), actions: () => chooseBuild(item),
  });
  function browseTemplates(folder: string | null = null) {
    hub.showRows(folder === null ? 'Guild Wars templates' : folder || 'Skills', () => {
      if (templateProblem) return [{ id: 'templates-retry', title: 'Could not read templates', detail: 'Retry reading the saved game files.', group: 'Builds', action: 'Retry', run: async () => { await readTemplates(); refresh(); } }];
      const folderRows: HubRow[] = folder === null ? [...new Set(templates.map(build => templateFolder(build) ?? '').filter(Boolean))].sort().map(name => ({
        id: `folder:${name}`, title: name, detail: 'Template folder', group: 'Builds', action: 'Open folder', navigate: () => browseTemplates(name), run: () => browseTemplates(name),
      })) : [];
      const files = templates.filter(build => templateFolder(build) === (folder ?? '')).map(value => buildRow({ kind: 'build', value }));
      return [...folderRows, ...files, ...(!folderRows.length && !files.length ? [{ id: 'templates-empty', title: 'No skill templates here', detail: 'Save a skill template in Guild Wars, then reopen this page.', group: 'Builds', action: 'Open', unavailable: 'No saved skill templates found.', run() {} }] : [])];
    });
  }
  async function openTemplates() { try { await readTemplates(); } catch { templateProblem = 'Could not read templates.'; } browseTemplates(); }
  const libraryRow = (): HubRow => ({ id: 'builds', title: 'Build Library', detail: 'Browse saved builds and Guild Wars template folders', keywords: 'templates skills folders builds', group: 'Tools', action: 'Browse builds', navigate() { void libraryRow().run(); }, run() {
    hub.showRows('Build Library', () => [
      { id: 'game-templates', title: 'Guild Wars templates', detail: 'Your existing skill template files and folders', group: 'Builds', action: 'Browse templates', navigate: openTemplates, run: openTemplates },
      ...all().filter((item): item is Item & { kind: 'build' } => item.kind === 'build' && !String(item.value.id).startsWith('template:')).map(buildRow),
    ]);
  } });
  function review(item: Item) {
    if (item.kind === 'build') { chooseBuild(item); return; }
    operation = "";
    const expected = revision(item);
    hub.showView(item.value.name, target => {
      const doc = target.ownerDocument;
      const view = doc.createElement('section'); view.className = 'hub-detail hub-build-review';
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
      const status = doc.createElement('p'); status.setAttribute('role', 'status');
      const button = doc.createElement('button'); button.className = 'ui-button';
      const update = () => {
        const latest = current(item);
        const changed = !latest || revision(latest) !== expected;
        const refusal = changed ? 'This configuration changed. Go back and review it again.' : assess(item, null);
        button.textContent = applying ? 'Applying…' : `Apply team ${item.value.name}`;
        button.disabled = !!refusal;
        status.textContent = operation || refusal || '';
      };
      button.onclick = () => { void apply(item, expected, null).catch(error => { operation = error instanceof Error ? error.message : 'Application stopped.'; update(); }); };
      view.append(title);
      view.append(description, status, button); target.append(view);
      listeners.add(update); update(); button.focus();
      return () => { listeners.delete(update); view.remove(); };
    });
  }
  const source: HubSource = {
    feature: 'buildLibrary',
    shortcuts: { get: () => controller.library.value?.hubShortcuts ?? [], save: controller.saveHubShortcuts },
    lookup(id) {
      if (id === 'builds') return libraryRow();
      const item = all().find(item => `${item.kind}:${item.value.id}` === id);
      if (!item) return undefined;
      if (item.kind === 'build') return { ...buildRow(item), group: 'Pinned' };
      return { id, title: item.value.name, detail: 'Saved team', group: 'Pinned',
        preview: preview(item), action: 'Review', run: () => review(item), actions: () => review(item) };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible(next) {
      if (next && !visible) void readTemplates().then(refresh).catch(() => { templates = []; templateProblem = 'Could not read templates.'; refresh(); });
      visible = next;
    },
    search(query) {
      const parsed = parseHubQuery(query);
      if (parsed.scope && parsed.scope !== 'team' && parsed.scope !== 'build') return [];
      if (!parsed.term || ['build', 'builds', 'build library', 'templates'].includes(query.trim().toLowerCase())) return [libraryRow()];
      const matches = all().filter(item => (!parsed.scope || item.kind === parsed.scope)
        && (item.kind === 'build' ? matchesBuild(item.value, parsed.term) : hubMatch(item.value.name, parsed.term, item.value.tags) !== null));
      const exacts = matches.filter(item => hubMatch(item.value.name, parsed.term) === 'exact');
      return matches.sort((a, b) => Number(hubMatch(b.value.name, parsed.term) === 'exact') - Number(hubMatch(a.value.name, parsed.term) === 'exact')
        || a.value.name.localeCompare(b.value.name) || a.value.id.localeCompare(b.value.id)).map(item => {
        if (item.kind === 'build') return buildRow(item);
        const direct = parsed.scope === 'team' && exacts.length === 1 && exacts[0] === item;
        const expected = revision(item);
        const refusal = direct ? assess(item, null) : null;
        return { id: `team:${item.value.id}`, title: item.value.name, detail: 'Saved team',
          group: 'Teams', preview: preview(item), action: direct ? `Apply team ${item.value.name}` : 'Review',
          ...(refusal ? { unavailable: refusal } : {}), actions: () => review(item),
          run: () => direct ? apply(item, expected, null) : review(item) } satisfies HubRow;
      });
    },
  };
  const detach = hub.attach(source);
  return { dispose() { disposed = true; detach(); stop(); listeners.clear(); } };
}
