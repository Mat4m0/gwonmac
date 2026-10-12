import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";

const settingsEntry = fileURLToPath(new URL("../launcher/src/hub-entry.ts", import.meta.url));
/**
 * The Hub fixture loads Settings as the game does, from `settings/settings-app.js`. In the dev
 * server that path is the launcher's source entry, so the fixture draws the same page.
 */
const hubSettingsModule: Plugin = {
  name: "gwonmac-hub-settings-module",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      // The renderer imports it relative to its own module, so any folder may precede it.
      if (request.url?.split("?")[0]?.endsWith("/settings/settings-app.js")) request.url = `/@fs${settingsEntry}`;
      next();
    });
  },
};

export default defineConfig(({ mode }) => {
  const embedded = mode === "embedded";
  return {
    base: "./",
    plugins: [vue(), hubSettingsModule],
    // The Settings module loads on demand, so Vite's start-up scan would miss its dependencies and
    // reload the page mid-test when it found them; scan it with the page.
    optimizeDeps: { entries: ["index.html", settingsEntry] },
    // Library mode preserves dependency environment checks unless they are
    // defined explicitly. The sandboxed renderer intentionally has no Node
    // `process` global.
    define: embedded
      ? { "process.env.NODE_ENV": JSON.stringify("production") }
      : {},
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        // The launcher's Settings source, which the fixture serves as the Hub's Settings module.
        "@shared": fileURLToPath(new URL("../../src/shared", import.meta.url)),
      },
      dedupe: ["vue"],
    },
    build: embedded
      ? {
          emptyOutDir: true,
          outDir: fileURLToPath(
            new URL("../../build/renderer/tools", import.meta.url),
          ),
          sourcemap: false,
          lib: {
            entry: fileURLToPath(new URL("./src/embedded.ts", import.meta.url)),
            formats: ["es"],
            fileName: () => "tools-app.js",
            cssFileName: "tools-app",
          },
        }
      : {
          outDir: "dist",
          sourcemap: true,
        },
    test: {
      environment: "happy-dom",
      globals: true,
      include: ["src/**/*.test.ts"],
    },
  };
});
