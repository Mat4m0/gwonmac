import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const embedded = mode === "embedded";
  return {
    base: "./",
    plugins: [vue()],
    // Library mode preserves dependency environment checks unless they are
    // defined explicitly. The sandboxed renderer intentionally has no Node
    // `process` global.
    define: embedded
      ? { "process.env.NODE_ENV": JSON.stringify("production") }
      : {},
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
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
