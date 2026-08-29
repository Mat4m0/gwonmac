import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@site": fileURLToPath(new URL("../website/public", import.meta.url)),
      "@shared": fileURLToPath(new URL("../../src/shared", import.meta.url)),
    },
  },
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(new URL("../../build/renderer/launcher", import.meta.url)),
    sourcemap: false,
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
