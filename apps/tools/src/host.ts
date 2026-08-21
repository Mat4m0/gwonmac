import { ref, type Ref } from "vue";
import {
  SKILL_CATALOGUE_ROUTE,
  SKILL_ICON_ROUTE,
  type GwNativeApi,
} from "../../../src/shared/contracts";
import {
  unavailableParty,
  type LiveParty,
  type SkillUnlockObservation,
} from "../../../src/shared/builds/live-party";
import {
  skillId,
} from "../../../src/shared/builds/library";
import { parseBuildLibrary } from "../../../src/shared/builds/parse-library";
import { parseSkillCatalogue } from "../../../src/shared/skill-catalogue";
import type {
  TeamApplyPlan,
  TeamApplyResult,
} from "../../../src/shared/builds/team-apply";
import type { StorageCommand } from "../../../src/shared/storage-command";
import type {
  PublishedTemplate,
  PublishableTemplate,
} from "../../../src/shared/tools-bundle-contracts";
import { encodeSkillTemplate } from "../../../src/shared/builds/skill-template";
import {
  runTeamApply,
  type TeamApplyCommands,
  type TeamApplyEvent,
} from "../../../src/shared/builds/team-apply-runner";
import { demoLibrary, demoParty, demoSkillCatalogue } from "./fixtures";
import { cloneLibrary, type Build, type BuildLibrary } from "./model";
import { devTrace } from "./dev-trace";
import {
  createSkillCatalogue,
  type SkillCatalogue,
  type SkillPresentation,
} from "./skill-catalog";

const PUBLISH_UNAVAILABLE =
  "GWonMac can’t add this build to Guild Wars after this game update. "
  + "The build is still saved in your library.";

export type LibraryLoad = Readonly<{
  library: BuildLibrary;
  recovered: boolean;
  /**
   * Why the skill catalogue is missing, when it is. The library still opens —
   * saved builds stay readable and editable — but nothing new can be authored,
   * and that has to be said rather than shown as an empty picker.
   */
  skillProblem?: string;
}>;

export interface ToolsHost {
  readonly label: string;
  readonly skills: SkillCatalogue;
  /**
   * The party the player is actually in.
   *
   * The harness writes it as the companion publishes; the panel only reads. A
   * host with no running game behind it leaves it `unavailable`, which is a
   * state the interface has to draw anyway — the game is not always running,
   * and "not observed" is the honest thing to say when it is not.
   */
  readonly party: Ref<LiveParty>;
  loadLibrary(): Promise<LibraryLoad>;
  saveLibrary(library: BuildLibrary): Promise<BuildLibrary>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  reloadSkills(): Promise<void>;
  publishBuild(build: Build): Promise<PublishedTemplate>;
  /** Why publishing into the running client's template list is unavailable. */
  readonly publishUnavailable: string | null;
  applyTeam(
    plan: TeamApplyPlan,
    onEvent?: (event: TeamApplyEvent) => void,
  ): Promise<TeamApplyResult>;
  cancelApply(): void;
  /**
   * Why `applyTeam` cannot reach the running game, or `null` when it can.
   *
   * The interface has to be able to say this before the click. A primary button
   * that looks ready and then refuses has already spent the player's decision
   * to press it, and reads as a broken panel rather than as a capability that
   * does not exist yet.
   */
  readonly applyUnavailable: string | null;
  readonly observationUnavailable: string | null;
  openStorage(): Promise<void>;
  readonly storageUnavailable: string | null;
  reset?(): Promise<LibraryLoad>;
}

const STORAGE_KEY = "gwonmac.tools.demo.library.v2";

function teamApplyProbe(
  plan: TeamApplyPlan,
  party: LiveParty,
  commandId: number,
  cause: unknown,
  timeline: readonly TeamApplyEvent[],
) {
  const availability = (
    skill: number | null,
    unlocks: SkillUnlockObservation | null,
  ) => {
    if (skill === null) return "empty";
    if (unlocks === null) return "unobserved";
    if (skill >= unlocks.knownThrough) return "unknown";
    return unlocks.unlocked.has(skillId(skill)) ? "unlocked" : "locked";
  };
  return Object.freeze({
    schema: 1,
    commandId,
    error: cause instanceof Error ? cause.message : String(cause),
    timeline: Object.freeze(timeline.slice(-64)),
    party: Object.freeze({
      status: party.status,
      playRegion: party.playRegion,
      inOutpost: party.inOutpost,
      partial: party.partial,
      accountSkillsObserved: party.accountSkills !== null,
      characterSkillsObserved: party.characterSkills !== null,
    }),
    members: Object.freeze(plan.members.map((member, index) => {
      const live = member.hero === null
        ? (index === 0 ? party.player : null)
        : party.heroes.find((candidate) => candidate.hero === member.hero) ?? null;
      const unlocks = member.hero === null
        ? (index === 0 ? party.characterSkills : null)
        : party.accountSkills;
      const wanted = member.build?.skills.map((skill) => skill === null ? null : Number(skill))
        ?? null;
      return Object.freeze({
        slot: index + 1,
        heroId: member.hero === null ? null : Number(member.hero),
        agentId: live?.agentId ?? null,
        wantedProfessions: member.build?.professions ?? null,
        observedProfessions: live?.professions ?? null,
        wantedSkills: wanted,
        observedSkills: live?.skills?.map((skill) => skill === null ? null : Number(skill))
          ?? null,
        availability: wanted?.map((skill) => Object.freeze({
          skillId: skill,
          status: availability(skill, unlocks),
        })) ?? null,
      });
    })),
  });
}

function safeFileName(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .trim()
    .replace(/\s+/gu, " ");
  return `${cleaned || "GWonMac Build"}.txt`;
}

export function createDemoHost(storage: Storage | null = null): ToolsHost {
  let memory = cloneLibrary(demoLibrary);
  let clipboard = "";
  const read = (): BuildLibrary => {
    if (!storage) return cloneLibrary(memory);
    const saved = storage.getItem(STORAGE_KEY);
    if (!saved) return cloneLibrary(memory);
    try {
      return cloneLibrary(parseBuildLibrary(JSON.parse(saved) as unknown));
    } catch {
      storage.removeItem(STORAGE_KEY);
    }
    return cloneLibrary(memory);
  };
  return {
    label: storage ? "Local fixture library" : "Session fixture library",
    skills: demoSkillCatalogue,
    // Deliberately the *partial* shape the companion actually publishes today —
    // a hero count with one identified hero and no ordering. A fixture showing
    // a full roster would let this section be designed against data the running
    // game cannot yet supply, and the gap would surface as a bug report.
    party: ref(demoParty),
    // The fixture host answers its own apply, so it has nothing to refuse.
    applyUnavailable: null,
    observationUnavailable: null,
    storageUnavailable: null,
    publishUnavailable: null,
    async loadLibrary() {
      memory = read();
      return { library: cloneLibrary(memory), recovered: false };
    },
    async saveLibrary(library) {
      memory = cloneLibrary(library);
      storage?.setItem(STORAGE_KEY, JSON.stringify(memory));
      return cloneLibrary(memory);
    },
    readClipboard: async () =>
      typeof navigator !== "undefined" && navigator.clipboard
        ? navigator.clipboard.readText()
        : clipboard,
    writeClipboard: async (text) => {
      clipboard = text;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    },
    reloadSkills: async () => undefined,
    async publishBuild(build) {
      await new Promise((resolve) => setTimeout(resolve, 180));
      return { fileName: safeFileName(build.name), location: "Templates/Skills" };
    },
    async applyTeam() {
      await new Promise((resolve) => setTimeout(resolve, 180));
      return { commandId: 1, completedChanges: 0, skippedSkills: [] };
    },
    async openStorage() {
      await new Promise((resolve) => setTimeout(resolve, 120));
    },
    cancelApply() {},
    async reset() {
      storage?.removeItem(STORAGE_KEY);
      memory = cloneLibrary(demoLibrary);
      return { library: cloneLibrary(memory), recovered: false };
    },
  };
}

/**
 * A build already encoded as the text Guild Wars stores. The renderer writes
 * templates but does not own the codec: `src/shared/builds` is compiled into
 * this bundle and is deliberately not on the protocol's shared-module
 * allowlist, so the encoding happens here and the host receives a string.
 */
export function createNativeHost(
  api: GwNativeApi,
  publishTemplate:
    | ((template: PublishableTemplate) => Promise<PublishedTemplate>)
    | null,
  /**
   * The certified commands, or `null` for a client module derived without
   * them. The renderer hands them straight through without reading them; the
   * sequence that turns a plan into a party lives here, beside the domain.
   */
  commands: TeamApplyCommands | null,
  storage: StorageCommand | null,
  applyUnavailable: string | null,
  development = false,
  observationUnavailable: string | null = null,
): ToolsHost {
  const party = ref(unavailableParty());
  // One counter per session, so a result can be tied to the request that asked
  // for it in a log where several ran.
  let commandId = 0;
  let activeApply: AbortController | null = null;
  const skills = createSkillCatalogue([]);
  // Failures here are reported, never swallowed. A silently empty catalogue is
  // indistinguishable from a rendering bug, which is exactly how a missing
  // protocol route once cost an afternoon.
  const loadSkills = async () => {
    const response = await fetch(`gw://app/${SKILL_CATALOGUE_ROUTE}`);
    if (!response.ok) {
      throw new Error(
        `The skill catalogue is unavailable (${response.status}). Guild Wars `
        + "may still be downloading; the console records why.",
      );
    }
    const parsed: SkillPresentation[] = parseSkillCatalogue(await response.json())
      .map(({ hasIcon, ...record }) => {
        const id = skillId(record.id);
        return {
          ...record,
          id,
          iconUrl: hasIcon ? `gw://app/${SKILL_ICON_ROUTE(id)}` : null,
        };
      });
    skills.replace(parsed);
    devTrace(development, "skills.loaded", { count: parsed.length });
  };
  return {
    label: "Saved on this Mac",
    skills,
    party,
    applyUnavailable,
    observationUnavailable,
    get storageUnavailable() {
      return storage === null
        ? "Storage is unavailable after this Guild Wars update."
        : storage.unavailable();
    },
    publishUnavailable: publishTemplate === null ? PUBLISH_UNAVAILABLE : null,
    async loadLibrary() {
      const [library, skills] = await Promise.all([
        api.buildLibrary.get(),
        loadSkills().then(
          () => null,
          (cause: unknown) => {
            console.error("[tools] the skill catalogue did not load", cause);
            return cause instanceof Error
              ? cause.message
              : "The skill catalogue did not load.";
          },
        ),
      ]);
      devTrace(development, "library.loaded", {
        builds: library.library.builds.length,
        teams: library.library.teams.length,
        recovered: library.recovered,
        skillsAvailable: skills === null,
      });
      return skills === null ? library : { ...library, skillProblem: skills };
    },
    async saveLibrary(library) {
      devTrace(development, "library.save.start", {
        builds: library.builds.length,
        teams: library.teams.length,
      });
      try {
        const saved = await api.buildLibrary.set(library);
        devTrace(development, "library.save.complete", {
          builds: saved.builds.length,
          teams: saved.teams.length,
        });
        return saved;
      } catch (cause) {
        devTrace(development, "library.save.failed", {
          reason: cause instanceof Error ? cause.message : String(cause),
        });
        throw cause;
      }
    },
    readClipboard: () => api.clipboard.readText(),
    writeClipboard: (text) => api.clipboard.writeText(text),
    reloadSkills: loadSkills,
    async publishBuild(build) {
      if (publishTemplate === null) throw new Error(PUBLISH_UNAVAILABLE);
      const code = encodeSkillTemplate(build);
      if (code === null) {
        throw new Error("This build cannot be written as a template.");
      }
      devTrace(development, "template.publish.start");
      const published = await publishTemplate({ name: build.name, code });
      devTrace(development, "template.publish.complete", {
        location: published.location,
      });
      return published;
    },
    async applyTeam(plan, onEvent) {
      if (commands === null) {
        throw new Error(applyUnavailable ?? "Applying a team is unavailable.");
      }
      if (activeApply !== null) {
        throw new Error("A team is already being applied.");
      }
      const operation = new AbortController();
      activeApply = operation;
      const timeline: TeamApplyEvent[] = [];
      Reflect.deleteProperty(window, "gwTeamApplyProbe");
      const currentCommandId = ++commandId;
      devTrace(development, "apply.start", {
        commandId: currentCommandId,
        mode: plan.mode,
        configuredMembers: plan.members.filter((member) => member.build !== null).length,
      });
      try {
        const result = await runTeamApply(plan, {
          commands,
          // Read through the ref rather than captured: the overlay rewrites it on
          // every published change, and a captured value would let the sequence
          // confirm each step against the party as it was before it started.
          party: () => party.value,
          signal: operation.signal,
          onEvent: (event) => {
            if (development) {
              if (timeline.length === 64) timeline.shift();
              timeline.push(event);
            }
            onEvent?.(event);
          },
        }, currentCommandId);
        devTrace(development, "apply.complete", {
          commandId: currentCommandId,
          completedChanges: result.completedChanges,
          skippedSkills: result.skippedSkills.length,
        });
        return result;
      } catch (cause) {
        const probe = teamApplyProbe(
          plan,
          party.value,
          currentCommandId,
          cause,
          timeline,
        );
        if (development) {
          Reflect.set(window, "gwTeamApplyProbe", probe);
          console.warn(`[tools] team Apply probe ${JSON.stringify(probe)}`);
        } else {
          console.warn(
            "[tools] Team Apply failed",
            cause instanceof Error ? cause.message : String(cause),
          );
        }
        devTrace(development, "apply.failed", {
          commandId: currentCommandId,
          reason: cause instanceof Error ? cause.message : String(cause),
        });
        throw cause;
      } finally {
        // A refused confirmation must not leave a packet armed to fire after
        // the UI has already reported failure. Clearing an empty mailbox is a
        // no-op; clearing a stuck one makes the failure final and the next
        // Apply independent.
        if (!operation.signal.aborted) commands.cancelPending();
        if (activeApply === operation) activeApply = null;
      }
    },
    async openStorage() {
      if (storage === null) {
        throw new Error("Storage is unavailable after this Guild Wars update.");
      }
      storage.open();
    },
    cancelApply() {
      if (activeApply !== null) {
        commands?.cancelPending();
        activeApply.abort();
      }
    },
  };
}
