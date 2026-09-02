/**
 * Owns the launcher's native texture-pack dialogs and forwards confirmed
 * commands to the main-process texture-pack manager.
 */
import { dialog, type BrowserWindow } from "electron";
import type { TexturePackManager } from "./core/texture-pack-manager.js";

export function createTexturePackActions(texturePacks: TexturePackManager) {
  return Object.freeze({
    importTexturePack: async (win: BrowserWindow) => {
      const result = await dialog.showOpenDialog(win, {
        title: "Import Texture Pack",
        properties: ["openFile"],
        filters: [{ name: "TexMod texture packs", extensions: ["tpf"] }],
      });
      if (result.canceled || result.filePaths.length !== 1) return { status: "cancelled" as const };
      return texturePacks.importFile(result.filePaths[0]!);
    },
    selectTexturePack: (id: string | null) => texturePacks.select(id),
    removeTexturePack: async (win: BrowserWindow, id: string) => {
      const pack = texturePacks.snapshot().packs.find((candidate) => candidate.id === id);
      if (!pack) throw new Error("Texture pack is not installed");
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Remove", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: `Remove ${pack.name}?`,
        detail: "The managed copy is deleted. Game windows that are already open keep their current appearance until they close.",
      });
      if (response === 0) await texturePacks.remove(id);
    },
  });
}
