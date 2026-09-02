<script setup lang="ts">
import { nextTick, ref } from "vue";
import { Trash2, Upload } from "lucide-vue-next";
import type { TexturePackFailureCode, TexturePackSnapshot } from "@shared/texture-packs";

defineProps<{ texturePacks: TexturePackSnapshot }>();

const busy = ref(false);
const status = ref("");
const failureCopy: Record<TexturePackFailureCode, string> = {
  not_tpf: "This is not a supported .tpf file. Choose another file.",
  tpf_corrupt: "This file is damaged. Download it again and try again.",
  unsupported_tpf_variant: "This type of .tpf file is not supported yet. Choose another texture pack.",
  unsafe_archive: "For your safety, this file was not added. Choose another texture pack.",
  limit_exceeded: "This texture pack is too large to add. Choose a smaller one.",
  definition_missing: "This texture pack is incomplete. Download it again or choose another one.",
  definition_invalid: "This texture pack is incomplete. Download it again or choose another one.",
  mapping_missing_image: "This texture pack is incomplete. Download it again or choose another one.",
  duplicate_target: "This texture pack contains conflicting images. Choose another one.",
  unsupported_hash_width: "This texture pack was made for uMod, which is not supported yet. Choose a TexMod pack.",
  unsupported_image: "This texture pack contains images that are not supported. Choose another one.",
  unsupported_dimensions: "This texture pack contains an image that is too large. Choose another one.",
  source_missing: "The saved file is missing. Remove this texture pack, then add the .tpf file again.",
  disk_full: "There is not enough storage space. Free some space, then try again.",
  permission_denied: "The launcher could not open or save this file. Check the file, then try again.",
  cancelled: "Adding the texture pack was cancelled.",
  unknown: "Could not add this texture pack. Try again or choose another file.",
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
  status.value = "Adding texture pack…";
  try {
    const result = await native.texturePacks.import();
    if (result.status === "imported") status.value = "Texture pack added. Select it below to use it the next time you open Guild Wars.";
    else if (result.status === "duplicate") {
      status.value = "This texture pack is already in your list.";
      await nextTick();
      document.getElementById(`texture-pack-${result.packId}`)?.focus();
    }
    else if (result.status === "cancelled") status.value = "";
    else status.value = failureCopy[result.reason];
  } catch {
    status.value = "Could not add this texture pack. Try again or choose another file.";
  } finally {
    busy.value = false;
  }
}

async function select(id: string | null) {
  const native = window.launcherNative;
  if (!native || busy.value) return;
  busy.value = true;
  status.value = "Saving your choice…";
  try {
    await native.texturePacks.select(id);
    status.value = id
      ? "Selected. You will see this texture pack the next time you open Guild Wars."
      : "Selected. You will see the original Guild Wars look the next time you open the game.";
  } catch {
    status.value = "Could not select this texture pack. Try again.";
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
    status.value = "Could not remove this texture pack. Try again.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="settings-heading-row">
    <div><h1>Texture packs</h1><p>Give Guild Wars a different look. Add a .tpf file you downloaded, then choose it below.</p></div>
    <button class="primary" :disabled="busy" @click="importPack"><Upload />Add .tpf file</button>
  </div>
  <p class="texture-pack-note">Your choice is used for every account. If the game is open, close it and open it again to see the change.</p>
  <fieldset class="texture-pack-list" :disabled="busy">
    <legend class="visually-hidden">Active texture pack</legend>
    <div class="texture-pack-card" :class="{ selected: texturePacks.selectedPackId === null }">
      <label><input type="radio" name="texture-pack" :checked="texturePacks.selectedPackId === null" @change="select(null)" />
      <span><strong>Original Guild Wars</strong><small>Use the game’s original look.</small></span></label>
      <span class="pack-ready">Ready</span>
    </div>
    <div v-for="pack in texturePacks.packs" :id="`texture-pack-${pack.id}`" :key="pack.id" tabindex="-1" class="texture-pack-card" :class="{ selected: texturePacks.selectedPackId === pack.id, unavailable: pack.status !== 'ready' }">
      <label><input type="radio" name="texture-pack" :checked="texturePacks.selectedPackId === pack.id" :disabled="pack.status !== 'ready'" @change="select(pack.id)" />
      <span class="texture-pack-copy"><strong>{{ pack.name }}</strong><small>{{ pack.mappings }} changed images · {{ size(pack.sourceBytes) }} · Added {{ new Date(pack.importedAt).toLocaleDateString() }}</small></span>
      </label>
      <span :class="pack.status === 'ready' ? 'pack-ready' : 'pack-warning'">{{ pack.status === 'ready' ? 'Ready' : 'File missing' }}</span>
      <button type="button" class="icon-button" :aria-label="`Remove ${pack.name}`" @click="remove(pack.id)"><Trash2 /></button>
    </div>
  </fieldset>
  <p v-if="status" class="inline-message texture-pack-status" role="status" aria-live="polite">{{ status }}</p>
  <details class="texture-pack-help"><summary>Which files can I use?</summary><p>Choose a .tpf texture pack made for TexMod. Files made for uMod and other kinds of mods are not supported yet.</p><p>A texture pack only changes how the game looks. It cannot run programs or scripts.</p><p>The launcher saves its own copy. After the texture pack has been added, you can delete the original file from Downloads.</p></details>
</template>
