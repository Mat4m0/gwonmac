/** Hub presentation over the existing library controller and bounded apply owners. */
import { watch } from 'vue';
import { hubMatch, parseHubQuery, type HubPresenter, type HubRow, type HubSource } from '../../../src/shared/hub';
import { buildId, type Build, type Team, type HeroId } from '../../../src/shared/builds/library';
import { heroLabel, PROFESSIONS } from '../../../src/shared/builds/heroes';
import { decodeSkillTemplate } from '../../../src/shared/builds/skill-template';
import { preflightTeamApply, resolveTeamApplyPlan, type TeamApplyPlan } from '../../../src/shared/builds/team-apply';
import { teamApplyRuntimeProblemMessage } from './team-apply-presentation';
import type { LibraryController } from './use-library';
import type { ToolsHost } from './host';

type Item = { kind: 'team'; value: Team } | { kind: 'build'; value: Build };
export function createHubLibrary(controller: LibraryController, host: ToolsHost, hub: HubPresenter<HTMLElement>) {
  let templates: readonly Build[] = [];
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
  const skillPreview = (build: Build) => build.skills.map(id => {
    const skill = id === null ? null : host.skills.get(id);
    return { name: skill?.name ?? 'Empty slot', iconUrl: skill?.iconUrl ?? null, elite: skill?.elite ?? false };
  });
  const buildPreview = (build: Build) => [
    build.professions.filter(Boolean).join('/'),
    Object.entries(build.attributes).map(([name, rank]) => `${name.replace(/([a-z])([A-Z])/gu, '$1 $2')} ${rank}`).join(' · '),
  ].join('\n');
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
    const entries = await host.loadTemplates();
    if (disposed) return;
    templates = entries.flatMap(entry => {
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
  function review(item: Item) {
    operation = "";
    const expected = revision(item);
    hub.showView(item.value.name, target => {
      let hero: HeroId | null = null;
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
      if (item.kind === 'build') showBuild(item.value, 'Skills');
      else {
        const mode = doc.createElement('p'); mode.textContent = `${item.value.mode === 'none' ? 'Keep difficulty' : item.value.mode === 'hard' ? 'Hard Mode' : 'Normal Mode'} · Target: current character and hero party`; description.append(mode);
        item.value.slots.forEach((slot, index) => {
          if (index > 0 && slot.hero === null && slot.build === null) return;
          const build = controller.library.value?.builds.find(build => build.id === slot.build);
          const label = `${index === 0 ? playerName() : slot.hero === null ? 'Unassigned hero' : heroLabel(slot.hero)} · ${build?.name ?? 'Keep build'}${slot.behaviour ? ` · ${slot.behaviour}` : ''}`;
          if (build) showBuild(build, label); else { const text = doc.createElement('p'); text.textContent = label; description.append(text); }
        });
      }
      const status = doc.createElement('p'); status.setAttribute('role', 'status');
      const button = doc.createElement('button'); button.className = 'ui-button';
      const select = doc.createElement('select'); select.className = 'ui-select'; select.setAttribute('aria-label', 'Build target');
      if (item.kind === 'build') {
        for (const value of [null, ...host.party.value.heroes.map(member => member.hero)]) {
          const option = doc.createElement('option'); option.value = value === null ? '' : String(value); option.textContent = targetName(value); select.append(option);
        }
        select.onchange = () => { hero = host.party.value.heroes.find(member => String(member.hero) === select.value)?.hero ?? null; update(); };
      }
      const update = () => {
        const latest = current(item);
        const changed = !latest || revision(latest) !== expected;
        const refusal = changed ? 'This configuration changed. Go back and review it again.' : assess(item, hero);
        button.textContent = applying ? 'Applying…' : item.kind === 'team' ? `Apply team ${item.value.name}` : `Load ${item.value.name} on ${targetName(hero)}`;
        button.disabled = !!refusal; select.disabled = applying;
        status.textContent = operation || refusal || '';
      };
      button.onclick = () => { void apply(item, expected, hero).catch(error => { operation = error instanceof Error ? error.message : 'Application stopped.'; update(); }); };
      view.append(title);
      if (item.kind === 'build') view.append(select);
      view.append(description, status, button); target.append(view);
      listeners.add(update); update(); button.focus();
      return () => { listeners.delete(update); view.remove(); };
    });
  }
  const source: HubSource = {
    feature: 'buildLibrary',
    shortcuts: { get: () => controller.library.value?.hubShortcuts ?? [], save: controller.saveHubShortcuts },
    lookup(id) {
      const item = all().find(item => `${item.kind}:${item.value.id}` === id);
      if (!item) return undefined;
      return { id, title: item.value.name, detail: item.kind === 'team' ? 'Saved team' : 'Saved build', group: 'Pinned',
        preview: preview(item), ...(item.kind === 'build' ? { skills: skillPreview(item.value) } : {}), action: 'Review', run: () => review(item), actions: () => review(item) };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible(next) {
      if (next && !visible) void readTemplates().then(refresh).catch(() => { templates = []; refresh(); });
      visible = next;
    },
    search(query) {
      const parsed = parseHubQuery(query);
      if (parsed.scope && parsed.scope !== 'team' && parsed.scope !== 'build') return [];
      if (!parsed.term) return [];
      const matches = all().filter(item => (!parsed.scope || item.kind === parsed.scope)
        && hubMatch(item.value.name, parsed.term, [...item.value.tags, ...(item.kind === 'build' ? [item.value.professions[0], PROFESSIONS[item.value.professions[0]].name] : [])]) !== null);
      const exacts = matches.filter(item => hubMatch(item.value.name, parsed.term) === 'exact');
      return matches.sort((a, b) => Number(hubMatch(b.value.name, parsed.term) === 'exact') - Number(hubMatch(a.value.name, parsed.term) === 'exact')
        || a.value.name.localeCompare(b.value.name) || a.value.id.localeCompare(b.value.id)).map(item => {
        const direct = parsed.scope === item.kind && exacts.length === 1 && exacts[0] === item;
        const expected = revision(item);
        const refusal = direct ? assess(item, null) : null;
        return { id: `${item.kind}:${item.value.id}`, title: item.value.name,
          detail: item.kind === 'team' ? 'Saved team' : `${item.value.professions.filter(Boolean).join('/')} · ${item.value.origin ?? 'Build Library'}`,
          group: item.kind === 'team' ? 'Teams' : 'Builds', preview: preview(item), ...(item.kind === 'build' ? { skills: skillPreview(item.value) } : {}),
          action: direct ? item.kind === 'team' ? `Apply team ${item.value.name}` : `Load ${item.value.name} on ${playerName()}` : 'Review',
          ...(refusal ? { unavailable: refusal } : {}), actions: () => review(item),
          run: () => direct ? apply(item, expected, null) : review(item) } satisfies HubRow;
      });
    },
  };
  const detach = hub.attach(source);
  return { dispose() { disposed = true; detach(); stop(); listeners.clear(); } };
}
