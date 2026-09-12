/** Mounts one Elite Skills planner; both map surfaces consume its character plan. */
import { createApp, h, ref, shallowRef } from "vue";
import EliteSkillsApp from "./EliteSkillsApp.vue";
import { EMPTY_ELITE_MAP, type EliteMapHandle, type EliteMapView } from "../../../src/shared/elite-map";
import type { EliteLocation } from "../../../src/shared/elite-skills";
import type { EliteTrackingHost } from "./use-elite-tracking";
import { createSkillCatalogue, type SkillPresentation } from "./skill-catalog";
import "./styles.css";
export function mountEliteSkills(target: HTMLElement, options: {
  tracking: EliteTrackingHost;
  loadSkills: () => Promise<readonly SkillPresentation[]>;
  openWiki: (location: EliteLocation, page: "boss" | "skill") => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  initialView?: EliteMapView;
}): EliteMapHandle {
  const view = shallowRef(options.initialView ?? EMPTY_ELITE_MAP);
  const catalogue = createSkillCatalogue([]);
  const catalogueVersion = ref(0);
  const catalogueProblem = ref("");
  const component = ref<InstanceType<typeof EliteSkillsApp> | null>(null);
  let disposed = false;
  let loading = false;
  async function loadSkills() {
    if (loading) return;
    loading = true;
    try {
      const records = await options.loadSkills();
      if (disposed) return;
      catalogue.replace(records); catalogueVersion.value++;
      catalogueProblem.value = "";
    } catch (error) {
      if (!disposed) catalogueProblem.value = error instanceof Error ? error.message : "Skill details could not be loaded.";
    } finally { loading = false; }
  }
  const app = createApp({ setup: () => () => h(EliteSkillsApp, {
    ref: component, view: view.value, catalogue, catalogueVersion: catalogueVersion.value,
    catalogueProblem: catalogueProblem.value, trackingHost: options.tracking,
    openWiki: options.openWiki, reloadSkills: () => { void loadSkills(); },
    onOpenChange: options.onOpenChange,
  }) });
  app.mount(target);
  void loadSkills();
  return { update: (next) => { view.value = next; },
    find: (id) => component.value?.find(id), close: () => component.value?.close(),
    dispose: () => { disposed = true; app.unmount(); },
  };
}
