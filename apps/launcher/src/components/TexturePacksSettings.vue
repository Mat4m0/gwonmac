<script setup lang="ts">
import { nextTick, ref } from "vue";
import { Trash2, Upload } from "lucide-vue-next";
import type { TexturePackFailureCode, TexturePackSnapshot } from "@shared/texture-packs";

defineProps<{ texturePacks: TexturePackSnapshot }>();

const busy = ref(false);
const status = ref("");
const failureCopy: Record<TexturePackFailureCode, string> = {
  not_tpf: "That file is not a supported TexMod TPF.",
  tpf_corrupt: "The TPF is damaged or its checksum is invalid.",
  unsupported_tpf_variant: "This TPF uses a container variant that is not supported yet.",
  unsafe_archive: "The TPF contains an unsafe file path.",
  limit_exceeded: "The TPF is too large or contains too many textures.",
  definition_missing: "The TPF has no texmod.def mapping file.",
  definition_invalid: "The TPF mapping file is invalid.",
  mapping_missing_image: "The TPF mapping file references an image that is missing.",
  duplicate_target: "The TPF maps one game texture to different images.",
  unsupported_hash_width: "64-bit uMod hashes are not supported yet.",
  unsupported_image: "The TPF contains an image format that is not supported.",
  unsupported_dimensions: "A texture has unsupported dimensions.",
  source_missing: "The managed TPF copy is missing.",
  disk_full: "There is not enough free disk space to import this TPF.",
  permission_denied: "The launcher cannot read or store this TPF.",
  cancelled: "Import cancelled.",
  unknown: "The TPF could not be imported.",
};

function size(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

async function importPack() {
  const native = window.launcherNative;
  if (!native || busy.value) return;
  busy.value = true;
  status.value = "Checking TPF…";
  try {
    const result = await native.texturePacks.import();
    if (result.status === "imported") status.value = "Texture pack imported. Select it to use it in new game windows.";
    else if (result.status === "duplicate") {
      status.value = "This exact TPF is already installed.";
      await nextTick();
      document.getElementById(`texture-pack-${result.packId}`)?.focus();
    }
    else if (result.status === "cancelled") status.value = "";
    else status.value = failureCopy[result.reason];
  } catch {
    status.value = "The TPF could not be imported.";
  } finally {
    busy.value = false;
  }
}

async function select(id: string | null) {
  const native = window.launcherNative;
  if (!native || busy.value) return;
  busy.value = true;
  status.value = "Saving…";
  try {
    await native.texturePacks.select(id);
    status.value = id ? "Selected. New game windows will use this texture pack." : "Official textures selected.";
  } catch {
    status.value = "The texture pack selection could not be saved.";
  } finally {
    busy.value = false;
  }
}

async function remove(id: string) {
  const native = window.launcherNative;
  if (!native || busy.value) return;
  busy.value = true;
  status.value = "";
  try {
    await native.texturePacks.remove(id);
  } catch {
    status.value = "The texture pack could not be removed.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="settings-heading-row">
    <div><h1>Texture packs</h1><p>Import classic TexMod TPF designs. Packs change local textures only and apply to every account.</p></div>
    <button class="primary" :disabled="busy" @click="importPack"><Upload />Import TPF</button>
  </div>
  <p class="texture-pack-note">A selection applies when you open a new game window. Windows already open keep the textures they started with.</p>
  <fieldset class="texture-pack-list" :disabled="busy">
    <legend class="visually-hidden">Active texture pack</legend>
    <div class="texture-pack-card" :class="{ selected: texturePacks.selectedPackId === null }">
      <label><input type="radio" name="texture-pack" :checked="texturePacks.selectedPackId === null" @change="select(null)" />
      <span><strong>Official textures</strong><small>The original Guild Wars appearance.</small></span></label>
      <span class="pack-ready">Ready</span>
    </div>
    <div v-for="pack in texturePacks.packs" :id="`texture-pack-${pack.id}`" :key="pack.id" tabindex="-1" class="texture-pack-card" :class="{ selected: texturePacks.selectedPackId === pack.id, unavailable: pack.status !== 'ready' }">
      <label><input type="radio" name="texture-pack" :checked="texturePacks.selectedPackId === pack.id" :disabled="pack.status !== 'ready'" @change="select(pack.id)" />
      <span class="texture-pack-copy"><strong>{{ pack.name }}</strong><small>{{ pack.mappings }} textures · {{ size(pack.sourceBytes) }} TPF · imported {{ new Date(pack.importedAt).toLocaleDateString() }}</small><small class="pack-hash">SHA-256 {{ pack.sourceSha256.slice(0, 12) }}…</small></span>
      </label>
      <span :class="pack.status === 'ready' ? 'pack-ready' : 'pack-warning'">{{ pack.status === 'ready' ? 'Ready' : 'Missing source' }}</span>
      <button type="button" class="icon-button" :aria-label="`Remove ${pack.name}`" @click="remove(pack.id)"><Trash2 /></button>
    </div>
  </fieldset>
  <p v-if="status" class="inline-message texture-pack-status" role="status" aria-live="polite">{{ status }}</p>
  <details class="texture-pack-help"><summary>Compatibility and safety</summary><p>Version 1 accepts original 32-bit TexMod TPF files with DDS or PNG images. It does not run DLLs, scripts, or executable mods. Files with 64-bit uMod hashes or unsupported images are refused as a whole.</p><p>The launcher keeps a private managed copy, so you can delete the downloaded file after a successful import.</p></details>
</template>
