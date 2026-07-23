import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "build/**",
      "out/**",
      "node_modules/**",
      "**/node_modules/**",
      ".pnpm-store/**",
      "dist/**",
      "dist-release/**",
      ".vite/**",
      "**/.nuxt/**",
      "**/.output/**",
      "playwright-report/**",
      "test-results/**",
      "tools/**",
      "forge.config.ts",
      "*.py",
    ],
  },
  {
    files: ["src/main/**/*.ts", "src/shared/**/*.ts", "src/tools/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["src/renderer/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        performance: "readonly",
        WebAssembly: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        console: "readonly",
        WebGL2RenderingContext: "readonly",
        XMLHttpRequest: "readonly",
        OffscreenCanvas: "readonly",
        Image: "readonly",
        Touch: "readonly",
        TouchEvent: "readonly",
        MouseEvent: "readonly",
        Uint8Array: "readonly",
        ArrayBuffer: "readonly",
        URL: "readonly",
        crypto: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        addEventListener: "readonly",
        fetch: "readonly",
        Module: "writable",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/preload/**/*.cjs"],
    languageOptions: {
      globals: {
        require: "readonly",
        Uint8Array: "readonly",
        atob: "readonly",
      },
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["tests/**/*.{js,mjs}", "scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        window: "readonly",
        performance: "readonly",
        WebAssembly: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);
