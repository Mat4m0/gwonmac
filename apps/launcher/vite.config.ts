import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [vue()],
  // The library build has no Node `process` global in the sandboxed game renderer.
  define: mode === "hub" ? { "process.env.NODE_ENV": JSON.stringify("production") } : {},
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@site": fileURLToPath(new URL("../website/public", import.meta.url)),
      "@shared": fileURLToPath(new URL("../../src/shared", import.meta.url)),
    },
  },
  // `hub` builds the Settings page a second time, as the module the game window's Hub imports.
  build: mode === "hub"
    ? {
        emptyOutDir: true,
        outDir: fileURLToPath(new URL("../../build/renderer/settings", import.meta.url)),
        sourcemap: false,
        lib: {
          entry: fileURLToPath(new URL("./src/hub-entry.ts", import.meta.url)),
          formats: ["es"],
          fileName: () => "settings-app.js",
          cssFileName: "settings-app",
        },
      }
    : {
        emptyOutDir: true,
        outDir: fileURLToPath(new URL("../../build/renderer/launcher", import.meta.url)),
        sourcemap: false,
      },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
}));
