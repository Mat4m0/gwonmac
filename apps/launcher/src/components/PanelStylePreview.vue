<script setup lang="ts">
import { computed } from "vue";
import type { LauncherSettings } from "@shared/launcher-contracts";
import { defaultCustomUiTheme } from "@shared/ui-theme";
import { accessibleForeground, compositeColor, contrastRatio } from "@shared/ui-color";

const props = defineProps<{ settings: LauncherSettings }>();
const theme = computed(() => props.settings.uiStyle === "custom" ? props.settings.uiCustomTheme : defaultCustomUiTheme(props.settings.uiStyle === "obsidian" ? "modern" : "classic"));
const backgrounds = computed(() => [compositeColor(theme.value.window, "#FFFFFF", props.settings.uiPanelOpacity / 100), compositeColor(theme.value.window, "#000000", props.settings.uiPanelOpacity / 100), theme.value.titlebar, theme.value.surface, theme.value.recessed]);
const ink = computed(() => accessibleForeground(theme.value.text, backgrounds.value));
const muted = computed(() => accessibleForeground(theme.value.mutedText, backgrounds.value));
const adjusted = computed(() => backgrounds.value.some(background => contrastRatio(background, theme.value.text) < 4.5 || contrastRatio(background, theme.value.mutedText) < 4.5));
const font = computed(() => ({ "guild-wars": 'Palatino, serif', inter: 'Inter, system-ui, sans-serif', system: 'system-ui, sans-serif', avenir: 'Avenir, sans-serif', georgia: 'Georgia, serif', palatino: 'Palatino, serif' })[props.settings.uiFont]);
</script>

<template>
  <figure class="panel-preview">
    <div class="panel-sample" :style="{ background: theme.window, color: ink, borderColor: theme.border, fontFamily: font, opacity: settings.uiPanelOpacity / 100, borderRadius: theme.material === 'modern' ? '10px' : '2px' }" role="img" aria-label="Illustrative panel showing title, body text, selection, and input colors">
      <div class="sample-title" :style="{ background: theme.windowGradient ? `linear-gradient(${theme.titlebar}, ${theme.window})` : theme.titlebar, color: ink }">Build Library</div>
      <div class="sample-body" :style="{ background: theme.surface }">
        <span :style="{ color: muted }">Your saved builds</span>
        <div class="sample-selection" :style="{ background: theme.selected, color: accessibleForeground(theme.text, [theme.selected]) }">Ranger · Exploration</div>
        <div class="sample-input" :style="{ background: theme.recessed, color: muted, borderColor: theme.border }">Search builds…</div>
        <strong :style="{ color: accessibleForeground(theme.accent, [theme.surface]) }">View build</strong>
      </div>
    </div>
    <figcaption>Illustrative panel preview. Game lighting affects opacity; game fonts load in the game window.</figcaption>
  </figure>
  <p v-if="settings.uiStyle === 'custom' && adjusted" class="contrast-note" role="status">Some text colors have low contrast. Panels adjust text for readability while keeping your saved colors.</p>
</template>

<style scoped>
.panel-preview { display: grid; grid-template-columns: minmax(180px, 300px) minmax(0, 1fr); gap: 16px; align-items: center; margin: 0; padding: 16px; }
.panel-sample { border: 1px solid; overflow: hidden; font-size: 14px; }
.sample-title { padding: 10px 14px; font-weight: 600; }
.sample-body { display: grid; gap: 8px; padding: 12px; }
.sample-selection, .sample-input { padding: 7px 10px; border-radius: 3px; }
.sample-input { border: 1px solid; }
figcaption { color: var(--muted); font-size: 13px; line-height: 1.5; }
.contrast-note { padding: 0 16px 14px; margin: 0; font-size: 14px; }
@media (max-width: 600px) { .panel-preview { grid-template-columns: 1fr; }.panel-sample { max-width: 300px; } }
</style>
